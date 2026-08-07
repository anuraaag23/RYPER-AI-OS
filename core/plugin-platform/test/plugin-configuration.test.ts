import { describe, expect, it } from "vitest";
import {
  PluginConfigurationError,
  PluginConfigurationManager,
} from "../src/plugin-configuration.js";
import { buildMemoryManager } from "./helpers.js";

describe("PluginConfigurationManager", () => {
  it("round-trips a setting for a plugin", async () => {
    const manager = new PluginConfigurationManager(buildMemoryManager());
    expect(manager.get("plugin-a", "theme")).toBeUndefined();
    await manager.set("plugin-a", "theme", "dark");
    expect(manager.get("plugin-a", "theme")).toBe("dark");
  });

  it("keeps settings scoped per plugin id", async () => {
    const manager = new PluginConfigurationManager(buildMemoryManager());
    await manager.set("plugin-a", "theme", "dark");
    await manager.set("plugin-b", "theme", "light");
    expect(manager.get("plugin-a", "theme")).toBe("dark");
    expect(manager.get("plugin-b", "theme")).toBe("light");
  });

  it("validates a value against the plugin's settingsSchema before storing it", async () => {
    const manager = new PluginConfigurationManager(buildMemoryManager());
    const schema = { type: "string" as const, enum: ["dark", "light"] };
    await expect(manager.set("plugin-a", "theme", "purple", schema)).rejects.toThrow(
      PluginConfigurationError,
    );
    await manager.set("plugin-a", "theme", "dark", schema);
    expect(manager.get("plugin-a", "theme")).toBe("dark");
  });

  it("lists every setting key a plugin has stored", async () => {
    const manager = new PluginConfigurationManager(buildMemoryManager());
    await manager.set("plugin-a", "theme", "dark");
    await manager.set("plugin-a", "language", "en");
    expect(new Set(manager.allKeys("plugin-a"))).toEqual(new Set(["theme", "language"]));
  });
});
