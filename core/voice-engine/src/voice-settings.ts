import { createLogger } from "@ryper/logging";
import { defaultVoiceSettings, type VoiceSettings } from "./types.js";

const log = createLogger("voice-engine:settings");

export interface SettingsPersistence {
  load(): Promise<VoiceSettings | undefined>;
  save(settings: VoiceSettings): Promise<void>;
}

export class InMemorySettingsPersistence implements SettingsPersistence {
  private stored: VoiceSettings | undefined;
  async load(): Promise<VoiceSettings | undefined> {
    return this.stored;
  }
  async save(settings: VoiceSettings): Promise<void> {
    this.stored = settings;
  }
}

/**
 * The single source of truth for every user-controllable voice setting
 * the brief lists. Writes go through `update()` (partial patch, validated,
 * persisted) rather than exposing a mutable object, so every change is
 * both validated and durable.
 */
export class VoiceSettingsManager {
  private settings: VoiceSettings = defaultVoiceSettings;
  private loaded = false;

  constructor(
    private readonly persistence: SettingsPersistence = new InMemorySettingsPersistence(),
  ) {}

  async load(): Promise<VoiceSettings> {
    if (!this.loaded) {
      const stored = await this.persistence.load();
      this.settings = stored ?? defaultVoiceSettings;
      this.loaded = true;
    }
    return this.settings;
  }

  get(): VoiceSettings {
    return this.settings;
  }

  async update(patch: Partial<VoiceSettings>): Promise<VoiceSettings> {
    if (patch.wakeWordSensitivity !== undefined) {
      if (patch.wakeWordSensitivity < 0 || patch.wakeWordSensitivity > 1) {
        throw new Error("wakeWordSensitivity must be between 0 and 1");
      }
    }
    this.settings = { ...this.settings, ...patch };
    await this.persistence.save(this.settings);
    log.info("voice settings updated", { patch: Object.keys(patch) });
    return this.settings;
  }

  async reset(): Promise<VoiceSettings> {
    this.settings = defaultVoiceSettings;
    await this.persistence.save(this.settings);
    return this.settings;
  }
}

export function createVoiceSettingsManager(
  persistence?: SettingsPersistence,
): VoiceSettingsManager {
  return new VoiceSettingsManager(persistence);
}
