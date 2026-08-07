import { EventBus } from "@ryper/event-bus";
import { ModelRouter, type ModelProvider, type DeviceState } from "@ryper/model-router";
import { LongTermMemory } from "@ryper/memory";
import { VectorStore } from "@ryper/rag";
import { ConversationEngine } from "@ryper/conversation";
import { createLogger } from "@ryper/logging";

const log = createLogger("web-shell");

export interface WebShellDeps {
  /** Injected so tests (and non-browser builds) don't require a `navigator` global. */
  readonly readOnlineStatus?: () => boolean;
  readonly localModel?: ModelProvider;
  readonly cloudModel?: ModelProvider;
}

export interface WebShell {
  readonly conversation: ConversationEngine;
  readonly eventBus: EventBus;
  getDeviceState(): DeviceState;
}

function defaultOnlineReader(): boolean {
  const nav = (globalThis as { navigator?: { onLine?: unknown } }).navigator;
  if (nav && typeof nav.onLine === "boolean") {
    return nav.onLine;
  }
  return true; // Node/SSR context: assume online, platform shell overrides at runtime.
}

const defaultLocalModel: ModelProvider = {
  id: "local-placeholder",
  target: "local",
  generate: async (prompt) => `[local model] ${prompt}`,
};

const defaultCloudModel: ModelProvider = {
  id: "cloud-placeholder",
  target: "cloud",
  generate: async (prompt) => `[cloud model] ${prompt}`,
};

/**
 * Wires the Core services (event bus, model router, memory, RAG,
 * conversation engine) into a single object the web UI layer consumes. Real
 * model providers are injected by the app entry point — this bootstrap
 * ships safe echo providers so the shell is runnable and testable before
 * any model backend is wired in.
 */
export function createWebShell(deps: WebShellDeps = {}): WebShell {
  const readOnlineStatus = deps.readOnlineStatus ?? defaultOnlineReader;
  const eventBus = new EventBus();
  const router = new ModelRouter(eventBus);
  router.registerProvider(deps.localModel ?? defaultLocalModel);
  router.registerProvider(deps.cloudModel ?? defaultCloudModel);

  const longTerm = new LongTermMemory();
  const vectorStore = new VectorStore(async (text) => [text.length]);
  const conversation = new ConversationEngine(router, longTerm, vectorStore, eventBus);

  log.info("web shell initialized");

  return {
    conversation,
    eventBus,
    getDeviceState: () => ({ online: readOnlineStatus() }),
  };
}
