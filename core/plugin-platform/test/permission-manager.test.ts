import { describe, expect, it } from "vitest";
import { BUILTIN_PERMISSION_GROUPS, PluginPermissionManager } from "../src/permission-manager.js";
import { buildCapabilityBroker } from "./helpers.js";

describe("PluginPermissionManager", () => {
  it("requests and records granted capabilities", async () => {
    const manager = new PluginPermissionManager(buildCapabilityBroker(() => true));
    const granted = await manager.requestForPlugin("plugin-a", ["network"], "install");
    expect(granted).toBe(true);
    expect(manager.checkForPlugin("plugin-a", ["network"])).toBe(true);
    expect(manager.auditLog("plugin-a")).toEqual([
      { pluginId: "plugin-a", capability: "network", action: "granted", at: expect.any(String) },
    ]);
  });

  it("records a denial without throwing and reports overall false", async () => {
    const manager = new PluginPermissionManager(buildCapabilityBroker(() => false));
    const granted = await manager.requestForPlugin("plugin-a", ["network", "camera"], "install");
    expect(granted).toBe(false);
    expect(manager.auditLog("plugin-a")).toHaveLength(2);
    expect(manager.auditLog("plugin-a").every((e) => e.action === "denied")).toBe(true);
  });

  it("revokes capabilities and records the revocation", async () => {
    const manager = new PluginPermissionManager(buildCapabilityBroker(() => true));
    await manager.requestForPlugin("plugin-a", ["network"], "install");
    manager.revokeForPlugin("plugin-a", ["network"]);
    expect(manager.checkForPlugin("plugin-a", ["network"])).toBe(false);
    expect(manager.auditLog("plugin-a").at(-1)?.action).toBe("revoked");
  });

  it("resolves a built-in permission group to its capabilities", () => {
    const manager = new PluginPermissionManager(buildCapabilityBroker());
    expect(manager.resolveGroup("filesystem")).toEqual(
      BUILTIN_PERMISSION_GROUPS.find((g) => g.name === "filesystem")?.capabilities,
    );
    expect(manager.resolveGroup("unknown-group")).toEqual([]);
  });

  it("supports registering a custom permission group", () => {
    const manager = new PluginPermissionManager(buildCapabilityBroker());
    manager.registerGroup({ name: "custom", capabilities: ["network", "camera"] });
    expect(manager.resolveGroup("custom")).toEqual(["network", "camera"]);
  });

  it("filters the audit log to a single plugin when requested", async () => {
    const manager = new PluginPermissionManager(buildCapabilityBroker(() => true));
    await manager.requestForPlugin("plugin-a", ["network"], "install");
    await manager.requestForPlugin("plugin-b", ["camera"], "install");
    expect(manager.auditLog("plugin-a")).toHaveLength(1);
    expect(manager.auditLog()).toHaveLength(2);
  });
});
