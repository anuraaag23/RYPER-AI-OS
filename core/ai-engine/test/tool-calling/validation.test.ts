import { describe, expect, it } from "vitest";
import type { ToolParameterSchema } from "../../src/types.js";
import {
  describeInvalidToolCall,
  validateToolArguments,
} from "../../src/tool-calling/validation.js";

const volumeSchema: ToolParameterSchema = {
  type: "object",
  properties: {
    percent: { type: "number", description: "Target volume", minimum: 0, maximum: 100 },
  },
  required: ["percent"],
};

describe("validateToolArguments", () => {
  it("accepts arguments that match the schema", () => {
    const result = validateToolArguments(volumeSchema, { percent: 30 });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects an out-of-range numeric argument — the brief's exact set_volume(500) example", () => {
    const result = validateToolArguments(volumeSchema, { percent: 500 });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("must be <= 100");
  });

  it("rejects a below-minimum numeric argument", () => {
    const result = validateToolArguments(volumeSchema, { percent: -10 });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("must be >= 0");
  });

  it("rejects a missing required argument", () => {
    const result = validateToolArguments(volumeSchema, {});
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('missing required argument "percent"');
  });

  it("rejects a wrong-typed argument", () => {
    const result = validateToolArguments(volumeSchema, { percent: "thirty" });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("must be of type number");
  });

  it("rejects an unknown/hallucinated argument rather than silently ignoring it", () => {
    const result = validateToolArguments(volumeSchema, { percent: 30, sudo: true });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown argument "sudo"'))).toBe(true);
  });

  it("enforces enum constraints", () => {
    const schema: ToolParameterSchema = {
      type: "object",
      properties: { mode: { type: "string", enum: ["light", "dark", "system"] } },
      required: ["mode"],
    };
    expect(validateToolArguments(schema, { mode: "light" }).ok).toBe(true);
    expect(validateToolArguments(schema, { mode: "ultraviolet" }).ok).toBe(false);
  });

  it("enforces string length constraints", () => {
    const schema: ToolParameterSchema = {
      type: "object",
      properties: { query: { type: "string", minLength: 1, maxLength: 5 } },
      required: ["query"],
    };
    expect(validateToolArguments(schema, { query: "" }).ok).toBe(false);
    expect(validateToolArguments(schema, { query: "toolong" }).ok).toBe(false);
    expect(validateToolArguments(schema, { query: "ok" }).ok).toBe(true);
  });

  it("enforces integer vs. plain number distinction", () => {
    const schema: ToolParameterSchema = {
      type: "object",
      properties: { count: { type: "integer" } },
      required: ["count"],
    };
    expect(validateToolArguments(schema, { count: 3 }).ok).toBe(true);
    expect(validateToolArguments(schema, { count: 3.5 }).ok).toBe(false);
  });

  it("accepts a tool with no parameters and empty arguments", () => {
    const schema: ToolParameterSchema = { type: "object", properties: {} };
    expect(validateToolArguments(schema, {}).ok).toBe(true);
  });

  it("treats null/undefined values as absent, caught by the required check instead of a type error", () => {
    const result = validateToolArguments(volumeSchema, { percent: undefined });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("missing required argument");
  });
});

describe("describeInvalidToolCall", () => {
  it("formats a human-readable error including the tool name", () => {
    const result = validateToolArguments(volumeSchema, { percent: 500 });
    const message = describeInvalidToolCall(
      { id: "call-1", name: "set_volume", arguments: { percent: 500 } },
      result,
    );
    expect(message).toContain('tool "set_volume"');
    expect(message).toContain("must be <= 100");
  });
});
