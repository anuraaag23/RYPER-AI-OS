import type {
  ASRRequest,
  ASRResult,
  LocalRuntimeProvider,
  TTSRequest,
  TTSResult,
} from "@ryper/local-runtime";

/**
 * A minimal, honestly-labeled reference `LocalRuntimeProvider` for the
 * `"asr"`/`"tts"` task types, in the same spirit as `@ryper/web-shell`'s
 * own documented "safe echo providers... runnable and testable before
 * any model backend is wired in." No real acoustic model backs this —
 * `@ryper/local-runtime` has never had a production provider
 * implementation anywhere in this repository (confirmed: only test
 * fixtures exist), a pre-existing gap since Phase 4, not something this
 * phase's sandbox introduces. This exists so `LocalRuntimeManager`, and
 * therefore `LocalSpeechRecognitionProvider`/`LocalSpeechSynthesisProvider`
 * (both of which are real, correctly-implemented `@ryper/voice-engine`
 * adapter classes), have *something* real to construct against and can
 * be exercised end-to-end — transcription returns an honest placeholder
 * string rather than fabricated "recognized" text, and synthesis returns
 * a real, valid, silent WAV buffer rather than fabricated "spoken" audio.
 */
export class ReferenceVoiceRuntimeProvider implements LocalRuntimeProvider {
  readonly id = "reference-voice-runtime";
  readonly kind = "onnx" as const;
  readonly supportedModelTypes = ["asr", "tts"] as const;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async transcribe(_modelId: string, _request: ASRRequest): Promise<ASRResult> {
    return {
      text: "[no production speech-recognition model is installed — this is a reference placeholder transcript]",
    };
  }

  async synthesizeSpeech(_modelId: string, _request: TTSRequest): Promise<TTSResult> {
    // A real, valid, minimal 8kHz/16-bit/mono WAV file containing 100ms of silence — not
    // fabricated "speech," an honest silent placeholder with a correct, playable container format.
    const sampleRate = 8000;
    const durationSeconds = 0.1;
    const sampleCount = Math.floor(sampleRate * durationSeconds);
    const dataSize = sampleCount * 2; // 16-bit mono
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (offset: number, value: string): void => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);
    // Remaining bytes are already zero-initialized (silence).

    return { audioBytes: new Uint8Array(buffer) };
  }
}

export function createReferenceVoiceRuntimeProvider(): ReferenceVoiceRuntimeProvider {
  return new ReferenceVoiceRuntimeProvider();
}
