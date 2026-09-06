import { describe, expect, it } from "vitest";
import { createLlamaCppProvider } from "../../src/runtime-providers/llama-cpp.js";
import { fakeTextFetch, routedFetch } from "./fixtures.js";
import type { StreamEvent } from "../../src/types.js";

async function collect(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

describe("createLlamaCppProvider", () => {
  it("advertises chat as its only supported model type", () => {
    const provider = createLlamaCppProvider(
      { id: "llama", baseUrl: "http://localhost:8080/v1" },
      fakeTextFetch(""),
    );
    expect(provider.supportedModelTypes).toEqual(["chat"]);
    expect(provider.kind).toBe("llama-cpp");
  });

  it("isAvailable() reflects whether the local server responds ok", async () => {
    const available = createLlamaCppProvider(
      { id: "llama", baseUrl: "http://localhost:8080/v1" },
      fakeTextFetch("{}", 200),
    );
    expect(await available.isAvailable()).toBe(true);

    const unavailable = createLlamaCppProvider(
      { id: "llama", baseUrl: "http://localhost:8080/v1" },
      fakeTextFetch("", 500),
    );
    expect(await unavailable.isAvailable()).toBe(false);
  });

  it("streams chat via the OpenAI-compatible SSE format", async () => {
    const sseBody = [
      'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      "",
    ].join("\n\n");
    const provider = createLlamaCppProvider(
      { id: "llama", baseUrl: "http://localhost:8080/v1" },
      routedFetch({ "/models": fakeTextFetch("{}") }, fakeTextFetch(sseBody)),
    );

    const events = await collect(
      provider.streamChat!("llama3-8b", { messages: [{ role: "user", content: "hi" }] }),
    );
    expect(events).toEqual([
      { type: "text_delta", delta: "hi" },
      { type: "done", finishReason: "stop" },
    ]);
  });
});
