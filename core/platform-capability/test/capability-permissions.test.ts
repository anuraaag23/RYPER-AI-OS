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

  it("resolves fine-grained operationCapabilities when specified", async () => {
    const registry = new CapabilityRegistry();
    registry.register({
      domain: "filesystem",
      name: "Filesystem",
      description: "d",
      version: "1.0.0",
      requiredCapability: "filesystem.write",
      operationCapabilities: {
        list: "filesystem.read",
        read: "filesystem.read",
        write: "filesystem.write",
      },
    });
    const broker = buildCapabilityBroker((req) => req.capability === "filesystem.read");
    const permissions = new CapabilityPermissions(broker, registry);

    // list requests filesystem.read, which broker approves
    expect(await permissions.requestPermission("filesystem", "actor-1", "test", "list")).toBe(true);
    expect(permissions.checkPermission("filesystem", "actor-1", "list")).toBe(true);
    // Actor now has filesystem.read grant, but NOT filesystem.write
    expect(permissions.checkPermission("filesystem", "actor-1", "write")).toBe(false);

    // write requests filesystem.write, which broker denies
    expect(await permissions.requestPermission("filesystem", "actor-1", "test", "write")).toBe(false);
  });

  it("falls back to requiredCapability when operation is not in operationCapabilities", async () => {
    const registry = new CapabilityRegistry();
    registry.register({
      domain: "filesystem",
      name: "Filesystem",
      description: "d",
      version: "1.0.0",
      requiredCapability: "filesystem.write",
      operationCapabilities: {
        list: "filesystem.read",
      },
    });
    const broker = buildCapabilityBroker((req) => req.capability === "filesystem.write");
    const permissions = new CapabilityPermissions(broker, registry);

    // unspecified operation falls back to requiredCapability (filesystem.write)
    expect(await permissions.requestPermission("filesystem", "actor-1", "test", "unknown_op")).toBe(true);
    expect(permissions.checkPermission("filesystem", "actor-1", "unknown_op")).toBe(true);
    // and list still requires filesystem.read (which is not granted yet)
    expect(permissions.checkPermission("filesystem", "actor-1", "list")).toBe(false);
  });

  it("includes operationCapabilities in availablePermissions", async () => {
    const registry = new CapabilityRegistry();
    registry.register({
      domain: "filesystem",
      name: "Filesystem",
      description: "d",
      version: "1.0.0",
      requiredCapability: "filesystem.write",
      operationCapabilities: {
        list: "filesystem.read",
        write: "filesystem.write",
      },
    });
    const broker = buildCapabilityBroker(() => true);
    const permissions = new CapabilityPermissions(broker, registry);

    await permissions.requestPermission("filesystem", "actor-1", "test", "list");
    expect(permissions.availablePermissions("actor-1")).toEqual(["filesystem.read"]);
  });
});
