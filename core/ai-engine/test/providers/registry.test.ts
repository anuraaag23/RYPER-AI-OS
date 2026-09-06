import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "../../src/providers/registry.js";
import type { AIProvider } from "../../src/types.js";

function fakeProvider(id: string, kind: AIProvider["kind"]): AIProvider {
  return { id, kind, streamChat: async function* () {} };
}

describe("ProviderRegistry", () => {
  it("registers and retrieves providers by id", () => {
    const registry = new ProviderRegistry();
    registry.register(fakeProvider("p1", "local"));
    expect(registry.get("p1").id).toBe("p1");
  });

  it("rejects registering the same id twice", () => {
    const registry = new ProviderRegistry();
    registry.register(fakeProvider("p1", "local"));
    expect(() => registry.register(fakeProvider("p1", "local"))).toThrow();
  });

  it("throws a clear error for an unknown provider id", () => {
    const registry = new ProviderRegistry();
    expect(() => registry.get("missing")).toThrow(/no provider registered/);
  });

  it("lists providers filtered by kind", () => {
    const registry = new ProviderRegistry();
    registry.register(fakeProvider("openai", "openai-compatible"));
    registry.register(fakeProvider("local", "local"));
    expect(registry.listByKind("local")).toHaveLength(1);
    expect(registry.listByKind("openai-compatible")).toHaveLength(1);
    expect(registry.list()).toHaveLength(2);
  });
});
