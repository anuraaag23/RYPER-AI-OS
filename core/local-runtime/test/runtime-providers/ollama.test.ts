import { describe, expect, it } from "vitest";
import { createOllamaRuntimeProvider } from "../../src/runtime-providers/ollama.js";
import { fakeTextFetch, routedFetch } from "./fixtures.js";
import type { StreamEvent } from "../../src/types.js";

async function collect(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

describe("createOllamaRuntimeProvider", () => {
  it("advertises chat and embedding support", () => {
    const provider = createOllamaRuntimeProvider(
      { id: "ollama", baseUrl: "http://localhost:11434" },
      fakeTextFetch(""),
    );
    expect(provider.supportedModelTypes).toEqual(["chat", "embedding"]);
    expect(provider.kind).toBe("ollama");
  });

  it("isAvailable() checks /api/tags", async () => {
    const available = createOllamaRuntimeProvider(
      { id: "ollama", baseUrl: "http://localhost:11434" },
      fakeTextFetch("{}", 200),
    );
    expect(await available.isAvailable()).toBe(true);
  });

  it("streams chat via the NDJSON format", async () => {
    const ndjsonBody = [
      '{"message":{"content":"hi"},"done":false}',
      '{"done":true,"done_reason":"stop"}',
      "",
    ].join("\n");
    const provider = createOllamaRuntimeProvider(
      { id: "ollama", baseUrl: "http://localhost:11434" },
      routedFetch({ "/api/tags": fakeTextFetch("{}") }, fakeTextFetch(ndjsonBody)),
    );

    const events = await collect(
      provider.streamChat!("llama3", { messages: [{ role: "user", content: "hi" }] }),
    );
    expect(events).toEqual([
      { type: "text_delta", delta: "hi" },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("embed() calls /api/embeddings and returns the vector", async () => {
    const provider = createOllamaRuntimeProvider(
      { id: "ollama", baseUrl: "http://localhost:11434" },
      routedFetch(
        { "/api/embeddings": fakeTextFetch('{"embedding":[0.1,0.2,0.3]}') },
        fakeTextFetch("{}"),
      ),
    );

    const result = await provider.embed!("nomic-embed-text", { text: "hello" });
    expect(result.vector).toEqual([0.1, 0.2, 0.3]);
  });
});
