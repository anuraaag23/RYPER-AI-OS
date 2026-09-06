import { createLogger } from "@ryper/logging";

const log = createLogger("event-bus");

export interface RyperEvent<TPayload = unknown> {
  readonly type: string;
  readonly payload: TPayload;
  readonly emittedAt: string;
  readonly source: string;
}

export type Unsubscribe = () => void;

export type EventHandler<TPayload = unknown> = (
  event: RyperEvent<TPayload>,
) => void | Promise<void>;

export interface EventFilter {
  readonly type?: string;
  readonly source?: string;
}

function matches(event: RyperEvent, filter?: EventFilter): boolean {
  if (!filter) return true;
  if (filter.type !== undefined && filter.type !== event.type) return false;
  if (filter.source !== undefined && filter.source !== event.source) return false;
  return true;
}

/**
 * In-process event bus. Automation rules, memory consolidation, and
 * cross-module reactions subscribe here instead of calling each other
 * directly, per the Core's event-driven architecture.
 */
export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly wildcardHandlers = new Set<{
    filter: EventFilter | undefined;
    handler: EventHandler;
  }>();

  on<TPayload = unknown>(type: string, handler: EventHandler<TPayload>): Unsubscribe {
    const set = this.handlers.get(type) ?? new Set<EventHandler>();
    set.add(handler as EventHandler);
    this.handlers.set(type, set);
    return () => {
      set.delete(handler as EventHandler);
    };
  }

  subscribe(filter: EventFilter, handler: EventHandler): Unsubscribe {
    const entry = { filter, handler };
    this.wildcardHandlers.add(entry);
    return () => {
      this.wildcardHandlers.delete(entry);
    };
  }

  async emit<TPayload = unknown>(type: string, payload: TPayload, source = "core"): Promise<void> {
    const event: RyperEvent<TPayload> = {
      type,
      payload,
      source,
      emittedAt: new Date().toISOString(),
    };

    const direct = this.handlers.get(type);
    const tasks: Array<Promise<void>> = [];

    const runSafely = (handler: EventHandler): Promise<void> =>
      Promise.resolve().then(() => handler(event) as void | Promise<void>) as Promise<void>;

    if (direct) {
      for (const handler of direct) {
        tasks.push(runSafely(handler));
      }
    }

    for (const { filter, handler } of this.wildcardHandlers) {
      if (matches(event, filter)) {
        tasks.push(runSafely(handler));
      }
    }

    const results = await Promise.allSettled(tasks);
    for (const result of results) {
      if (result.status === "rejected") {
        log.error("event handler threw", { type, reason: String(result.reason) });
      }
    }
  }

  listenerCount(type: string): number {
    return (this.handlers.get(type)?.size ?? 0) + this.wildcardHandlers.size;
  }
}

export function createEventBus(): EventBus {
  return new EventBus();
}
