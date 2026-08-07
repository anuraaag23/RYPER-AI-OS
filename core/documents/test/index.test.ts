import { describe, expect, it } from "vitest";
import { createDocumentEngine, DocumentEngine } from "../src/index.js";

describe("DocumentEngine", () => {
  it("comes with the built-in plain-text extractor registered", async () => {
    const engine = createDocumentEngine();
    expect(engine.has("extract-plain-text")).toBe(true);

    const output = await engine.run("extract-plain-text", {
      format: "txt",
      bytes: new TextEncoder().encode("hello world"),
    });
    expect(output.metadata?.extracted).toBe(true);
  });

  it("rejects registering the same transform name twice", () => {
    const engine = new DocumentEngine();
    engine.register("noop", (input) => input);
    expect(() => engine.register("noop", (input) => input)).toThrow();
  });

  it("throws a clear error for an unknown transform", async () => {
    const engine = new DocumentEngine();
    await expect(
      engine.run("does-not-exist", { format: "txt", bytes: new Uint8Array() }),
    ).rejects.toThrow(/no document transform/);
  });

  it("lists registered transform names", () => {
    const engine = createDocumentEngine();
    expect(engine.listTransforms()).toContain("extract-plain-text");
  });
});
