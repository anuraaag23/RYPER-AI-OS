import { describe, expect, it } from "vitest";
import { ToolValidator } from "../src/tool-validator.js";
import type { JsonSchema } from "../src/types.js";

describe("ToolValidator", () => {
  const validator = new ToolValidator();

  it("validates a matching primitive type", () => {
    expect(validator.validate({ type: "string" }, "hello").valid).toBe(true);
    expect(validator.validate({ type: "string" }, 5).valid).toBe(false);
  });

  it("accepts an integer for a number schema but flags a float for an integer schema", () => {
    expect(validator.validate({ type: "number" }, 3.5).valid).toBe(true);
    expect(validator.validate({ type: "integer" }, 3.5).valid).toBe(false);
    expect(validator.validate({ type: "integer" }, 3).valid).toBe(true);
  });

  it("enforces required object properties", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { text: { type: "string" }, operation: { type: "string" } },
      required: ["text", "operation"],
    };
    const result = validator.validate(schema, { text: "hi" });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("operation");
  });

  it("validates nested object properties recursively", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        user: { type: "object", properties: { age: { type: "number" } }, required: ["age"] },
      },
      required: ["user"],
    };
    expect(validator.validateInput(schema, { user: { age: "not a number" } }).valid).toBe(false);
    expect(validator.validateInput(schema, { user: { age: 30 } }).valid).toBe(true);
  });

  it("validates array items", () => {
    const schema: JsonSchema = { type: "array", items: { type: "string" } };
    expect(validator.validateOutput(schema, ["a", "b"]).valid).toBe(true);
    expect(validator.validateOutput(schema, ["a", 2]).valid).toBe(false);
  });

  it("enforces enum membership", () => {
    const schema: JsonSchema = { type: "string", enum: ["uppercase", "lowercase"] };
    expect(validator.validate(schema, "uppercase").valid).toBe(true);
    expect(validator.validate(schema, "sideways").valid).toBe(false);
  });

  it("enforces string length and numeric bounds", () => {
    expect(validator.validate({ type: "string", minLength: 3 }, "ab").valid).toBe(false);
    expect(validator.validate({ type: "string", maxLength: 3 }, "abcd").valid).toBe(false);
    expect(validator.validate({ type: "number", minimum: 0, maximum: 10 }, -1).valid).toBe(false);
    expect(validator.validate({ type: "number", minimum: 0, maximum: 10 }, 5).valid).toBe(true);
  });
});
