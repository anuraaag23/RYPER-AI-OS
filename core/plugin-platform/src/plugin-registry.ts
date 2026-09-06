import type { ExtensionManifest, PluginLifecycleState } from "./types.js";

export interface PluginRecord {
  readonly manifest: ExtensionManifest;
  readonly state: PluginLifecycleState;
  readonly registeredAt: string;
  readonly updatedAt: string;
}

export class PluginNotFoundError extends Error {}

/**
 * The platform's own source of truth for "what plugins exist and what
 * state are they in" — richer than `@ryper/plugin-runtime`'s `PluginRuntime`,
 * which only tracks a manifest + actions map for invocation purposes.
 * `PluginLifecycleManager` is the only writer; everything else reads.
 */
export class PluginPlatformRegistry {
  private readonly records = new Map<string, PluginRecord>();

  register(manifest: ExtensionManifest): void {
    const now = new Date().toISOString();
    const existing = this.records.get(manifest.id);
    if (existing) {
      // Re-registering (e.g. mid-update) updates the manifest but must not reset lifecycle state.
      this.records.set(manifest.id, { ...existing, manifest, updatedAt: now });
      return;
    }
    this.records.set(manifest.id, {
      manifest,
      state: "registered",
      registeredAt: now,
      updatedAt: now,
    });
  }

  setState(pluginId: string, state: PluginLifecycleState): void {
    const record = this.records.get(pluginId);
    if (!record) throw new PluginNotFoundError(`plugin "${pluginId}" is not registered`);
    this.records.set(pluginId, { ...record, state, updatedAt: new Date().toISOString() });
  }

  get(pluginId: string): PluginRecord | undefined {
    return this.records.get(pluginId);
  }

  has(pluginId: string): boolean {
    return this.records.has(pluginId);
  }

  remove(pluginId: string): boolean {
    return this.records.delete(pluginId);
  }

  list(): readonly PluginRecord[] {
    return [...this.records.values()];
  }

  listByType(pluginType: string): readonly PluginRecord[] {
    return this.list().filter((record) => record.manifest.pluginType === pluginType);
  }

  listByState(state: PluginLifecycleState): readonly PluginRecord[] {
    return this.list().filter((record) => record.state === state);
  }
}

export function createPluginPlatformRegistry(): PluginPlatformRegistry {
  return new PluginPlatformRegistry();
}
