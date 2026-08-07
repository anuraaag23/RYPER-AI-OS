import { describe, expect, it } from "vitest";
import {
  createExtensionManifest,
  getCurrentSdkVersion,
  toPluginManifest,
} from "../src/manifest.js";
import { testPlugin } from "./helpers.js";

describe("createExtensionManifest", () => {
  it("fills honest defaults for a plugin with no extended metadata", () => {
    const defined = testPlugin();
    const manifest = createExtensionManifest(defined);
    expect(manifest.id).toBe("test-plugin");
    expect(manifest.author).toBe("unknown");
    expect(manifest.description).toBe("");
    expect(manifest.minSdkVersion).toBe("0.0.0");
    expect(manifest.maxSdkVersion).toBe(getCurrentSdkVersion());
    expect(manifest.supportedPlatforms.length).toBeGreaterThan(0);
    expect(manifest.commands).toEqual(["ping"]);
    expect(manifest.pluginType).toBe("custom");
  });

  it("carries extended metadata through when provided", () => {
    const defined = testPlugin({
      extended: {
        author: "Ryper Team",
        description: "A test plugin",
        dependencies: [{ id: "other-plugin", version: "1.0.0" }],
        minSdkVersion: "1.0.0",
        maxSdkVersion: "2.0.0",
        supportedPlatforms: ["windows"],
        pluginType: "automation",
      },
    });
    const manifest = createExtensionManifest(defined);
    expect(manifest.author).toBe("Ryper Team");
    expect(manifest.dependencies).toEqual([{ id: "other-plugin", version: "1.0.0" }]);
    expect(manifest.minSdkVersion).toBe("1.0.0");
    expect(manifest.maxSdkVersion).toBe("2.0.0");
    expect(manifest.supportedPlatforms).toEqual(["windows"]);
    expect(manifest.pluginType).toBe("automation");
  });
});

describe("toPluginManifest", () => {
  it("projects an ExtensionManifest down to exactly what PluginRuntime needs", () => {
    const manifest = createExtensionManifest(testPlugin({ requestedCapabilities: ["network"] }));
    const projected = toPluginManifest(manifest);
    expect(projected).toEqual({
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      requestedCapabilities: ["network"],
      signed: true,
    });
  });
});
