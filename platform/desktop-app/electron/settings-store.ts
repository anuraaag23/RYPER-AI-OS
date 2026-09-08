import { readFile, writeFile, mkdir, copyFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { createLogger } from "@ryper/logging";
import type { AppSettings } from "./ipc-contract.js";

const log = createLogger("desktop-app:settings-store");

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  voiceEnabled: false,
  launchAtLogin: false,
  pushToTalkShortcut: "CommandOrControl+Shift+Space",
  voiceLanguage: "auto",
  ttsVoice: "auto",
  hasCompletedOnboarding: false,
};

function isThemePreference(value: unknown): value is AppSettings["theme"] {
  return value === "light" || value === "dark" || value === "system";
}

function isVoiceLanguagePreference(
  value: unknown,
): value is NonNullable<AppSettings["voiceLanguage"]> {
  return value === "auto" || value === "en" || value === "hi";
}

function isTtsVoicePreference(value: unknown): value is NonNullable<AppSettings["ttsVoice"]> {
  return value === "auto" || value === "en" || value === "en-IN" || value === "hi";
}

/** Validates untrusted JSON read from disk field-by-field rather than trusting a blind cast. */
function sanitizeSettings(candidate: unknown): AppSettings {
  if (typeof candidate !== "object" || candidate === null) return DEFAULT_SETTINGS;
  const raw = candidate as Record<string, unknown>;
  const sanitizedPolicies: Record<string, "always" | "prompt" | "denied"> = {};
  if (typeof raw.persistentPermissions === "object" && raw.persistentPermissions !== null) {
    for (const [key, policy] of Object.entries(raw.persistentPermissions as Record<string, unknown>)) {
      if (policy === "always" || policy === "prompt" || policy === "denied") {
        sanitizedPolicies[key] = policy;
      }
    }
  }

  return {
    theme: isThemePreference(raw.theme) ? raw.theme : DEFAULT_SETTINGS.theme,
    voiceEnabled:
      typeof raw.voiceEnabled === "boolean" ? raw.voiceEnabled : DEFAULT_SETTINGS.voiceEnabled,
    launchAtLogin:
      typeof raw.launchAtLogin === "boolean" ? raw.launchAtLogin : DEFAULT_SETTINGS.launchAtLogin,
    pushToTalkShortcut:
      typeof raw.pushToTalkShortcut === "string" && raw.pushToTalkShortcut.length > 0
        ? raw.pushToTalkShortcut
        : DEFAULT_SETTINGS.pushToTalkShortcut,
    voiceLanguage: isVoiceLanguagePreference(raw.voiceLanguage)
      ? raw.voiceLanguage
      : DEFAULT_SETTINGS.voiceLanguage,
    ttsVoice: isTtsVoicePreference(raw.ttsVoice)
      ? raw.ttsVoice
      : DEFAULT_SETTINGS.ttsVoice,
    // Deliberately not resolved against `resolveBrowserId()` here —
    // that would couple this module to `@ryper/windows-agent` just for
    // validation. An unresolvable id is instead handled gracefully at
    // the point of use (`desktopActions.openUrl` et al.), the same way
    // a since-uninstalled preferred browser would be.
    ...(typeof raw.preferredBrowserId === "string" && raw.preferredBrowserId.length > 0
      ? { preferredBrowserId: raw.preferredBrowserId }
      : {}),
    ...(typeof raw.hasCompletedOnboarding === "boolean"
      ? { hasCompletedOnboarding: raw.hasCompletedOnboarding }
      : {}),
    ...(Object.keys(sanitizedPolicies).length > 0
      ? { persistentPermissions: sanitizedPolicies }
      : {}),
  };
}

/**
 * Real settings persistence backed by a JSON file under Electron's
 * per-user `userData` directory (injected as `filePath` so this class
 * has no direct dependency on `electron` and is unit-testable against a
 * real temp file, not a mock filesystem).
 */
export class SettingsStore {
  private cache: AppSettings | undefined;

  constructor(private readonly filePath: string) {}

  async load(): Promise<AppSettings> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.filePath, "utf-8");
      this.cache = sanitizeSettings(JSON.parse(raw));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn("settings file unreadable, backing up and falling back to defaults", { error: String(err) });
        try {
          const bakPath = `${this.filePath}.bak-${Date.now()}`;
          await copyFile(this.filePath, bakPath);
          log.info("corrupted settings preserved", { bakPath });
        } catch {
          // preserve failure ignored
        }
      }
      this.cache = DEFAULT_SETTINGS;
    }
    return this.cache;
  }

  /**
   * The already-loaded settings, synchronously, or `undefined` if
   * `load()` hasn't been called yet. For call sites that need a live
   * read without going through the async API — e.g. `core-bootstrap.
   * ts` passing a `getPreferredBrowser` accessor down into tool
   * definitions built once at startup but read fresh on every real
   * tool invocation.
   */
  getCached(): AppSettings | undefined {
    return this.cache;
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.load();
    const sanitizedPatch = sanitizeSettings({ ...current, ...patch });
    this.cache = sanitizedPatch;
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeFile(tmpPath, JSON.stringify(sanitizedPatch, null, 2), "utf-8");
    await rename(tmpPath, this.filePath);
    log.info("settings updated", { changedKeys: Object.keys(patch) });
    return sanitizedPatch;
  }
}

export function createSettingsStore(filePath: string): SettingsStore {
  return new SettingsStore(filePath);
}
