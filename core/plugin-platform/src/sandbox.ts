import type { PluginRuntime } from "@ryper/plugin-runtime";
import { createLogger } from "@ryper/logging";

const log = createLogger("plugin-platform:sandbox");

export class SandboxViolationError extends Error {}

export interface SandboxLimits {
  /** Max concurrent in-flight action calls per plugin. */
  readonly maxConcurrentCalls: number;
  /** Wall-clock timeout per action call. */
  readonly callTimeoutMs: number;
  /** Rough byte-size ceiling on a call's JSON-serialized input+output, as a memory-usage proxy. */
  readonly maxPayloadBytes: number;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  maxConcurrentCalls: 4,
  callTimeoutMs: 10_000,
  maxPayloadBytes: 1_000_000,
};

function byteSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
  } catch {
    return 0;
  }
}

/**
 * Enforces the brief's "Resource Limits / Memory Limits / CPU Limits /
 * API Restrictions" at the only level this repo can honestly enforce them
 * at: call concurrency, wall-clock timeout, and payload-size as a memory
 * proxy, layered around `PluginRuntime.invoke()` — not a real OS sandbox
 * (no V8 isolates, seccomp, or process boundary exist here). Permission
 * isolation, filesystem restriction, and network restriction are already
 * real, because they're enforced by `@ryper/security`'s `CapabilityBroker`
 * underneath `PluginRuntime` itself — this class doesn't re-implement
 * that, only adds the resource dimension the broker doesn't cover.
 */
export class PluginSandbox {
  private readonly activeCalls = new Map<string, number>();

  constructor(
    private readonly runtime: PluginRuntime,
    private readonly limits: SandboxLimits = DEFAULT_SANDBOX_LIMITS,
  ) {}

  async invoke(pluginId: string, actionName: string, input: unknown): Promise<unknown> {
    const active = this.activeCalls.get(pluginId) ?? 0;
    if (active >= this.limits.maxConcurrentCalls) {
      throw new SandboxViolationError(
        `plugin "${pluginId}" exceeded its concurrent-call limit (${this.limits.maxConcurrentCalls})`,
      );
    }
    if (byteSize(input) > this.limits.maxPayloadBytes) {
      throw new SandboxViolationError(
        `plugin "${pluginId}" call input exceeds the sandbox payload limit`,
      );
    }

    this.activeCalls.set(pluginId, active + 1);
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort("timeout"), this.limits.callTimeoutMs);

    try {
      const result = await Promise.race([
        this.runtime.invoke(pluginId, actionName, input),
        new Promise<never>((_resolve, reject) => {
          timeoutController.signal.addEventListener("abort", () =>
            reject(
              new SandboxViolationError(`plugin "${pluginId}" call "${actionName}" timed out`),
            ),
          );
        }),
      ]);
      if (byteSize(result) > this.limits.maxPayloadBytes) {
        throw new SandboxViolationError(
          `plugin "${pluginId}" call output exceeds the sandbox payload limit`,
        );
      }
      return result;
    } finally {
      clearTimeout(timer);
      const remaining = (this.activeCalls.get(pluginId) ?? 1) - 1;
      if (remaining <= 0) this.activeCalls.delete(pluginId);
      else this.activeCalls.set(pluginId, remaining);
      log.debug("sandboxed call finished", { pluginId, actionName });
    }
  }
}

export function createPluginSandbox(runtime: PluginRuntime, limits?: SandboxLimits): PluginSandbox {
  return new PluginSandbox(runtime, limits);
}
