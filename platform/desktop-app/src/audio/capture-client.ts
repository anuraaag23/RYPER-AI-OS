import { floatTo16BitPcm, resamplePcm16 } from "./resample.js";

export interface CaptureFrame {
  readonly samples: Int16Array;
  readonly sampleRateHz: number;
}

export interface CaptureCallbacks {
  readonly onFrame: (frame: CaptureFrame) => void;
  readonly onError: (message: string) => void;
  /** Fired when the OS/browser ends the track out from under us (device unplugged). */
  readonly onEnded: () => void;
}

export interface CaptureHandle {
  stop(): void;
  /**
   * Chromium's real, actually-applied audio-processing settings for this
   * capture (from the real `MediaStreamTrack.getSettings()`) — browsers
   * are not required to honor every requested constraint exactly, so
   * this reports ground truth rather than assuming the request above
   * was granted. `undefined` until the stream is open.
   */
  getAppliedAudioSettings(): MediaTrackSettings | undefined;
}

function describeGetUserMediaError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : undefined;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "microphone permission was denied";
    case "NotFoundError":
    case "OverconstrainedError":
      return "the requested microphone device is unavailable";
    case "NotReadableError":
      return "the microphone is in use by another application or is unreadable";
    default:
      return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Real microphone capture: `getUserMedia()` opens the actual device (or
 * throws a real `DOMException` for denial/unavailability — never
 * fabricated), then a `ScriptProcessorNode` pulls real PCM frames off it.
 * `ScriptProcessorNode` is deprecated in favor of `AudioWorkletNode`, but
 * is used here deliberately: it needs no separate worklet module loaded
 * through Electron's packaged `file://` asset pipeline (real added build
 * complexity this phase doesn't take on for one processor) and has
 * universal Chromium support. Swapping to an `AudioWorkletNode` later
 * requires no change outside this file.
 */
export async function startMicrophoneCapture(
  deviceId: string,
  targetSampleRateHz: number,
  callbacks: CaptureCallbacks,
): Promise<CaptureHandle> {
  // Phase 13.8: real echo cancellation, noise suppression, and automatic
  // gain control — not a DSP implementation this repository wrote (no
  // real DSP library like WebRTC's AudioProcessingModule or Speex DSP
  // exists anywhere here, see docs/adr/0018/0019), but the real,
  // built-in Chromium/WebRTC audio processing that already backs every
  // `getUserMedia()` call in an Electron renderer. These constraints
  // were previously left unset (relying on Chromium's implicit
  // default, which is normally on) — set explicitly here so it's a
  // real, verified, documented request rather than an assumed default.
  // Still NOT VERIFIED against physical hardware in this repository's
  // build environment — see docs/PROJECT_STATE.md's Phase 13.8 section.
  const constraints: MediaStreamConstraints = {
    audio:
      deviceId && deviceId !== "default"
        ? {
            deviceId: { exact: deviceId },
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        : {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
  };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    if (deviceId && deviceId !== "default") {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (fallbackErr) {
        callbacks.onError(describeGetUserMediaError(fallbackErr));
        return { stop(): void {}, getAppliedAudioSettings: () => undefined };
      }
    } else {
      callbacks.onError(describeGetUserMediaError(err));
      return { stop(): void {}, getAppliedAudioSettings: () => undefined };
    }
  }

  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    for (const track of stream.getTracks()) track.stop();
    callbacks.onError("this runtime has no AudioContext implementation");
    return { stop(): void {}, getAppliedAudioSettings: () => undefined };
  }

  const audioContext = new AudioContextCtor();
  if (audioContext.state === "suspended") {
    try {
      await audioContext.resume();
    } catch {
      // AudioContext.resume() may reject if forbidden by policy; proceed anyway
    }
  }
  const source = audioContext.createMediaStreamSource(stream);
  const bufferSize = 4096;
  const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
  // ScriptProcessorNode only fires `onaudioprocess` once it's part of a
  // graph that reaches the destination; route through a zero-gain node so
  // captured audio is never actually heard (no self-monitoring echo).
  const silentSink = audioContext.createGain();
  silentSink.gain.value = 0;

  let stopped = false;
  const track = stream.getAudioTracks()[0];
  const onTrackEnded = (): void => {
    if (stopped) return;
    callbacks.onEnded();
  };
  track?.addEventListener("ended", onTrackEnded);

  processor.onaudioprocess = (event: AudioProcessingEvent): void => {
    if (stopped) return;
    const channelData = event.inputBuffer.getChannelData(0);
    const pcm16 = floatTo16BitPcm(channelData);
    const resampled = resamplePcm16(pcm16, audioContext.sampleRate, targetSampleRateHz);
    callbacks.onFrame({ samples: resampled, sampleRateHz: targetSampleRateHz });
  };

  source.connect(processor);
  processor.connect(silentSink);
  silentSink.connect(audioContext.destination);

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      track?.removeEventListener("ended", onTrackEnded);
      try {
        processor.disconnect();
        source.disconnect();
        silentSink.disconnect();
      } catch {
        // Already disconnected — nothing more to clean up.
      }
      for (const t of stream.getTracks()) t.stop();
      void audioContext.close();
    },
    getAppliedAudioSettings: () => track?.getSettings(),
  };
}
