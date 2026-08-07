import type { MemoryManager } from "@ryper/memory-system";
import { ToolValidator, type JsonSchema } from "@ryper/tool-framework";

export class PluginConfigurationError extends Error {}

function settingTag(pluginId: string, key: string): string {
  return `plugin_setting:${pluginId}:${key}`;
}

/** The surface `PluginLoader` needs — satisfied by `PluginConfigurationManager` and by any lightweight stand-in. */
export interface PluginConfigurationAccess {
  set(pluginId: string, key: string, value: string, schema?: JsonSchema): Promise<void>;
  get(pluginId: string, key: string): string | undefined;
  allKeys(pluginId: string): readonly string[];
}

/**
 * Per-plugin settings storage, reusing `MemoryManager`'s public API
 * exactly the way `@ryper/tool-framework`'s per-tool settings do — one
 * tagged preference memory per key — and validating a value against the
 * plugin's declared `settingsSchema` with `@ryper/tool-framework`'s
 * `ToolValidator` rather than writing a third JSON-schema validator.
 */
export class PluginConfigurationManager implements PluginConfigurationAccess {
  private readonly validator = new ToolValidator();

  constructor(private readonly memory: MemoryManager) {}

  async set(pluginId: string, key: string, value: string, schema?: JsonSchema): Promise<void> {
    if (schema) {
      const result = this.validator.validate(schema, value);
      if (!result.valid) {
        throw new PluginConfigurationError(
          `setting "${key}" for plugin "${pluginId}" failed validation: ${result.errors.join("; ")}`,
        );
      }
    }
    await this.memory.createMemoryAuto(
      value,
      { type: "preference", tags: [settingTag(pluginId, key)] },
      pluginId,
    );
  }

  get(pluginId: string, key: string): string | undefined {
    const matches = this.memory.filterMemories({
      type: "preference",
      tag: settingTag(pluginId, key),
    });
    const [latest] = [...matches].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return latest?.content;
  }

  allKeys(pluginId: string): readonly string[] {
    const prefix = `plugin_setting:${pluginId}:`;
    const records = this.memory.filterMemories({ type: "preference" });
    const keys = new Set<string>();
    for (const record of records) {
      for (const tag of record.tags) {
        if (tag.startsWith(prefix)) keys.add(tag.slice(prefix.length));
      }
    }
    return [...keys];
  }
}

export function createPluginConfigurationManager(
  memory: MemoryManager,
): PluginConfigurationManager {
  return new PluginConfigurationManager(memory);
}
