import { describe, expect, it } from "vitest";
import { ModelRouter } from "@ryper/model-router";
import { ProviderRegistry } from "../src/providers/registry.js";
import { ModelSelectionEngine } from "../src/model-selection.js";
import type { AIProvider } from "../src/types.js";

function fakeProvider(id: string, kind: AIProvider["kind"]): AIProvider {
  return { id, kind, streamChat: async function* () {} };
}

describe("ModelSelectionEngine", () => {
  it("picks a local provider when the router decides local", () => {
    const registry = new ProviderRegistry();
    registry.register(fakeProvider("local-1", "local"));
    registry.register(fakeProvider("cloud-1", "anthropic-compatible"));
    const engine = new ModelSelectionEngine(new ModelRouter(), registry);

    const result = engine.select({ hint: "auto", device: { online: false } });
    expect(result.provider.id).toBe("local-1");
    expect(result.decision.target).toBe("local");
  });

  it("picks a cloud provider when the router decides cloud", () => {
    const registry = new ProviderRegistry();
    registry.register(fakeProvider("local-1", "local"));
    registry.register(fakeProvider("cloud-1", "anthropic-compatible"));
    const engine = new ModelSelectionEngine(new ModelRouter(), registry);

    const result = engine.select({
      hint: "auto",
      device: { online: true },
      requiresWebSearch: true,
    });
    expect(result.provider.id).toBe("cloud-1");
  });

  it("honors a preferred provider that agrees with the routing decision", () => {
    const registry = new ProviderRegistry();
    registry.register(fakeProvider("cloud-openai", "openai-compatible"));
    registry.register(fakeProvider("cloud-anthropic", "anthropic-compatible"));
    const engine = new ModelSelectionEngine(new ModelRouter(), registry);

    const result = engine.select({
      hint: "auto",
      device: { online: true },
      requiresWebSearch: true,
      preferredProviderId: "cloud-openai",
    });
    expect(result.provider.id).toBe("cloud-openai");
  });

  it("falls back to an eligible default when the preferred provider contradicts the routing decision", () => {
    const registry = new ProviderRegistry();
    registry.register(fakeProvider("local-1", "local"));
    registry.register(fakeProvider("cloud-1", "anthropic-compatible"));
    const engine = new ModelSelectionEngine(new ModelRouter(), registry);

    // Offline forces "local", but the caller asked for a cloud provider.
    const result = engine.select({
      hint: "auto",
      device: { online: false },
      preferredProviderId: "cloud-1",
    });
    expect(result.provider.id).toBe("local-1");
  });

  it("throws when no provider can serve the decided target", () => {
    const registry = new ProviderRegistry();
    registry.register(fakeProvider("cloud-1", "anthropic-compatible"));
    const engine = new ModelSelectionEngine(new ModelRouter(), registry);

    expect(() => engine.select({ hint: "auto", device: { online: false } })).toThrow(
      /no provider registered/,
    );
  });
});
