import type { EventBus } from "@ryper/event-bus";
import { createLogger } from "@ryper/logging";
import { buildToolContext } from "./tool-context.js";
import type { ToolPermissionManager } from "./tool-permissions.js";
import { buildToolResult, FRAMEWORK_ERROR_CODES } from "./tool-results.js";
import { ToolRetryPlanner } from "./tool-retry.js";
import { consumeToolStream } from "./tool-streaming.js";
import type { ToolValidator } from "./tool-validator.js";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationRequest,
  ToolResult,
  ToolStreamChunk,
} from "./types.js";

const log = createLogger("tool-framework:executor");
const SOURCE = "tool-framework";

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `invocation-${idCounter}-${Date.now().toString(36)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Merges an internal timeout controller with a caller-supplied signal, so either can cancel the run. */
function linkedSignal(
  timeoutMs: number,
  callerSignal?: AbortSignal,
): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  const onCallerAbort = (): void => controller.abort(callerSignal?.reason ?? "cancelled");
  callerSignal?.addEventListener("abort", onCallerAbort);
  if (callerSignal?.aborted) controller.abort(callerSignal.reason);
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    },
  };
}

export interface ExecuteOptions {
  readonly signal?: AbortSignal;
  readonly onStreamChunk?: (chunk: ToolStreamChunk) => void;
  readonly invocationId?: string;
}

/**
 * Runs the brief's execution pipeline for one invocation: capability
 * check → input validation → execution (streaming or not) → output
 * validation → retry-on-failure → result. `ToolManager` is the facade
 * callers use; this class holds the actual step-by-step logic so it can
 * be unit-tested in isolation from registry/discovery/plugin concerns.
 */
export class ToolExecutor {
  private readonly retryPlanner = new ToolRetryPlanner();

  constructor(
    private readonly validator: ToolValidator,
    private readonly permissions?: ToolPermissionManager,
    private readonly eventBus?: EventBus,
  ) {}

  async execute(
    tool: ToolDefinition,
    request: ToolInvocationRequest,
    options: ExecuteOptions = {},
  ): Promise<ToolResult> {
    const startedAt = new Date().toISOString();
    const timeoutMs = request.timeoutMs ?? tool.spec.timeoutMs;
    const policy = this.retryPlanner.planFor(tool.spec);
    const invocationId = options.invocationId ?? nextId();

    let attempts = 0;
    let lastResult: ToolResult | undefined;

    while (attempts < policy.maxAttempts) {
      attempts += 1;
      if (attempts > 1) {
        await sleep(this.retryPlanner.delayForAttempt(policy, attempts - 1));
      }
      lastResult = await this.attemptOnce(
        tool,
        request,
        startedAt,
        attempts,
        timeoutMs,
        invocationId,
        options,
      );
      if (!this.retryPlanner.shouldRetry(lastResult, policy)) break;
    }

    return lastResult!;
  }

  private async attemptOnce(
    tool: ToolDefinition,
    request: ToolInvocationRequest,
    startedAt: string,
    attempt: number,
    timeoutMs: number,
    invocationId: string,
    options: ExecuteOptions,
  ): Promise<ToolResult> {
    const toolId = tool.spec.id;

    const validation = this.validator.validateInput(tool.spec.inputSchema, request.parameters);
    if (!validation.valid) {
      return buildToolResult({
        invocationId,
        toolId,
        status: "validation_error",
        startedAt,
        attempts: attempt,
        errorCode: FRAMEWORK_ERROR_CODES.VALIDATION_FAILED,
        errorMessage: validation.errors.join("; "),
      });
    }

    if (this.permissions) {
      const checks = this.permissions.checkAll(tool.spec, request.actorId);
      const denied = checks.find((check) => !check.granted);
      if (denied) {
        return buildToolResult({
          invocationId,
          toolId,
          status: "permission_denied",
          startedAt,
          attempts: attempt,
          errorCode: FRAMEWORK_ERROR_CODES.PERMISSION_DENIED,
          errorMessage: `capability "${denied.requirement.capability}" is not granted`,
        });
      }
    }

    const { signal, clear } = linkedSignal(timeoutMs, options.signal);
    const context = buildToolContext(request, signal, invocationId);

    const abortPromise = new Promise<never>((_resolve, reject) => {
      if (signal.aborted) {
        reject(new Error(String(signal.reason ?? "aborted")));
        return;
      }
      signal.addEventListener(
        "abort",
        () => reject(new Error(String(signal.reason ?? "aborted"))),
        { once: true },
      );
    });

    try {
      const value =
        tool.spec.streamingSupport && tool.executeStream
          ? await Promise.race([
              this.runStreaming(tool, request.parameters, context, options),
              abortPromise,
            ])
          : await Promise.race([
              Promise.resolve(tool.execute(request.parameters, context)),
              abortPromise,
            ]);

      if (signal.aborted) {
        return buildToolResult({
          invocationId: context.invocationId,
          toolId,
          status: signal.reason === "timeout" ? "timeout" : "cancelled",
          startedAt,
          attempts: attempt,
          errorCode:
            signal.reason === "timeout"
              ? FRAMEWORK_ERROR_CODES.TIMEOUT
              : FRAMEWORK_ERROR_CODES.CANCELLED,
        });
      }

      const outputValidation = this.validator.validateOutput(tool.spec.outputSchema, value);
      if (!outputValidation.valid) {
        return buildToolResult({
          invocationId: context.invocationId,
          toolId,
          status: "validation_error",
          startedAt,
          attempts: attempt,
          errorCode: FRAMEWORK_ERROR_CODES.VALIDATION_FAILED,
          errorMessage: outputValidation.errors.join("; "),
        });
      }

      await this.eventBus?.emit(
        "tool.invocation.succeeded",
        { toolId, invocationId: context.invocationId },
        SOURCE,
      );
      return buildToolResult({
        invocationId: context.invocationId,
        toolId,
        status: "ok",
        startedAt,
        attempts: attempt,
        value,
      });
    } catch (err) {
      log.error("tool execution threw", { tool: toolId, error: String(err) });
      await this.eventBus?.emit(
        "tool.invocation.failed",
        { toolId, invocationId: context.invocationId },
        SOURCE,
      );
      if (signal.aborted) {
        const isTimeout = signal.reason === "timeout";
        return buildToolResult({
          invocationId: context.invocationId,
          toolId,
          status: isTimeout ? "timeout" : "cancelled",
          startedAt,
          attempts: attempt,
          errorCode: isTimeout ? FRAMEWORK_ERROR_CODES.TIMEOUT : FRAMEWORK_ERROR_CODES.CANCELLED,
          errorMessage: String(err),
        });
      }
      return buildToolResult({
        invocationId: context.invocationId,
        toolId,
        status: "error",
        startedAt,
        attempts: attempt,
        errorCode: FRAMEWORK_ERROR_CODES.EXECUTION_THREW,
        errorMessage: String(err),
      });
    } finally {
      clear();
    }
  }

  private async runStreaming(
    tool: ToolDefinition,
    parameters: Readonly<Record<string, unknown>>,
    context: ToolExecutionContext,
    options: ExecuteOptions,
  ): Promise<unknown> {
    const chunks = await consumeToolStream(tool.executeStream!, parameters, context, {
      ...(options.onStreamChunk ? { onChunk: options.onStreamChunk } : {}),
      ...(this.eventBus ? { eventBus: this.eventBus } : {}),
    });
    return chunks.filter((chunk) => !chunk.done).map((chunk) => chunk.data);
  }
}

export function createToolExecutor(
  validator: ToolValidator,
  permissions?: ToolPermissionManager,
  eventBus?: EventBus,
): ToolExecutor {
  return new ToolExecutor(validator, permissions, eventBus);
}
