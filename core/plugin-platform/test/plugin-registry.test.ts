import { describe, expect, it } from "vitest";
import { createExtensionManifest } from "../src/manifest.js";
import { PluginNotFoundError, PluginPlatformRegistry } from "../src/plugin-registry.js";
import { testPlugin } from "./helpers.js";

describe("PluginPlatformRegistry", () => {
  it("registers a manifest in the 'registered' state", () => {
    const registry = new PluginPlatformRegistry();
    const manifest = createExtensionManifest(testPlugin());
    registry.register(manifest);
    expect(registry.get("test-plugin")?.state).toBe("registered");
    expect(registry.has("test-plugin")).toBe(true);
  });

  it("updates state and updatedAt on setState", () => {
    const registry = new PluginPlatformRegistry();
    registry.register(createExtensionManifest(testPlugin()));
    const before = registry.get("test-plugin")!;
    registry.setState("test-plugin", "enabled");
    const after = registry.get("test-plugin")!;
    expect(after.state).toBe("enabled");
    expect(after.registeredAt).toBe(before.registeredAt);
  });

  it("throws when setting state on an unregistered plugin", () => {
    const registry = new PluginPlatformRegistry();
    expect(() => registry.setState("missing", "enabled")).toThrow(PluginNotFoundError);
  });

  it("lists plugins by type and by state", () => {
    const registry = new PluginPlatformRegistry();
    registry.register(
      createExtensionManifest(testPlugin({ id: "a", extended: { pluginType: "automation" } })),
    );
    registry.register(
      createExtensionManifest(testPlugin({ id: "b", extended: { pluginType: "browser" } })),
    );
    registry.setState("a", "enabled");

    expect(registry.listByType("automation").map((r) => r.manifest.id)).toEqual(["a"]);
    expect(registry.listByState("enabled").map((r) => r.manifest.id)).toEqual(["a"]);
    expect(registry.listByState("registered").map((r) => r.manifest.id)).toEqual(["b"]);
  });

  it("removes a plugin record", () => {
    const registry = new PluginPlatformRegistry();
    registry.register(createExtensionManifest(testPlugin()));
    expect(registry.remove("test-plugin")).toBe(true);
    expect(registry.has("test-plugin")).toBe(false);
    expect(registry.remove("test-plugin")).toBe(false);
  });
});
