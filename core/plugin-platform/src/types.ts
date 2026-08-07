import type { Capability } from "@ryper/security";
import type { PluginDependency, PluginExtendedMetadata, DefinedPlugin } from "@ryper/plugin-sdk";
export type { PluginDependency, PluginExtendedMetadata };

/**
 * The full, versioned manifest the brief calls for — a superset of
 * `@ryper/plugin-runtime`'s `PluginManifest`. `toPluginManifest()` in
 * `manifest.ts` projects this down to exactly what the runtime needs, so
 * the runtime's contract never has to change.
 */
export interface ExtensionManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly author: string;
  readonly description: string;
  readonly capabilities: readonly Capability[];
  readonly permissions: readonly Capability[];
  readonly dependencies: readonly PluginDependency[];
  readonly minSdkVersion: string;
  readonly maxSdkVersion: string;
  readonly supportedPlatforms: readonly string[];
  readonly settingsSchema?: PluginExtendedMetadata["settingsSchema"];
  readonly toolRegistrations: readonly { readonly actionName: string; readonly spec: unknown }[];
  readonly commands: readonly string[];
  readonly events: readonly string[];
  readonly pluginType: string;
  readonly signed: boolean;
}

export type PluginLifecycleState =
  | "registered"
  | "installed"
  | "loaded"
  | "initialized"
  | "enabled"
  | "disabled"
  | "suspended"
  | "uninstalled"
  | "failed";

/**
 * What `PluginLoader`/`PluginInstaller` operate on: a defined plugin (from
 * `@ryper/plugin-sdk`'s `definePlugin`) plus the platform-facing manifest
 * derived from it. `definePlugin`'s output is the only supported input —
 * this package never accepts a raw manifest object, so every installed
 * plugin has gone through the SDK's own validation (kebab-case id, at
 * least one action).
 */
export interface PluginPackage {
  readonly defined: DefinedPlugin;
  readonly extensionManifest: ExtensionManifest;
}

export interface PluginAuditEntry {
  readonly pluginId: string;
  readonly capability: Capability;
  readonly action: "granted" | "denied" | "revoked";
  readonly at: string;
}

export interface PermissionGroup {
  readonly name: string;
  readonly capabilities: readonly Capability[];
}
