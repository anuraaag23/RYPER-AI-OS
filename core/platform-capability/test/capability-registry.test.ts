import { describe, expect, it } from "vitest";
import { CapabilityRegistrationError, CapabilityRegistry } from "../src/capability-registry.js";
import type { CapabilityDescriptor } from "../src/types.js";

function descriptor(overrides: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor {
  return {
    domain: "notifications",
    name: "Notifications",
    description: "Send system notifications",
    version: "1.0.0",
    ...overrides,
  };
}

describe("CapabilityRegistry", () => {
  it("registers and retrieves a descriptor", () => {
    const registry = new CapabilityRegistry();
    registry.register(descriptor());
    expect(registry.has("notifications")).toBe(true);
    expect(registry.get("notifications")?.name).toBe("Notifications");
    expect(registry.list()).toHaveLength(1);
  });

  it("rejects registering the same domain twice", () => {
    const registry = new CapabilityRegistry();
    registry.register(descriptor());
    expect(() => registry.register(descriptor())).toThrow(CapabilityRegistrationError);
  });

  it("allows registering a new abstract capability a plugin defines", () => {
    const registry = new CapabilityRegistry();
    registry.register(
      descriptor({ domain: "custom.weather_widget", name: "Weather Widget", version: "1.0.0" }),
    );
    expect(registry.has("custom.weather_widget")).toBe(true);
  });

  it("updates a descriptor's version in place", () => {
    const registry = new CapabilityRegistry();
    registry.register(descriptor({ version: "1.0.0" }));
    registry.update(descriptor({ version: "2.0.0" }));
    expect(registry.get("notifications")?.version).toBe("2.0.0");
  });

  it("unregisters a descriptor", () => {
    const registry = new CapabilityRegistry();
    registry.register(descriptor());
    expect(registry.unregister("notifications")).toBe(true);
    expect(registry.has("notifications")).toBe(false);
  });
});
