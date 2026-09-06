import type { EventBus } from "@ryper/event-bus";
import type { CapabilityBroker } from "@ryper/security";
import type { MemoryManager } from "@ryper/memory-system";
import { createLogger } from "@ryper/logging";
import { CapabilityResolver, PermissionValidator } from "./capability.js";
import { ContextResolver } from "./context-resolver.js";
import { DependencyAnalyzer, TaskGraph } from "./dependency-analyzer.js";
import { ExecutionQueue } from "./execution-queue.js";
import { GoalAnalyzer } from "./goal-analyzer.js";
import { IntentParser, type IntentParserFn } from "./intent-parser.js";
import { PlannerMemoryIntegration } from "./memory-integration.js";
import { PlanOptimizer } from "./plan-optimizer.js";
import { PlannerPluginRegistry, type PluginTaskSchema } from "./plugin-registry.js";
import { RecoveryPlanner, RetryPlanner } from "./retry-recovery.js";
import { TaskGenerator } from "./task-generator.js";
import { ToolSelector, type ToolRoute } from "./tool-selector.js";
import {
  PlannerDiagnostics,
  defaultPlannerConfig,
  type PlannerConfig,
} from "./config-diagnostics.js";
import type { ExecutionPlan, PlanRequest, TaskNode, TaskType } from "./types.js";

const log = createLogger("planner:engine");

let planCounter = 0;
function nextPlanId(): string {
  planCounter += 1;
  return `plan-${planCounter}-${Date.now().toString(36)}`;
}

export interface PlannerEngineOptions {
  readonly eventBus?: EventBus;
  readonly capabilityBroker?: CapabilityBroker;
  readonly memory?: MemoryManager;
  readonly pluginRegistry?: PlannerPluginRegistry;
  readonly customIntentParser?: IntentParserFn;
  readonly config?: PlannerConfig;
  /** Inject a `CapabilityResolver` backed by a real platform capability layer instead of the static built-in table. */
  readonly capabilityResolver?: CapabilityResolver;
}

/**
 * The stable execution-planning API future Desktop/Android/iOS/Browser/
 * Automation/Cloud agents consume. `PlannerEngine` never depends on
 * platform-specific code, and never executes a task itself — `plan()`
 * turns natural language into a validated `ExecutionPlan`; running it is
 * the caller's job, driven through the `ExecutionQueue` returned by
 * `buildExecutionQueue()`.
 */
export class PlannerEngine {
  readonly config: PlannerConfig;
  readonly pluginRegistry: PlannerPluginRegistry;
  readonly diagnostics: PlannerDiagnostics;

  private readonly intentParser: IntentParser;
  private readonly goalAnalyzer = new GoalAnalyzer();
  private readonly taskGenerator = new TaskGenerator();
  private readonly capabilityResolver: CapabilityResolver;
  private readonly dependencyAnalyzer = new DependencyAnalyzer();
  private readonly toolSelector: ToolSelector;
  private readonly retryPlanner = new RetryPlanner();
  private readonly recoveryPlanner = new RecoveryPlanner();
  private readonly planOptimizer = new PlanOptimizer();
  private readonly contextResolver: ContextResolver;
  private readonly permissionValidator?: PermissionValidator;
  private readonly memoryIntegration?: PlannerMemoryIntegration;
  private readonly eventBus: EventBus | undefined;

  constructor(options: PlannerEngineOptions = {}) {
    this.config = options.config ?? defaultPlannerConfig;
    this.eventBus = options.eventBus;
    this.pluginRegistry = options.pluginRegistry ?? new PlannerPluginRegistry();
    this.toolSelector = new ToolSelector(this.pluginRegistry);
    this.intentParser = new IntentParser(options.customIntentParser);
    this.contextResolver = new ContextResolver(
      this.config.memoryIntegrationEnabled ? options.memory : undefined,
    );
    this.diagnostics = new PlannerDiagnostics(this.config.diagnosticsHistorySize);
    this.capabilityResolver = options.capabilityResolver ?? new CapabilityResolver();
    if (options.capabilityBroker) {
      this.permissionValidator = new PermissionValidator(options.capabilityBroker);
    }
    if (options.memory && this.config.memoryIntegrationEnabled) {
      this.memoryIntegration = new PlannerMemoryIntegration(options.memory);
    }
  }

