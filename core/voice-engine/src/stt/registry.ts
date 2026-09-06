import type { OfflineCloudPreference } from "../types.js";
import type { SpeechRecognitionProvider } from "./types.js";

/**
 * Same selection shape as `@ryper/model-router`'s local/cloud decision,
 * applied to STT providers specifically. Kept independent rather than
 * importing `ModelRouter` because the inputs differ (a user's STT
 * preference setting rather than task-complexity routing) — see
 * `VoiceSettingsManager` for where `OfflineCloudPreference` is configured.
 */
export class SpeechRecognitionRegistry {
  private readonly providers = new Map<string, SpeechRecognitionProvider>();

  register(provider: SpeechRecognitionProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`STT provider "${provider.id}" is already registered`);
    }
    this.providers.set(provider.id, provider);
  }

  select(preference: OfflineCloudPreference, isOnline: boolean): SpeechRecognitionProvider {
    const offline = [...this.providers.values()].filter((p) => p.supportsOffline);
    const cloud = [...this.providers.values()].filter((p) => !p.supportsOffline);

    const pick = (): SpeechRecognitionProvider | undefined => {
      switch (preference) {
        case "offline_only":
          return offline[0];
        case "cloud_only":
          return isOnline ? cloud[0] : undefined;
        case "prefer_cloud":
          return (isOnline && cloud[0]) || offline[0];
        case "prefer_offline":
        default:
          return offline[0] ?? (isOnline ? cloud[0] : undefined);
      }
    };

    const selected = pick();
    if (!selected) {
      throw new Error(
        `no eligible STT provider for preference "${preference}" (online: ${isOnline})`,
      );
    }
    return selected;
  }

  list(): readonly SpeechRecognitionProvider[] {
    return [...this.providers.values()];
  }
}

export function createSpeechRecognitionRegistry(): SpeechRecognitionRegistry {
  return new SpeechRecognitionRegistry();
}
