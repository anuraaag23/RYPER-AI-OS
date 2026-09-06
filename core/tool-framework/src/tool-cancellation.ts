import { createLogger } from "@ryper/logging";

const log = createLogger("tool-framework:cancellation");

/**
 * Owns one `AbortController` per in-flight invocation, keyed by
 * `invocationId`, so `ToolManager.cancel(invocationId)` can reach a
 * specific running call without affecting any other. Mirrors
 * `@ryper/planner`'s `CancellationManager` shape at the tool-execution
 * layer.
 */
export class ToolCancellationRegistry {
  private readonly controllers = new Map<string, AbortController>();

  begin(invocationId: string): AbortSignal {
    const controller = new AbortController();
    this.controllers.set(invocationId, controller);
    return controller.signal;
  }

  cancel(invocationId: string, reason = "cancelled by caller"): boolean {
    const controller = this.controllers.get(invocationId);
    if (!controller) return false;
    controller.abort(reason);
    log.info("tool invocation cancelled", { invocationId, reason });
    return true;
  }

  isCancelled(invocationId: string): boolean {
    return this.controllers.get(invocationId)?.signal.aborted ?? false;
  }

  dispose(invocationId: string): void {
    this.controllers.delete(invocationId);
  }
}

export function createToolCancellationRegistry(): ToolCancellationRegistry {
  return new ToolCancellationRegistry();
}
