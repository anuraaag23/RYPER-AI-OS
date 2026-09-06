import { describe, expect, it } from "vitest";
import { createMlxRuntimeProvider, type MlxBinding } from "../../src/runtime-providers/mlx.js";
import type { StreamEvent } from "../../src/types.js";

async function collect(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

const fakeBinding: MlxBinding = {
  generateStream: async function* (_modelId, _prompt) {
    yield "Hel";
    yield "lo";
  },
  embed: async (_modelId, text) => [text.length],
};

describe("createMlxRuntimeProvider", () => {
  it("advertises chat and embedding support", () => {
    const provider = createMlxRuntimeProvider({
      id: "mlx",
      binding: fakeBinding,
      checkAvailable: async () => true,
    });
    expect(provider.supportedModelTypes).toEqual(["chat", "embedding"]);
    expect(provider.kind).toBe("mlx");
  });

  it("isAvailable() reflects the injected Apple Silicon check", async () => {
    const unavailable = createMlxRuntimeProvider({
      id: "mlx",
      binding: fakeBinding,
      checkAvailable: async () => false,
    });
    expect(await unavailable.isAvailable()).toBe(false);
  });

  it("streams chat as text_delta events terminated by a stop done event", async () => {
    const provider = createMlxRuntimeProvider({
      id: "mlx",
      binding: fakeBinding,
      checkAvailable: async () => true,
    });
    const events = await collect(
      provider.streamChat!("mlx-community/model", { messages: [{ role: "user", content: "hi" }] }),
    );
    expect(events).toEqual([
      { type: "text_delta", delta: "Hel" },
      { type: "text_delta", delta: "lo" },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("embed() delegates to the binding and wraps the result", async () => {
    const provider = createMlxRuntimeProvider({
      id: "mlx",
      binding: fakeBinding,
      checkAvailable: async () => true,
    });
    const result = await provider.embed!("mlx-embed", { text: "hello" });
    expect(result.vector).toEqual([5]);
  });
});
