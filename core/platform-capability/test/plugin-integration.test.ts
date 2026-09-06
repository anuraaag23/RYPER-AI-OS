import { describe, expect, it } from "vitest";
import { CapabilityManager } from "../src/capability-manager.js";
import { createPluginCapabilityContext } from "../src/plugin-integration.js";
import { buildCapabilityBroker, buildMockAdapter } from "./helpers.js";

describe("createPluginCapabilityContext", () => {
  it("queries capability support through the real manager", () => {
    const manager = new CapabilityManager({
      broker: buildCapabilityBroker(),
      platformDetector: () => "windows",
    });
    manager.registerAdapter(
      buildMockAdapter({ platform: "windows", supportedDomains: ["notifications"] }),
    );
    const context = createPluginCapabilityContext(manager, "my-plugin");

    expect(context.query("notifications").supported).toBe(true);
    const unsupported = context.query("bluetooth");
    expect(unsupported.supported).toBe(false);
    expect(unsupported.reason).toBeDefined();
  });

  it("registers a new abstract capability on behalf of the plugin", () => {
    const manager = new CapabilityManager({ broker: buildCapabilityBroker() });
    const context = createPluginCapabilityContext(manager, "my-plugin");
    context.registerCapability({
      domain: "custom.weather_widget",
      name: "Weather Widget",
      description: "d",
      version: "1.0.0",
    });
    expect(manager.registry.has("custom.weather_widget")).toBe(true);
  });

  it("requests a permission through the manager's real permission system", async () => {
    const manager = new CapabilityManager({ broker: buildCapabilityBroker(() => true) });
    manager.registerCapability({
      domain: "camera",
      name: "c",
      description: "d",
      version: "1.0.0",
      requiredCapability: "camera",
    });
    const context = createPluginCapabilityContext(manager, "my-plugin");
    expect(await context.requestPermission("camera")).toBe(true);
    expect(manager.permissions.checkPermission("camera", "my-plugin")).toBe(true);
  });

  it("declareRequired does not throw even with no backing validation yet", () => {
    const manager = new CapabilityManager({ broker: buildCapabilityBroker() });
    const context = createPluginCapabilityContext(manager, "my-plugin");
    expect(() => context.declareRequired(["camera", "microphone"])).not.toThrow();
  });
});
