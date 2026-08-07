import { describe, expect, it } from "vitest";
import { parseNDJSONStream } from "../../src/providers/ndjson.js";
import { toByteChunks } from "./fixtures.js";

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe("parseNDJSONStream", () => {
  it("parses one JSON object per line", async () => {
    const raw = '{"a":1}\n{"a":2}\n{"a":3}\n';
    const values = await collect(parseNDJSONStream(toByteChunks(raw, 3)));
    expect(values).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it("parses a trailing line with no final newline", async () => {
    const raw = '{"a":1}\n{"a":2}';
    const values = await collect(parseNDJSONStream(toByteChunks(raw, 4)));
    expect(values).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("skips blank lines", async () => {
    const raw = '{"a":1}\n\n{"a":2}\n';
    const values = await collect(parseNDJSONStream(toByteChunks(raw, 5)));
    expect(values).toEqual([{ a: 1 }, { a: 2 }]);
  });
});
