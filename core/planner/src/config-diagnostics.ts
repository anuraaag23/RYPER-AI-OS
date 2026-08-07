import type { LogLevel } from "@ryper/logging";
import type { ExecutionPlan } from "./types.js";

export interface PlannerConfig {
  readonly logLevel: LogLevel;
  /** Upper bound on tasks placed in a single parallel execution level, for resource-aware scheduling. */
  readonly maxParallelTasks: number;
  readonly defaultTaskTimeoutMs: number;
  readonly memoryIntegrationEnabled: boolean;
  readonly voiceIntegrationEnabled: boolean;
  /** How many recent plans `PlannerDiagnostics` keeps in memory. */
  readonly diagnosticsHistorySize: number;
}

export class PlannerConfigValidationError extends Error {}

const VALID_LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

function parseInt10(value: string | undefined, fallback: number, fieldName: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new PlannerConfigValidationError(
      `invalid ${fieldName} "${value}" — expected a positive integer`,
    );
  }
  return parsed;
}

/**
 * Reads `RYPER_PLANNER_*` environment variables, mirroring
 * `@ryper/ai-engine`'s `loadEngineConfig` shape (fail loudly on an
 * invalid value, injected `env` for testability, sensible defaults).
 */
export function loadPlannerConfig(
  env: Readonly<Record<string, string | undefined>>,
): PlannerConfig {
  const logLevel = (env.RYPER_PLANNER_LOG_LEVEL ?? "info") as LogLevel;
  if (!VALID_LOG_LEVELS.includes(logLevel)) {
    throw new PlannerConfigValidationError(
      `invalid RYPER_PLANNER_LOG_LEVEL "${logLevel}" — expected one of: ${VALID_LOG_LEVELS.join(", ")}`,
    );
  }
  return {
    logLevel,
    maxParallelTasks: parseInt10(
      env.RYPER_PLANNER_MAX_PARALLEL_TASKS,
      8,
      "RYPER_PLANNER_MAX_PARALLEL_TASKS",
    ),
    defaultTaskTimeoutMs: parseInt10(
      env.RYPER_PLANNER_DEFAULT_TASK_TIMEOUT_MS,
      30_000,
      "RYPER_PLANNER_DEFAULT_TASK_TIMEOUT_MS",
    ),
    memoryIntegrationEnabled: parseBool(env.RYPER_PLANNER_MEMORY_INTEGRATION_ENABLED, true),
    voiceIntegrationEnabled: parseBool(env.RYPER_PLANNER_VOICE_INTEGRATION_ENABLED, true),
    diagnosticsHistorySize: parseInt10(
      env.RYPER_PLANNER_DIAGNOSTICS_HISTORY_SIZE,
      50,
      "RYPER_PLANNER_DIAGNOSTICS_HISTORY_SIZE",
    ),
  };
}

export const defaultPlannerConfig: PlannerConfig = loadPlannerConfig({});

export interface PlanDiagnosticEntry {
  readonly planId: string;
  readonly sourceRequest: string;
  readonly taskCount: number;
  readonly levelCount: number;
  readonly buildDurationMs: number;
  readonly unresolvedTools: readonly string[];
  readonly createdAt: string;
}

/**
 * Bounded ring buffer of recent plan-build metadata, plus counters, for
 * introspection tooling (a future diagnostics UI, or just `console`-level
 * debugging of why a plan came out a particular shape).
 */
export class PlannerDiagnostics {
  private readonly history: PlanDiagnosticEntry[] = [];
  private planCount = 0;

  constructor(private readonly historySize = defaultPlannerConfig.diagnosticsHistorySize) {}

  record(plan: ExecutionPlan, buildDurationMs: number, unresolvedTools: readonly string[]): void {
    this.planCount += 1;
    this.history.push({
      planId: plan.id,
      sourceRequest: plan.metadata.sourceRequest,
      taskCount: plan.tasks.length,
      levelCount: plan.executionLevels.length,
      buildDurationMs,
      unresolvedTools,
      createdAt: plan.metadata.createdAt,
    });
    if (this.history.length > this.historySize) {
      this.history.shift();
    }
  }

  recentPlans(): readonly PlanDiagnosticEntry[] {
    return [...this.history];
  }

  totalPlansBuilt(): number {
    return this.planCount;
  }

  averageBuildDurationMs(): number {
    if (this.history.length === 0) return 0;
    const total = this.history.reduce((sum, entry) => sum + entry.buildDurationMs, 0);
    return total / this.history.length;
  }
}

export function createPlannerDiagnostics(historySize?: number): PlannerDiagnostics {
  return new PlannerDiagnostics(historySize);
}
