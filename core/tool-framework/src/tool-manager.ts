import type { EventBus } from "@ryper/event-bus";
import type { CapabilityBroker } from "@ryper/security";
import type { MemoryManager } from "@ryper/memory-system";
import type { PluginRuntime } from "@ryper/plugin-runtime";
import { createLogger } from "@ryper/logging";
import { builtinTools } from "./builtin-tools.js";
import { ToolCancellationRegistry } from "./tool-cancellation.js";
import { defaultToolFrameworkConfig, type ToolFrameworkConfig } from "./tool-configuration.js";
import { ToolDiagnostics } from "./tool-diagnostics.js";
import { ToolDiscovery, ToolRegistry, type ToolQuery } from "./tool-registry.js";
import { ToolExecutor } from "./tool-executor.js";
import { ToolInvocationLogger } from "./tool-logging.js";
import { ToolMemoryIntegration } from "./memory-integration.js";
import { ToolMetrics } from "./tool-metrics.js";
import { ToolPermissionManager } from "./tool-permissions.js";
import { ToolPluginBridge } from "./plugin-integration.js";
import { ToolQueue } from "./tool-queue.js";
import { ToolValidator } from "./tool-validator.js";
import type {
  ToolDefinition,
  ToolInvocationRequest,
  ToolPlatform,
  ToolResult,
  ToolStreamChunk,
} from "./types.js";

const log = createLogger("tool-framework:manager");

export interface ToolManagerOptions {
  readonly eventBus?: EventBus;
  readonly capabilityBroker?: CapabilityBroker;
  readonly memory?: MemoryManager;
  readonly pluginRuntime?: PluginRuntime;
  readonly config?: ToolFrameworkConfig;
  readonly registerBuiltinTools?: boolean;
}

export interface InvokeOptions {
  readonly priority?: ToolInvocationRequest["priority"];
  readonly timeoutMs?: number;
  readonly onStreamChunk?: (chunk: ToolStreamChunk) => void;
}

/**
 * The stable execution API sitting between the Agent Planner and every
 * platform adapter: `User → Planner → Tool Calling Framework → Platform
 * Adapter → Execution`. `ToolManager` never contains platform-specific
 * code itself — every real OS/app action lives inside a `ToolDefinition`
 * a platform adapter registers.
 */
export class ToolManager {
  readonly config: ToolFrameworkConfig;
  readonly registry = new ToolRegistry();
  readonly discovery: ToolDiscovery;
  readonly diagnostics: ToolDiagnostics;
  readonly metrics = new ToolMetrics();
  readonly logger: ToolInvocationLogger;
  readonly cancellation = new ToolCancellationRegistry();
  readonly queue: ToolQueue;
  readonly pluginBridge: ToolPluginBridge | undefined;
  readonly memoryIntegration: ToolMemoryIntegration | undefined;

  private readonly validator = new ToolValidator();
  private readonly permissions: ToolPermissionManager | undefined;
  private readonly executor: ToolExecutor;
  private readonly eventBus: EventBus | undefined;

  constructor(options: ToolManagerOptions = {}) {
    this.config = options.config ?? defaultToolFrameworkConfig;
    this.eventBus = options.eventBus;
    this.discovery = new ToolDiscovery(this.registry);
    this.diagnostics = new ToolDiagnostics(this.config.diagnosticsHistorySize);
    this.logger = new ToolInvocationLogger(this.config.logHistorySize);
    this.queue = new ToolQueue(this.config.maxConcurrentInvocations);

    this.permissions = options.capabilityBroker
      ? new ToolPermissionManager(options.capabilityBroker)
      : undefined;
    this.executor = new ToolExecutor(this.validator, this.permissions, this.eventBus);

    this.memoryIntegration =
      options.memory && this.config.memoryIntegrationEnabled
        ? new ToolMemoryIntegration(options.memory)
        : undefined;
    this.pluginBridge = options.pluginRuntime
      ? new ToolPluginBridge(this.registry, options.pluginRuntime)
      : undefined;

    if (options.registerBuiltinTools ?? true) {
      for (const tool of builtinTools) this.registry.register(tool);
    }
  }

  registerTool(tool: ToolDefinition): void {
    this.registry.register(tool);
  }

  unregisterTool(toolId: string): boolean {
    return this.registry.unregister(toolId);
  }

  updateTool(tool: ToolDefinition): void {
    this.registry.update(tool);
  }

  discover(query: ToolQuery = {}): ReturnType<ToolDiscovery["find"]> {
    return this.discovery.find(query);
  }

  /** Satisfies `ToolInvoker` (the interface the voice/planner bridges depend on structurally). */
  async invoke(
    toolId: string,
    parameters: Readonly<Record<string, unknown>>,
    actorId: string,
    sessionId: string,
    platform: ToolPlatform,
    invokeOptions: InvokeOptions = {},
  ): Promise<ToolResult> {
    const tool = this.registry.get(toolId);
    const request: ToolInvocationRequest = {
      toolId,
      parameters,
      actorId,
      sessionId,
      platform,
      ...(invokeOptions.priority ? { priority: invokeOptions.priority } : {}),
      ...(invokeOptions.timeoutMs ? { timeoutMs: invokeOptions.timeoutMs } : {}),
    };

    if (!tool) {
      log.warn("invocation for unknown tool", { toolId });
      const startedAt = new Date().toISOString();
      return {
        invocationId: `unknown-${Date.now().toString(36)}`,
        toolId,
        status: "error",
        startedAt,
        finishedAt: startedAt,
        durationMs: 0,
        attempts: 0,
        errorCode: "framework.unknown_tool",
        errorMessage: `unknown tool "${toolId}"`,
      };
    }

    const invocationId = `invocation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const signal = this.cancellation.begin(invocationId);

    const result = await this.queue.enqueue(request, () =>
      this.executor.execute(tool, request, {
        signal,
        invocationId,
        ...(invokeOptions.onStreamChunk ? { onStreamChunk: invokeOptions.onStreamChunk } : {}),
      }),
    );

    this.cancellation.dispose(invocationId);
    this.diagnostics.record(result);
    this.metrics.record(result);
    this.logger.record(request, result);
    await this.memoryIntegration?.recordInvocation(toolId, result, actorId);
    await this.eventBus?.emit(
      "tool.invocation.completed",
      { toolId, invocationId: result.invocationId, status: result.status },
      "tool-framework",
    );

    return result;
  }

  cancel(invocationId: string, reason?: string): boolean {
    return this.cancellation.cancel(invocationId, reason);
  }
}

export function createToolManager(options?: ToolManagerOptions): ToolManager {
  return new ToolManager(options);
}
