import { describe, expect, it } from "vitest";
import {
  builtinTools,
  getCurrentTimeTool,
  textEchoStreamTool,
  textTransformTool,
} from "../src/builtin-tools.js";
import { ToolValidator } from "../src/tool-validator.js";
import type { ToolExecutionContext } from "../src/types.js";

const context: ToolExecutionContext = {
  invocationId: "i1",
  actorId: "a",
  sessionId: "s",
  platform: "windows",
};
const validator = new ToolValidator();

describe("builtinTools", () => {
  it("exposes exactly the three reference tools, each with a unique id", () => {
    expect(builtinTools).toHaveLength(3);
    const ids = new Set(builtinTools.map((t) => t.spec.id));
    expect(ids.size).toBe(3);
  });
});

describe("getCurrentTimeTool", () => {
  it("returns a value that satisfies its own output schema", async () => {
    const value = await getCurrentTimeTool.execute({}, context);
    expect(validator.validateOutput(getCurrentTimeTool.spec.outputSchema, value).valid).toBe(true);
    expect((value as { iso: string }).iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("textTransformTool", () => {
  it("uppercases, lowercases, and reverses correctly", async () => {
    expect(
      await textTransformTool.execute({ text: "abc", operation: "uppercase" }, context),
    ).toEqual({
      result: "ABC",
    });
    expect(
      await textTransformTool.execute({ text: "ABC", operation: "lowercase" }, context),
    ).toEqual({
      result: "abc",
    });
    expect(await textTransformTool.execute({ text: "abc", operation: "reverse" }, context)).toEqual(
      {
        result: "cba",
      },
    );
  });

  it("rejects an operation outside its input schema's enum before execution would even matter", () => {
    const validation = validator.validateInput(textTransformTool.spec.inputSchema, {
      text: "abc",
      operation: "sideways",
    });
    expect(validation.valid).toBe(false);
  });
});

describe("textEchoStreamTool", () => {
  it("streams one chunk per word via executeStream", async () => {
    const chunks: string[] = [];
    for await (const word of textEchoStreamTool.executeStream!(
      { text: "hello there world" },
      context,
    )) {
      chunks.push(word as string);
    }
    expect(chunks).toEqual(["hello", "there", "world"]);
  });

  it("stops yielding once the context signal is aborted", async () => {
    const controller = new AbortController();
    const chunks: string[] = [];
    for await (const word of textEchoStreamTool.executeStream!(
      { text: "one two three" },
      { ...context, signal: controller.signal },
    )) {
      chunks.push(word as string);
      controller.abort();
    }
    expect(chunks).toEqual(["one"]);
  });

  it("its non-streaming execute() fallback also splits into words", async () => {
    const value = await textEchoStreamTool.execute({ text: "a b" }, context);
    expect(value).toEqual(["a", "b"]);
  });
});
