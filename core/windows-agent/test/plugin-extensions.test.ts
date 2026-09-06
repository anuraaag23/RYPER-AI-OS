import { describe, expect, it } from "vitest";
import { createWindowsPluginCapabilityRegistry } from "../src/plugin-extensions.js";

describe("WindowsPluginCapabilityRegistry", () => {
  it("registers and looks up a plugin-contributed handler", () => {
    const registry = createWindowsPluginCapabilityRegistry();
    const handler = async () => "ok";
    registry.register({
      pluginId: "acme.tray-icons",
      domain: "tray_icons",
      operation: "set_icon",
      handler,
    });

    expect(registry.has("tray_icons", "set_icon")).toBe(true);
    expect(registry.get("tray_icons", "set_icon")?.handler).toBe(handler);
  });

  it("refuses to register two handlers for the same domain/operation", () => {
    const registry = createWindowsPluginCapabilityRegistry();
    registry.register({
      pluginId: "acme.a",
      domain: "tray_icons",
      operation: "set_icon",
      handler: async () => undefined,
    });
    expect(() =>
      registry.register({
        pluginId: "acme.b",
        domain: "tray_icons",
        operation: "set_icon",
        handler: async () => undefined,
      }),
    ).toThrow(/already registered/);
  });

  it("unregisters a handler only if the requesting plugin owns it", () => {
    const registry = createWindowsPluginCapabilityRegistry();
    registry.register({
      pluginId: "acme.a",
      domain: "tray_icons",
      operation: "set_icon",
      handler: async () => undefined,
    });
    expect(registry.unregister("acme.b", "tray_icons", "set_icon")).toBe(false);
    expect(registry.unregister("acme.a", "tray_icons", "set_icon")).toBe(true);
    expect(registry.has("tray_icons", "set_icon")).toBe(false);
  });

  it("unregisters every handler contributed by a plugin at once", () => {
    const registry = createWindowsPluginCapabilityRegistry();
    registry.register({
      pluginId: "acme.a",
      domain: "tray_icons",
      operation: "set_icon",
      handler: async () => undefined,
    });
    registry.register({
      pluginId: "acme.a",
      domain: "tray_icons",
      operation: "clear_icon",
      handler: async () => undefined,
    });
    registry.register({
      pluginId: "acme.b",
      domain: "other",
      operation: "op",
      handler: async () => undefined,
    });

    const removed = registry.unregisterAllForPlugin("acme.a");
    expect(removed).toBe(2);
    expect(registry.list()).toHaveLength(1);
  });
});
