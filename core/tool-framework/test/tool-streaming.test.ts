import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { collectStreamData, consumeToolStream } from "../src/tool-streaming.js";
import type { ToolExecutionContext, ToolStreamExecutor } from "../src/types.js";

function context(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return { invocationId: "inv-1", actorId: "a", sessionId: "s", platform: "windows", ...overrides };
}

async function* words(): AsyncGenerator<string> {
  yield "hello";
  yield "world";
}

describe("consumeToolStream", () => {
  it("collects every chunk plus a trailing done chunk, in sequence order", async () => {
    const chunks = await consumeToolStream(words as ToolStreamExecutor, {}, context());
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({ sequence: 1, data: "hello", done: false });
    expect(chunks[1]).toMatchObject({ sequence: 2, data: "world", done: false });
    expect(chunks[2]).toMatchObject({ sequence: 3, done: true });
  });

  it("calls the onChunk callback for every chunk including the done marker", async () => {
    const seen: unknown[] = [];
    await consumeToolStream(words as ToolStreamExecutor, {}, context(), {
      onChunk: (chunk) => seen.push(chunk),
    });
    expect(seen).toHaveLength(3);
  });

  it("emits tool.stream.chunk events on the event bus", async () => {
    const bus = new EventBus();
    const received: unknown[] = [];
    bus.subscribe({ type: "tool.stream.chunk" }, (event) => received.push(event.payload));
    await consumeToolStream(words as ToolStreamExecutor, {}, context(), { eventBus: bus });
    expect(received).toHaveLength(3);
  });

  it("stops consuming once the context signal is aborted", async () => {
    const controller = new AbortController();
    let yielded = 0;
    async function* infinite(): AsyncGenerator<string> {
      while (true) {
        yielded += 1;
        yield `chunk-${yielded}`;
        if (yielded === 1) controller.abort();
      }
    }
    const chunks = await consumeToolStream(
      infinite as ToolStreamExecutor,
      {},
      context({ signal: controller.signal }),
    );
    // one real chunk consumed before the abort was observed, plus the trailing done marker
    expect(chunks.filter((c) => !c.done)).toHaveLength(1);
  });
});

describe("collectStreamData", () => {
  it("extracts only the non-done chunk payloads in order", async () => {
    const chunks = await consumeToolStream(words as ToolStreamExecutor, {}, context());
    expect(collectStreamData(chunks)).toEqual(["hello", "world"]);
  });
});
