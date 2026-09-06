import { describe, expect, it } from "vitest";
import type { InferenceContext, LocalRuntimeManager } from "../../src/runtime-manager.js";
import { createLocalRuntimeAIProvider } from "../../src/runtime-providers/ai-provider-adapter.js";

const context: InferenceContext = {
  device: {
    cpuCores: 4,
    totalRamGB: 8,
    freeRamGB: 4,
    hasGpu: false,
    platform: "linux",
    isAppleSilicon: false,
  },
};

describe("createLocalRuntimeAIProvider", () => {
  it("exposes the given id and kind 'local'", () => {
    const fakeManager = { streamChat: async function* () {} } as unknown as LocalRuntimeManager;
    const provider = createLocalRuntimeAIProvider("test-id", fakeManager, context);
    expect(provider.id).toBe("test-id");
    expect(provider.kind).toBe("local");
  });

  it("delegates streamChat() to the real LocalRuntimeManager.streamChat(), forwarding the request and context", async () => {
    let capturedRequest: unknown;
    let capturedContext: unknown;
    const fakeManager = {
      streamChat: async function* (request: unknown, ctx: unknown) {
        capturedRequest = request;
        capturedContext = ctx;
        yield { type: "text_delta", delta: "hello" };
      },
    } as unknown as LocalRuntimeManager;

    const provider = createLocalRuntimeAIProvider("test-id", fakeManager, context);
    const events = [];
    for await (const event of provider.streamChat({
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "text_delta", delta: "hello" }]);
    expect(capturedRequest).toEqual({ messages: [{ role: "user", content: "hi" }] });
    expect(capturedContext).toMatchObject({ device: context.device });
  });

  it("forwards the request's AbortSignal into the InferenceContext", async () => {
    let capturedContext: InferenceContext | undefined;
    const fakeManager = {
      streamChat: async function* (_request: unknown, ctx: InferenceContext) {
        capturedContext = ctx;
        yield* [];
      },
    } as unknown as LocalRuntimeManager;

    const provider = createLocalRuntimeAIProvider("test-id", fakeManager, context);
    const controller = new AbortController();
    for await (const _event of provider.streamChat({
      messages: [{ role: "user", content: "hi" }],
      signal: controller.signal,
    })) {
      // consume
    }

    expect(capturedContext?.signal).toBe(controller.signal);
  });
});
