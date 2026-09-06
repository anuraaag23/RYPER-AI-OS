import type { OfflineCloudPreference, TtsAudioChunk, TtsRequestOptions } from "../types.js";
import type { SpeechSynthesisProvider } from "./types.js";
import { VoiceCache, synthesizeWithCache } from "./cache.js";

export class SpeechSynthesisRegistry {
  private readonly providers = new Map<string, SpeechSynthesisProvider>();

  constructor(private readonly cache: VoiceCache = new VoiceCache()) {}

  register(provider: SpeechSynthesisProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`TTS provider "${provider.id}" is already registered`);
    }
    this.providers.set(provider.id, provider);
  }

  select(preference: OfflineCloudPreference, isOnline: boolean): SpeechSynthesisProvider {
    const offline = [...this.providers.values()].filter((p) => p.supportsOffline);
    const cloud = [...this.providers.values()].filter((p) => !p.supportsOffline);

    const pick = (): SpeechSynthesisProvider | undefined => {
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
        `no eligible TTS provider for preference "${preference}" (online: ${isOnline})`,
      );
    }
    return selected;
  }

  synthesize(
    preference: OfflineCloudPreference,
    isOnline: boolean,
    text: string,
    options: TtsRequestOptions = {},
  ): AsyncIterable<TtsAudioChunk> {
    const provider = this.select(preference, isOnline);
    return synthesizeWithCache(this.cache, text, options, (t, o) =>
      provider.synthesizeStream(t, o),
    );
  }

  listVoices(): readonly {
    providerId: string;
    voice: { id: string; name: string; language: string };
  }[] {
    return [...this.providers.values()].flatMap((provider) =>
      provider.voices.map((voice) => ({ providerId: provider.id, voice })),
    );
  }

  list(): readonly SpeechSynthesisProvider[] {
    return [...this.providers.values()];
  }
}

export function createSpeechSynthesisRegistry(cache?: VoiceCache): SpeechSynthesisRegistry {
  return new SpeechSynthesisRegistry(cache);
}
