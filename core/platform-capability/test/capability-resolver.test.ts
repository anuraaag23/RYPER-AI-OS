import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../src/capability-registry.js";
import { CapabilityResolver } from "../src/capability-resolver.js";
import { buildMockAdapter } from "./helpers.js";

describe("CapabilityResolver", () => {
  it("reports a supported domain with no reason attached", () => {
    const resolver = new CapabilityResolver(new CapabilityRegistry());
    const adapter = buildMockAdapter({ supportedDomains: ["notifications"] });
    const status = resolver.resolve("notifications", adapter);
    expect(status).toEqual({ domain: "notifications", supported: true });
  });

  it("reports an unsupported domain with a reason", () => {
    const resolver = new CapabilityResolver(new CapabilityRegistry());
    const adapter = buildMockAdapter({ supportedDomains: [] });
    const status = resolver.resolve("bluetooth", adapter);
    expect(status.supported).toBe(false);
    expect(status.reason).toContain("bluetooth");
    expect(status.reason).toContain(adapter.platform);
  });

  it("suggests a supported alternative when one exists in the fallback hints", () => {
    const resolver = new CapabilityResolver(new CapabilityRegistry());
    const adapter = buildMockAdapter({ supportedDomains: ["wifi"] });
    const status = resolver.resolve("bluetooth", adapter);
    expect(status.suggestedAlternative).toBe("wifi");
  });

  it("omits suggestedAlternative when the hinted fallback isn't supported either", () => {
    const resolver = new CapabilityResolver(new CapabilityRegistry());
    const adapter = buildMockAdapter({ supportedDomains: [] });
    const status = resolver.resolve("bluetooth", adapter);
    expect(status.suggestedAlternative).toBeUndefined();
  });

  it("resolves a batch of domains at once", () => {
    const resolver = new CapabilityResolver(new CapabilityRegistry());
    const adapter = buildMockAdapter({ supportedDomains: ["notifications"] });
    const statuses = resolver.resolveAll(["notifications", "bluetooth"], adapter);
    expect(statuses.map((s) => s.supported)).toEqual([true, false]);
  });

  it("supportedDomains filters the registry's domains down to what the adapter supports", () => {
    const registry = new CapabilityRegistry();
    registry.register({ domain: "notifications", name: "n", description: "d", version: "1.0.0" });
    registry.register({ domain: "bluetooth", name: "b", description: "d", version: "1.0.0" });
    const resolver = new CapabilityResolver(registry);
    const adapter = buildMockAdapter({ supportedDomains: ["notifications"] });
    expect(resolver.supportedDomains(adapter)).toEqual(["notifications"]);
  });
});
