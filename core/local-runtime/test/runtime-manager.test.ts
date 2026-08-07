import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import type { AIProvider, StreamEvent } from "@ryper/ai-engine";

import { ModelRegistry } from "../src/model-registry.js";
import { ModelSelector } from "../src/model-selection-policy.js";
import { RuntimeHealthMonitor } from "../src/health-monitor.js";
import { ModelCache } from "../src/model-cache.js";
import { InMemoryFileSystem } from "../src/filesystem.js";
import { InferenceQueue } from "../src/inference-queue.js";
import {
  LocalRuntimeManager,
  MissingModelError,
  AllProvidersFailedError,
} from "../src/runtime-manager.js";
import type { LocalRuntimeProvider } from "../src/types.js";
import { sampleModel, sampleDevice } from "./fixtures.js";

function install(
  registry: ModelRegistry,
  id: string,
  runtime: LocalRuntimeProvider["kind"],
  type: "chat" | "embedding" = "chat",
) {
  const metadata = sampleModel({ id, runtime, type, runtimeModelId: `${id}-runtime` });
  registry.markInstalled({
    metadata,
    localPath: `/x/${id}`,
    installedAt: "now",
    sizeBytes: 1,
    active: true,
  });
}

function textProvider(
  id: string,
  kind: LocalRuntimeProvider["kind"],
  chunks: string[],
  fail = false,
): LocalRuntimeProvider {
  return {
    id,
    kind,
    supportedModelTypes: ["chat"],
    isAvailable: async () => true,
    async *streamChat(): AsyncIterable<StreamEvent> {
      if (fail) throw new Error(`${id} is down`);
      for (const c of chunks) yield { type: "text_delta", delta: c };
      yield { type: "done", finishReason: "stop" };
    },
  };
}

function buildManager(opts: {
  providers: LocalRuntimeProvider[];
  registry?: ModelRegistry;
  cloudChatFallback?: AIProvider;
  eventBus?: EventBus;
}) {
  const registry = opts.registry ?? new ModelRegistry();
  const fs = new InMemoryFileSystem();
  return new LocalRuntimeManager({
    registry: new ModelSelector(registry),
    providers: opts.providers,
    healthMonitor: new RuntimeHealthMonitor(2, 3),
    queue: new InferenceQueue(4),
    cache: new ModelCache(registry, fs, 1_000_000),
    ...(opts.eventBus ? { eventBus: opts.eventBus } : {}),
    ...(opts.cloudChatFallback ? { cloudChatFallback: opts.cloudChatFallback } : {}),
  });
}

