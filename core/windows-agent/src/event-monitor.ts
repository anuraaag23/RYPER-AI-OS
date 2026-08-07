import type { EventBus } from "@ryper/event-bus";
import { createLogger } from "@ryper/logging";
import type { WindowsSystemApi } from "./windows-system-api.js";
import type { Unsubscribe, WindowsSystemEvent, WindowsSystemEventType } from "./types.js";

const log = createLogger("windows-agent:event-monitor");

/**
 * Bridges `WindowsSystemApi.subscribeToEvents()` (process/window/device/
 * display/clipboard change notifications) onto `@ryper/event-bus`, and
 * keeps a small bounded in-memory history for diagnostics/inspection —
 * the same "re-emit onto the shared bus + keep a bounded log" pattern
 * `AudioDeviceManager` (Phase 6) uses for device connect/disconnect.
 */
export class EventMonitor {
  private readonly history: WindowsSystemEvent[] = [];
  private unsubscribeFromSystemApi: Unsubscribe | undefined;

  constructor(
    private readonly systemApi: WindowsSystemApi,
    private readonly eventBus?: EventBus,
    private readonly historySize = 200,
  ) {}

  start(): void {
    if (this.unsubscribeFromSystemApi) return; // already monitoring
    this.unsubscribeFromSystemApi = this.systemApi.subscribeToEvents((event) => {
      this.history.push(event);
      if (this.history.length > this.historySize) this.history.shift();
      void this.eventBus?.emit(`windows_agent.${event.type}`, event.payload, "windows-agent");
      log.debug("windows system event", { type: event.type });
    });
  }

  stop(): void {
    this.unsubscribeFromSystemApi?.();
    this.unsubscribeFromSystemApi = undefined;
  }

  isMonitoring(): boolean {
    return this.unsubscribeFromSystemApi !== undefined;
  }

  recent(type?: WindowsSystemEventType): readonly WindowsSystemEvent[] {
    return type ? this.history.filter((e) => e.type === type) : [...this.history];
  }
}

export function createEventMonitor(
  systemApi: WindowsSystemApi,
  eventBus?: EventBus,
  historySize?: number,
): EventMonitor {
  return new EventMonitor(systemApi, eventBus, historySize);
}
