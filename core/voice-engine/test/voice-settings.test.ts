import { describe, expect, it } from "vitest";
import { VoiceSettingsManager, InMemorySettingsPersistence } from "../src/voice-settings.js";
import { defaultVoiceSettings } from "../src/types.js";

describe("VoiceSettingsManager", () => {
  it("starts with documented defaults", () => {
    const manager = new VoiceSettingsManager();
    expect(manager.get()).toEqual(defaultVoiceSettings);
  });

  it("update() patches only the given fields", async () => {
    const manager = new VoiceSettingsManager();
    const updated = await manager.update({ language: "fr-FR" });
    expect(updated.language).toBe("fr-FR");
    expect(updated.voiceId).toBe(defaultVoiceSettings.voiceId);
  });

  it("rejects an out-of-range wake word sensitivity", async () => {
    const manager = new VoiceSettingsManager();
    await expect(manager.update({ wakeWordSensitivity: 1.5 })).rejects.toThrow();
    await expect(manager.update({ wakeWordSensitivity: -0.1 })).rejects.toThrow();
  });

  it("persists updates through the injected persistence", async () => {
    const persistence = new InMemorySettingsPersistence();
    const manager = new VoiceSettingsManager(persistence);
    await manager.update({ language: "de-DE" });

    const reloaded = new VoiceSettingsManager(persistence);
    const loaded = await reloaded.load();
    expect(loaded.language).toBe("de-DE");
  });

  it("reset() restores documented defaults", async () => {
    const manager = new VoiceSettingsManager();
    await manager.update({ language: "ja-JP" });
    const reset = await manager.reset();
    expect(reset).toEqual(defaultVoiceSettings);
  });
});
