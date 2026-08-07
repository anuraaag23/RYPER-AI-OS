import { describe, expect, it } from "vitest";
import { parseSSEStream } from "../../src/providers/sse.js";
import { toByteChunks } from "./fixtures.js";

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe("parseSSEStream", () => {
  it("parses multiple data-only events separated by blank lines", async () => {
    const raw = 'data: {"a":1}\n\ndata: {"a":2}\n\n';
    const messages = await collect(parseSSEStream(toByteChunks(raw, 5)));
    expect(messages).toEqual([
      { event: undefined, data: '{"a":1}' },
      { event: undefined, data: '{"a":2}' },
    ]);
  });

  it("captures an event: line alongside data:", async () => {
    const raw = "event: ping\ndata: hello\n\n";
    const messages = await collect(parseSSEStream(toByteChunks(raw, 6)));
    expect(messages).toEqual([{ event: "ping", data: "hello" }]);
  });

  it("joins multi-line data: fields with newlines", async () => {
    const raw = "data: line one\ndata: line two\n\n";
    const messages = await collect(parseSSEStream(toByteChunks(raw, 8)));
    expect(messages[0]?.data).toBe("line one\nline two");
  });

  it("handles a trailing event with no final blank line", async () => {
    const raw = "data: only-one";
    const messages = await collect(parseSSEStream(toByteChunks(raw, 4)));
    expect(messages).toEqual([{ event: undefined, data: "only-one" }]);
  });

  it("ignores chunk boundaries splitting a field in the middle", async () => {
    const raw = "data: split-across-chunks\n\n";
    for (const size of [1, 2, 3, 100]) {
      const messages = await collect(parseSSEStream(toByteChunks(raw, size)));
      expect(messages).toEqual([{ event: undefined, data: "split-across-chunks" }]);
    }
  });
});
