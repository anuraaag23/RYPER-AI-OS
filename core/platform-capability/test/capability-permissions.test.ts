import { describe, expect, it } from "vitest";
import { CapabilityPermissions } from "../src/capability-permissions.js";
import { CapabilityRegistry } from "../src/capability-registry.js";
import { buildCapabilityBroker } from "./helpers.js";

describe("CapabilityPermissions", () => {
  it("grants access when the domain has no requiredCapability", async () => {
    const registry = new CapabilityRegistry();
    registry.register({ domain: "notifications", name: "n", description: "d", version: "1.0.0" });
    const permissions = new CapabilityPermissions(
      buildCapabilityBroker(() => false),
      registry,
    );
    expect(await permissions.requestPermission("notifications", "actor-1", "test")).toBe(true);
    expect(permissions.checkPermission("notifications", "actor-1")).toBe(true);
  });

  it("requests and checks a capability-gated domain", async () => {
    const registry = new CapabilityRegistry();
    registry.register({
      domain: "camera",
      name: "Camera",
      description: "d",
      version: "1.0.0",
      requiredCapability: "camera",
    });
    const permissions = new CapabilityPermissions(
      buildCapabilityBroker(() => true),
      registry,
    );
    expect(await permissions.requestPermission("camera", "actor-1", "test")).toBe(true);
    expect(permissions.checkPermission("camera", "actor-1")).toBe(true);
  });

  it("reports a denied grant without throwing", async () => {
    const registry = new CapabilityRegistry();
    registry.register({
      domain: "camera",
      name: "Camera",
      description: "d",
      version: "1.0.0",
      requiredCapability: "camera",
    });
    const permissions = new CapabilityPermissions(
      buildCapabilityBroker(() => false),
      registry,
    );
    expect(await permissions.requestPermission("camera", "actor-1", "test")).toBe(false);
    expect(permissions.checkPermission("camera", "actor-1")).toBe(false);
  });

  it("lists available permissions for an actor", async () => {
    const registry = new CapabilityRegistry();
    registry.register({
      domain: "camera",
      name: "Camera",
      description: "d",
      version: "1.0.0",
      requiredCapability: "camera",
    });
    const permissions = new CapabilityPermissions(
      buildCapabilityBroker(() => true),
      registry,
    );
    await permissions.requestPermission("camera", "actor-1", "test");
    expect(permissions.availablePermissions("actor-1")).toEqual(["camera"]);
  });

  it("records permission diagnostics, filterable by actor", async () => {
    const registry = new CapabilityRegistry();
    registry.register({
      domain: "camera",
      name: "Camera",
      description: "d",
      version: "1.0.0",
      requiredCapability: "camera",
    });
    const permissions = new CapabilityPermissions(
      buildCapabilityBroker(() => true),
      registry,
    );
    await permissions.requestPermission("camera", "actor-1", "test");
    await permissions.requestPermission("camera", "actor-2", "test");
    expect(permissions.permissionDiagnostics("actor-1")).toHaveLength(1);
    expect(permissions.permissionDiagnostics()).toHaveLength(2);
  });
});
