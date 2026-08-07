/**
 * Every plugin type the brief lists. Kept as a plain `string` at the
 * `ExtensionManifest.pluginType` field (like `@ryper/tool-framework`'s
 * `ToolCategory`) so a future plugin type never requires touching this
 * package — these constants exist for convenience and typo-catching at
 * call sites, not as a closed union.
 */
export const BUILTIN_PLUGIN_TYPES = [
  "application",
  "desktop",
  "android",
  "ios",
  "browser",
  "document",
  "pdf",
  "image",
  "video",
  "audio",
  "camera",
  "cloud",
  "storage",
  "ai_provider",
  "speech_provider",
  "vision_provider",
  "automation",
  "smart_home",
  "communication",
  "developer_tool",
  "custom",
] as const;

export type BuiltinPluginType = (typeof BUILTIN_PLUGIN_TYPES)[number];
export type PluginType = string;
