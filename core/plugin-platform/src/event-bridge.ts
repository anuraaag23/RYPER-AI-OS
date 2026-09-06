import type { EventBus, Unsubscribe } from "@ryper/event-bus";
import type { PluginEventCategory } from "@ryper/plugin-sdk";

/** Namespace prefix each category maps to on the shared `EventBus`. */
const CATEGORY_PREFIXES: Readonly<Record<PluginEventCategory, string>> = {
  ai: "ai.",
  voice: "voice.",
  memory: "memory.",
  planner: "planner.",
  tool: "tool.",
  system: "system.",
  automation: "automation.",
  lifecycle: "plugin.lifecycle.",
};

export class PluginEventCategoryError extends Error {}

/**
 * The only way plugin code reaches the shared `EventBus` — never the raw
 * bus itself, matching the SDK's "do not expose internal implementation
 * details." A plugin picks one of the 8 categories the brief lists;
 * this bridge rejects an event type that doesn't belong to the category
 * it was requested under, and tracks every subscription per plugin so
 * `PluginLifecycleManager` can unsubscribe them all on disable/uninstall.
 */
export class PluginEventBridge {
  private readonly subscriptions = new Map<string, Unsubscribe[]>();

  constructor(private readonly eventBus: EventBus) {}

  subscribe(
    pluginId: string,
    category: PluginEventCategory,
    type: string,
    handler: (payload: unknown) => void | Promise<void>,
  ): Unsubscribe {
    const prefix = CATEGORY_PREFIXES[category];
    if (!type.startsWith(prefix)) {
      throw new PluginEventCategoryError(
        `event type "${type}" does not belong to category "${category}"`,
      );
    }
    const unsubscribe = this.eventBus.on(type, (event) => handler(event.payload));
    const list = this.subscriptions.get(pluginId) ?? [];
    list.push(unsubscribe);
    this.subscriptions.set(pluginId, list);
    return unsubscribe;
  }

  async emit(type: string, payload: unknown, source: string): Promise<void> {
    await this.eventBus.emit(type, payload, source);
  }

  unsubscribeAll(pluginId: string): void {
    for (const unsubscribe of this.subscriptions.get(pluginId) ?? []) {
      unsubscribe();
    }
    this.subscriptions.delete(pluginId);
  }
}

export function createPluginEventBridge(eventBus: EventBus): PluginEventBridge {
  return new PluginEventBridge(eventBus);
}
