import type { TtsAudioChunk, TtsRequestOptions } from "../types.js";

function cacheKey(text: string, options: TtsRequestOptions): string {
  return JSON.stringify({
    text,
    voiceId: options.voiceId ?? "default",
    speed: options.speed ?? 1,
    pitch: options.pitch ?? 1,
    emotion: options.emotion ?? "",
  });
}

/**
 * Caches the fully-collected chunk list for a given (text, voice, speed,
 * pitch, emotion) tuple. Synthesis is normally streamed for latency, but a
 * cache necessarily stores the complete result — this trades a small
 * amount of memory for skipping synthesis entirely on a cache hit (e.g. a
 * wake-word acknowledgement chime spoken every session).
 */
export class VoiceCache {
  private readonly cache = new Map<string, TtsAudioChunk[]>();

  constructor(private readonly maxEntries = 100) {}

  get(text: string, options: TtsRequestOptions = {}): readonly TtsAudioChunk[] | undefined {
    return this.cache.get(cacheKey(text, options));
  }

  set(text: string, options: TtsRequestOptions, chunks: readonly TtsAudioChunk[]): void {
    const key = cacheKey(text, options);
    if (!this.cache.has(key) && this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(key, [...chunks]);
  }

  has(text: string, options: TtsRequestOptions = {}): boolean {
    return this.cache.has(cacheKey(text, options));
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

/** Wraps any `synthesizeStream`-shaped call with cache-first behavior; used by `SpeechSynthesisRegistry`. */
export async function* synthesizeWithCache(
  cache: VoiceCache,
  text: string,
  options: TtsRequestOptions,
  synthesize: (text: string, options: TtsRequestOptions) => AsyncIterable<TtsAudioChunk>,
): AsyncIterable<TtsAudioChunk> {
  const cached = cache.get(text, options);
  if (cached) {
    yield* cached;
    return;
  }

  const collected: TtsAudioChunk[] = [];
  for await (const chunk of synthesize(text, options)) {
    collected.push(chunk);
    yield chunk;
  }
  cache.set(text, options, collected);
}

export function createVoiceCache(maxEntries?: number): VoiceCache {
  return new VoiceCache(maxEntries);
}
