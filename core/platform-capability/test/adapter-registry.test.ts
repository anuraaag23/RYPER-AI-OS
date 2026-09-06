import { describe, expect, it } from "vitest";
import { AdapterRegistrationError, AdapterRegistry } from "../src/adapter-registry.js";
import { buildMockAdapter } from "./helpers.js";

describe("AdapterRegistry", () => {
  it("registers and retrieves an adapter by platform", () => {
    const registry = new AdapterRegistry();
    const adapter = buildMockAdapter({ platform: "windows" });
    registry.register(adapter);
    expect(registry.get("windows")).toBe(adapter);
    expect(registry.has("windows")).toBe(true);
    expect(registry.list()).toEqual([adapter]);
    expect(registry.registeredPlatforms()).toEqual(["windows"]);
  });

  it("rejects registering a second adapter for the same platform", () => {
    const registry = new AdapterRegistry();
    registry.register(buildMockAdapter({ platform: "windows" }));
    expect(() => registry.register(buildMockAdapter({ platform: "windows" }))).toThrow(
      AdapterRegistrationError,
    );
  });

  it("allows replacing an already-registered adapter", () => {
    const registry = new AdapterRegistry();
    registry.register(
      buildMockAdapter({ platform: "windows", supportedDomains: ["notifications"] }),
    );
    const replacement = buildMockAdapter({ platform: "windows", supportedDomains: ["clipboard"] });
    registry.replace(replacement);
    expect(registry.get("windows")).toBe(replacement);
  });

  it("unregisters an adapter", () => {
    const registry = new AdapterRegistry();
    registry.register(buildMockAdapter({ platform: "windows" }));
    expect(registry.unregister("windows")).toBe(true);
    expect(registry.has("windows")).toBe(false);
    expect(registry.unregister("windows")).toBe(false);
  });
});
