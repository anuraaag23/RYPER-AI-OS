import { describe, expect, it } from "vitest";
import { CapabilityValidator } from "../src/capability-validator.js";
import type { CapabilityDescriptor } from "../src/types.js";

function descriptor(overrides: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor {
  return {
    domain: "notifications",
    name: "Notifications",
    description: "d",
    version: "1.0.0",
    ...overrides,
  };
}

describe("CapabilityValidator.validateDescriptor", () => {
  const validator = new CapabilityValidator();

  it("accepts a well-formed descriptor", () => {
    expect(validator.validateDescriptor(descriptor()).valid).toBe(true);
  });

  it("rejects an invalid domain string", () => {
    const result = validator.validateDescriptor(descriptor({ domain: "Not Valid!" }));
    expect(result.valid).toBe(false);
  });

  it("rejects an empty name or version", () => {
    expect(validator.validateDescriptor(descriptor({ name: "" })).valid).toBe(false);
    expect(validator.validateDescriptor(descriptor({ version: "" })).valid).toBe(false);
  });

  it("accepts dotted/underscored domain names", () => {
    expect(
      validator.validateDescriptor(descriptor({ domain: "custom.weather_widget" })).valid,
    ).toBe(true);
  });
});

describe("CapabilityValidator.validateParameters", () => {
  const validator = new CapabilityValidator();

  it("passes when the descriptor has no inputSchema", () => {
    expect(validator.validateParameters(descriptor(), { anything: "goes" }).valid).toBe(true);
  });

  it("validates parameters against the descriptor's inputSchema", () => {
    const d = descriptor({
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      },
    });
    expect(validator.validateParameters(d, {}).valid).toBe(false);
    expect(validator.validateParameters(d, { title: "hi" }).valid).toBe(true);
  });
});
