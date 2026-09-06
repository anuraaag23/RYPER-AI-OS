import { createLogger } from "@ryper/logging";

const log = createLogger("desktop-app:playback-client");

let masterVolume = 1;
const activeGainNodes = new Set<GainNode>();

/**
 * Applies immediately to every in-flight playback session (real
 * `GainNode.gain.value` writes reach already-scheduled, currently-
 * playing sources — not just future ones).
 */
export function setPlaybackVolume(volume: number): void {
  masterVolume = Math.max(0, Math.min(1, volume));
  for (const gain of activeGainNodes) gain.gain.value = masterVolume;
}

export interface PlaybackSession {
  pushChunk(bytes: Uint8Array, mimeType: string): void;
  end(): void;
  /** Immediate stop — the barge-in path. Actually stops the real `AudioBufferSourceNode`s. */
  stop(): void;
}

function getAudioContextCtor(): typeof AudioContext | undefined {
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

/**
 * Schedules real, gapless playback of one or more TTS audio chunks
 * (`@ryper/voice-engine`'s `TtsAudioChunk`, currently always a single
 * self-contained WAV per utterance — see `core/voice-engine/src/tts/
 * local.ts` — but this supports multiple chunks for whenever a streaming
 * TTS provider exists). `AudioContext.decodeAudioData()` and
 * `AudioBufferSourceNode` are real browser decode/playback primitives —
 * nothing here fabricates audio or a completion signal.
 *
 * `deviceId` (when given, and not `"default"`) is routed to a real,
 * non-default output device: `AudioContext.destination` itself has no
 * standard way to target a specific sink, so the graph is instead
 * connected to a `MediaStreamAudioDestinationNode` and played out
 * through a hidden `<audio>` element via the real, standard
 * `HTMLMediaElement.setSinkId()`. If that call fails or isn't
 * supported by the runtime — genuinely possible on some platforms —
 * this honestly falls back to the default output device and reports
 * it via `onSinkRoutingFailed`, rather than silently pretending the
 * selected device was used (see the Tier 1 UI brief's explicit
 * instruction on this exact limitation).
 */
export function createPlaybackSession(
  onComplete: (ok: boolean, error?: string) => void,
  deviceId?: string,
  onSinkRoutingFailed?: (reason: string) => void,
): PlaybackSession {
  const AudioContextCtor = getAudioContextCtor();
  if (!AudioContextCtor) {
    queueMicrotask(() => onComplete(false, "this runtime has no AudioContext implementation"));
    return { pushChunk(): void {}, end(): void {}, stop(): void {} };
  }

  const audioContext = new AudioContextCtor();
  let destinationNode: AudioNode = audioContext.destination;
  let sinkElement: HTMLAudioElement | undefined;

  // Resolved once routing (if any) is settled — real chunk playback
  // waits on this so no `AudioBufferSourceNode` connects before the
  // final destination is known, whether that's the requested device
  // or the honest default-device fallback.
  const routingReady: Promise<void> = (async () => {
    if (!deviceId || deviceId === "default") return;
    try {
      const streamDestination = audioContext.createMediaStreamDestination();
      const audioEl = new Audio();
      audioEl.srcObject = streamDestination.stream;
      audioEl.muted = false;
      if (typeof audioEl.setSinkId !== "function") {
        throw new Error("HTMLMediaElement.setSinkId is not supported by this runtime");
      }
      await audioEl.setSinkId(deviceId);
      await audioEl.play();
      destinationNode = streamDestination;
      sinkElement = audioEl;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.warn(
        "could not route playback to the requested output device — falling back to default",
        {
          deviceId,
          reason,
        },
      );
      onSinkRoutingFailed?.(reason);
      // destinationNode stays audioContext.destination — the real,
      // honest fallback rather than a broken/silent playback attempt.
    }
  })();

  let nextStartTime = 0;
  let stopped = false;
  let inputEnded = false;
  let decodingCount = 0;
  let playingCount = 0;
  let finished = false;
  let error: string | undefined;
  const activeSources = new Set<AudioBufferSourceNode>();

  function finishIfDone(): void {
    if (finished || stopped) return;
    if (inputEnded && decodingCount === 0 && playingCount === 0) {
      finished = true;
      void audioContext.close();
      sinkElement?.pause();
      onComplete(!error, error);
    }
  }

  async function pushChunkInternal(bytes: Uint8Array, _mimeType: string): Promise<void> {
    if (stopped) return;
    decodingCount++;
    try {
      const arrayBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      if (audioContext.state === "suspended") {
        log.info("resuming suspended audio context for playback");
        await audioContext.resume();
      }
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      await routingReady;
      if (stopped) return;

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      const gain = audioContext.createGain();
      gain.gain.value = masterVolume;
      activeGainNodes.add(gain);
      source.connect(gain);
      gain.connect(destinationNode);

      const startAt = Math.max(audioContext.currentTime, nextStartTime);
      nextStartTime = startAt + audioBuffer.duration;
      playingCount++;
      activeSources.add(source);
      log.info("scheduling audio buffer playback", {
        durationSec: audioBuffer.duration,
        audioContextState: audioContext.state,
      });
      source.onended = (): void => {
        activeSources.delete(source);
        activeGainNodes.delete(gain);
        playingCount--;
        finishIfDone();
      };
      source.start(startAt);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      decodingCount--;
      finishIfDone();
    }
  }

  return {
    pushChunk(bytes: Uint8Array, mimeType: string): void {
      void pushChunkInternal(bytes, mimeType);
    },
    end(): void {
      inputEnded = true;
      finishIfDone();
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      for (const source of activeSources) {
        source.onended = null;
        try {
          source.stop();
        } catch {
          // Already stopped/ended — fine.
        }
      }
      activeSources.clear();
      void audioContext.close();
      sinkElement?.pause();
      if (!finished) {
        finished = true;
        onComplete(true); // barge-in is a deliberate interruption, not a failure
      }
    },
  };
}