async function collect(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

describe("LocalRuntimeManager.streamChat", () => {
  it("streams from the first eligible local provider", async () => {
    const registry = new ModelRegistry();
    install(registry, "chat-a", "ollama");
    const manager = buildManager({
      providers: [textProvider("ollama-1", "ollama", ["hi"])],
      registry,
    });

    const events = await collect(
      manager.streamChat(
        { messages: [{ role: "user", content: "hi" }] },
        { device: sampleDevice() },
      ),
    );
    expect(events).toEqual([
      { type: "text_delta", delta: "hi" },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("throws MissingModelError when nothing is installed for the task type", async () => {
    const manager = buildManager({ providers: [textProvider("ollama-1", "ollama", ["hi"])] });
    await expect(
      collect(manager.streamChat({ messages: [] }, { device: sampleDevice() })),
    ).rejects.toThrow(MissingModelError);
  });

  it("falls back to a second local runtime when the first fails before streaming anything", async () => {
    const registry = new ModelRegistry();
    install(registry, "chat-a", "llama-cpp");
    install(registry, "chat-b", "ollama");
    const manager = buildManager({
      providers: [
        textProvider("llama-1", "llama-cpp", [], true),
        textProvider("ollama-1", "ollama", ["recovered"]),
      ],
      registry,
    });

    const events = await collect(
      manager.streamChat(
        { messages: [{ role: "user", content: "hi" }] },
        { device: sampleDevice() },
      ),
    );
    expect(events).toContainEqual({ type: "text_delta", delta: "recovered" });
  });

  it("falls back to cloud only after every local candidate fails, and only for chat", async () => {
    const registry = new ModelRegistry();
    install(registry, "chat-a", "ollama");
    const cloudProvider: AIProvider = {
      id: "cloud",
      kind: "anthropic-compatible",
      streamChat: async function* () {
        yield { type: "text_delta", delta: "from cloud" };
        yield { type: "done", finishReason: "stop" };
      },
    };
    const eventBus = new EventBus();
    let fellBack = false;
    eventBus.on("local_runtime.fallback_to_cloud", () => {
      fellBack = true;
    });

    const manager = buildManager({
      providers: [textProvider("ollama-1", "ollama", [], true)],
      registry,
      cloudChatFallback: cloudProvider,
      eventBus,
    });

    const events = await collect(
      manager.streamChat(
        { messages: [{ role: "user", content: "hi" }] },
        { device: sampleDevice() },
      ),
    );
    expect(events).toContainEqual({ type: "text_delta", delta: "from cloud" });
    expect(fellBack).toBe(true);
  });

  it("throws AllProvidersFailedError when every local candidate fails and there is no cloud fallback", async () => {
    const registry = new ModelRegistry();
    install(registry, "chat-a", "ollama");
    const manager = buildManager({
      providers: [textProvider("ollama-1", "ollama", [], true)],
      registry,
    });

    await expect(
      collect(
        manager.streamChat(
          { messages: [{ role: "user", content: "hi" }] },
          { device: sampleDevice() },
        ),
      ),
    ).rejects.toThrow(AllProvidersFailedError);
  });

  it("skips a provider the health monitor has marked unavailable", async () => {
    const registry = new ModelRegistry();
    install(registry, "chat-a", "llama-cpp");
    install(registry, "chat-b", "ollama");

    const healthMonitor = new RuntimeHealthMonitor(1, 1);
    healthMonitor.recordFailure("llama-1"); // one failure trips "unavailable" at threshold 1

    const fs = new InMemoryFileSystem();
    const manager = new LocalRuntimeManager({
      registry: new ModelSelector(registry),
      providers: [
        textProvider("llama-1", "llama-cpp", ["should be skipped"]),
        textProvider("ollama-1", "ollama", ["used instead"]),
      ],
      healthMonitor,
      queue: new InferenceQueue(4),
      cache: new ModelCache(registry, fs, 1_000_000),
    });

    const events = await collect(
      manager.streamChat(
        { messages: [{ role: "user", content: "hi" }] },
        { device: sampleDevice() },
      ),
    );
    expect(events).toContainEqual({ type: "text_delta", delta: "used instead" });
  });
});

describe("LocalRuntimeManager single-shot tasks", () => {
  it("embed() falls back across providers and reports embedding results", async () => {
    const registry = new ModelRegistry();
    install(registry, "embed-a", "onnx", "embedding");

    const provider: LocalRuntimeProvider = {
      id: "onnx-1",
      kind: "onnx",
      supportedModelTypes: ["embedding"],
      isAvailable: async () => true,
      embed: async (_modelId, request) => ({ vector: [request.text.length] }),
    };

    const manager = buildManager({ providers: [provider], registry });
    const result = await manager.embed({ text: "hello" }, { device: sampleDevice() });
    expect(result.vector).toEqual([5]);
  });

  it("throws MissingModelError for a task type with no installed model", async () => {
    const manager = buildManager({ providers: [] });
    await expect(manager.embed({ text: "hi" }, { device: sampleDevice() })).rejects.toThrow(
      MissingModelError,
    );
  });
});

describe("LocalRuntimeManager.toAIProvider", () => {
  it("wraps streamChat into a valid AIProvider the Core AI Engine can register directly", async () => {
    const registry = new ModelRegistry();
    install(registry, "chat-a", "ollama");
    const manager = buildManager({
      providers: [textProvider("ollama-1", "ollama", ["wrapped"])],
      registry,
    });

    const aiProvider = manager.toAIProvider("local-wrapper", { device: sampleDevice() });
    expect(aiProvider.kind).toBe("local");
    const events = await collect(
      aiProvider.streamChat({ messages: [{ role: "user", content: "hi" }] }),
    );
    expect(events).toContainEqual({ type: "text_delta", delta: "wrapped" });
  });
});