  registerPluginTaskSchema(schema: PluginTaskSchema): void {
    this.pluginRegistry.register(schema);
  }

  async plan(request: PlanRequest): Promise<ExecutionPlan> {
    const startedAt = Date.now();
    const diagnosticsLog: string[] = [];

    const intent = this.intentParser.parse(request.text);
    const goals = this.goalAnalyzer.analyze(intent);
    const generated = this.taskGenerator.generate(goals, { sequential: !intent.parallel });

    const withDefaults = await this.contextResolver.applyMemoryDefaults(generated);
    const optimized = this.planOptimizer.optimize(withDefaults);

    const taskTypes = [...new Set(optimized.map((task) => task.taskType))] as TaskType[];
    const resolutions = this.capabilityResolver.resolveAll(taskTypes, request.platform);
    for (const resolution of resolutions) {
      if (!resolution.supported) diagnosticsLog.push(resolution.alternative ?? "");
    }

    const withRetry = this.retryPlanner.apply(optimized);
    const withRecovery = this.recoveryPlanner.apply(withRetry, resolutions);

    const { executionLevels } = this.dependencyAnalyzer.analyze(withRecovery);

    const unresolvedTools = this.resolveTools(withRecovery, diagnosticsLog);

    if (this.permissionValidator) {
      const actorId = request.actorId ?? "user";
      const results = await this.permissionValidator.validate(withRecovery, actorId);
      for (const result of results) {
        if (!result.granted) {
          diagnosticsLog.push(
            `capability "${result.capability}" was not granted for task "${result.taskId}"`,
          );
        }
      }
    }

    const plan: ExecutionPlan = {
      id: nextPlanId(),
      tasks: withRecovery,
      executionLevels,
      ...(intent.schedule ? { schedule: intent.schedule } : {}),
      metadata: {
        createdAt: new Date().toISOString(),
        sourceRequest: request.text,
        platform: request.platform,
        intentShape: intent.shape,
      },
      diagnostics: diagnosticsLog,
    };

    this.diagnostics.record(plan, Date.now() - startedAt, unresolvedTools);
    await this.eventBus?.emit(
      "planner.plan.created",
      { planId: plan.id, taskCount: plan.tasks.length },
      "planner",
    );
    log.info("plan built", { planId: plan.id, tasks: plan.tasks.length, shape: intent.shape });

    if (this.memoryIntegration) {
      // Recall is informational for now (surfaced via diagnostics); it doesn't
      // block plan construction, matching the brief's "improve planning"
      // rather than "gate planning on memory being available".
      const recalled = await this.memoryIntegration.recallForIntent(intent, 3);
      if (recalled.length > 0) {
        diagnosticsLog.push(`${recalled.length} related memories found for this request`);
      }
    }

    return plan;
  }

  private resolveTools(tasks: readonly TaskNode[], diagnosticsLog: string[]): readonly string[] {
    const unresolved: string[] = [];
    for (const task of tasks) {
      const route: ToolRoute = this.toolSelector.select(task);
      if (route.kind === "unresolved") {
        unresolved.push(task.id);
        diagnosticsLog.push(`task "${task.id}": ${route.reason}`);
      }
    }
    return unresolved;
  }

  /** Rebuilds a fresh `ExecutionQueue` for a plan — the entry point a platform agent drives to run it. */
  buildExecutionQueue(plan: ExecutionPlan): ExecutionQueue {
    return new ExecutionQueue(new TaskGraph(plan.tasks));
  }

  async recordSuccessfulPlan(plan: ExecutionPlan): Promise<void> {
    await this.memoryIntegration?.recordWorkflow(plan);
  }
}

export function createPlannerEngine(options?: PlannerEngineOptions): PlannerEngine {
  return new PlannerEngine(options);
}
