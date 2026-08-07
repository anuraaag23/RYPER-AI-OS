import type { PluginManifest } from "@ryper/plugin-runtime";
import type { DefinedPlugin } from "@ryper/plugin-sdk";
import type { ExtensionManifest } from "./types.js";

const CURRENT_SDK_VERSION = "9.0.0";

/**
 * Builds the versioned `ExtensionManifest` the brief calls for from a
 * `definePlugin()` result — `defined.manifest` supplies the fields
 * `@ryper/plugin-runtime` needs, `defined.extended` supplies everything
 * else, all with honest platform defaults rather than silent gaps.
 */
export function createExtensionManifest(defined: DefinedPlugin): ExtensionManifest {
  const extended = defined.extended;
  return {
    id: defined.manifest.id,
    name: defined.manifest.name,
    version: defined.manifest.version,
    author: extended.author ?? "unknown",
    description: extended.description ?? "",
    capabilities: defined.manifest.requestedCapabilities,
    permissions: defined.manifest.requestedCapabilities,
    dependencies: extended.dependencies ?? [],
    minSdkVersion: extended.minSdkVersion ?? "0.0.0",
    maxSdkVersion: extended.maxSdkVersion ?? CURRENT_SDK_VERSION,
    supportedPlatforms: extended.supportedPlatforms ?? [
      "windows",
      "macos",
      "linux",
      "android",
      "ios",
      "web",
    ],
    ...(extended.settingsSchema ? { settingsSchema: extended.settingsSchema } : {}),
    toolRegistrations: (extended.toolRegistrations ?? []).map((t) => ({
      actionName: t.actionName,
      spec: t.spec,
    })),
    commands: defined.actions.map((action) => action.name),
    events: [],
    pluginType: extended.pluginType ?? "custom",
    signed: defined.manifest.signed,
  };
}

/** Projects an `ExtensionManifest` back down to exactly what `PluginRuntime.register()` needs — no new fields, no surprises. */
export function toPluginManifest(manifest: ExtensionManifest): PluginManifest {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    requestedCapabilities: manifest.capabilities,
    signed: manifest.signed,
  };
}

export function getCurrentSdkVersion(): string {
  return CURRENT_SDK_VERSION;
}
