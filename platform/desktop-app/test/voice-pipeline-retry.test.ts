import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import {
  AudioDeviceManager,
  EnergyVoiceActivityDetector,
  MicrophoneManager,
  SpeakerManager,
  SpeechRecognitionRegistry,
  SpeechSynthesisRegistry,
  VoiceSessionManager,
  type AudioCaptureSource,
  type AudioDeviceSource,
  type AudioFrame,
  type AudioPlaybackSink,
  type TtsAudioChunk,
} from "@ryper/voice-engine";
import type { AIOrchestrator, StreamEvent } from "@ryper/ai-engine";
import type { DeviceState } from "@ryper/model-router";
import { VoicePipeline } from "../electron/voice-pipeline.js";

function toneFrame(amplitude: number): AudioFrame {
  const samples = new Int16Array(160);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.round(amplitude * Math.sin((2 * Math.PI * 440 * i) / 16000));
  }
  return { samples, sampleRateHz: 16000 };
}
const SPEECH_FRAME = toneFrame(10000);
const SILENCE_FRAME = toneFrame(0);

/**
 * A finite, real async-iterable frame source: one real utterance on the
 * first call (used for the turn's own capture/STT), then silence-only
 * on every subsequent call (used by `monitorForBargeIn`'s own,
 * concurrent capture) — a fresh loud "speech" frame on every call would
 * cause a spurious barge-in the moment monitoring starts, which isn't
 * what these tests are exercising.
 */
class OneShotCaptureSource implements AudioDeviceSource, AudioCaptureSource {
  private calls = 0;
  async listDevices() {
    return [
      {
        id: "mic-1",
        name: "Test Mic",
        kind: "microphone" as const,
        transport: "builtin" as const,
        isDefault: true,
        supportedSampleRatesHz: [16000],
      },
      {
        id: "speaker-1",
        name: "Test Speaker",
        kind: "speaker" as const,
        transport: "builtin" as const,
        isDefault: true,
        supportedSampleRatesHz: [16000],
      },
    ];
  }
  async hasPermission() {
    return true;
  }
  async requestPermission() {
    return true;
  }

  startCapture(): AsyncIterable<AudioFrame> {
    const isFirstCall = this.calls === 0;
    this.calls += 1;
    return {
      async *[Symbol.asyncIterator]() {
        if (isFirstCall) yield SPEECH_FRAME;
        for (let i = 0; i < 25; i++) yield SILENCE_FRAME;
      },
    };
  }
}

class FakePlaybackSink implements AudioPlaybackSink {
  public played: string[] = [];
  async play(_deviceId: string, chunks: AsyncIterable<TtsAudioChunk>): Promise<void> {
    for await (const chunk of chunks) this.played.push(new TextDecoder().decode(chunk.bytes));
  }
  async setVolume(): Promise<void> {}
}

/**
 * Builds a real `VoicePipeline` wired to a real `VoiceSessionManager`
 * sharing an `EventBus`, with a caller-supplied `aiOrchestrator` so a
 * test can inject a transient failure and observe the real retry.
 */
function buildPipeline(aiOrchestrator: AIOrchestrator): {
  pipeline: VoicePipeline;
  transitions: Array<{ from: string; to: string }>;
  deviceManager: AudioDeviceManager;
} {
  const eventBus = new EventBus();
  const transitions: Array<{ from: string; to: string }> = [];
  eventBus.on<{ from: string; to: string }>("voice_engine.session_transition", (event) => {
    transitions.push({ from: event.payload.from, to: event.payload.to });
  });

  const captureSource = new OneShotCaptureSource();
  const deviceManager = new AudioDeviceManager(captureSource);
  const microphoneManager = new MicrophoneManager(deviceManager, captureSource);
  const speakerManager = new SpeakerManager(deviceManager, new FakePlaybackSink());
  const vad = new EnergyVoiceActivityDetector({ energyThreshold: 500, hangoverFrames: 1 });
  const sessionManager = new VoiceSessionManager({ eventBus });

  const sttRegistry = new SpeechRecognitionRegistry();
  sttRegistry.register({
    id: "fake-stt",
    supportsOffline: true,
    async *streamRecognize(frames) {
      for await (const _f of frames) {
        /* consume */
      }
      yield { type: "final", text: "hello" };
    },
  });

  const ttsRegistry = new SpeechSynthesisRegistry();
  ttsRegistry.register({
    id: "fake-tts",
    supportsOffline: true,
    voices: [],
    async *synthesizeStream(text) {
      yield { bytes: new TextEncoder().encode(text), mimeType: "audio/wav" };
    },
  });

  const pipeline = new VoicePipeline({
    sessionManager,
    microphoneManager,
    speakerManager,
    vad,
    sttRegistry,
    ttsRegistry,
    intentDetector: { detect: () => undefined },
    commandRouter: { route: async () => ({ handled: false }) },
    contextManager: {
      recordUserUtterance: async () => {},
      recordAssistantUtterance: async () => {},
      getRelevantContext: async () => [],
    },
    aiOrchestrator,
    settings: {
      get: () => ({ offlineCloudPreference: "offline-only", language: "en-US" }),
    } as never,
    diagnostics: {
      startSession: () => {},
      recordStage: () => {},
      recordError: () => {},
    } as never,
    analytics: {
      recordCommandHandled: () => {},
      recordSessionCompleted: () => {},
      recordSessionCancelled: () => {},
    } as never,
    eventBus,
  });

  return { pipeline, transitions, deviceManager };
}

const device: DeviceState = { online: true } as DeviceState;

describe("VoicePipeline — real automatic retry (closes the ADR 0028 asymmetry)", () => {
  it("retries once on a transient AI-orchestrator error and recovers, passing through `recovering`", async () => {
    let attempt = 0;
    const aiOrchestrator = {
      async *sendMessage(): AsyncGenerator<StreamEvent> {
        attempt += 1;
        if (attempt === 1) {
          yield { type: "error", message: "transient provider hiccup" };
          return;
        }
        yield { type: "text_delta", delta: "Recovered." };
      },
    } as unknown as AIOrchestrator;

    const { pipeline, transitions, deviceManager } = buildPipeline(aiOrchestrator);
    await deviceManager.refresh();
    const result = await pipeline.runTurn(device);

    expect(attempt).toBe(2);
    expect(result.spokenResponse).toBe("Recovered.");
    const sequence = transitions.map((t) => t.to);
    expect(sequence).toEqual([
      "listening",
      "transcribing",
      "thinking",
      "recovering",
      "thinking",
      "speaking",
      "idle",
    ]);
  });

  it("gives up after exhausting retries and reports a real error, leaving the session in `error`", async () => {
    const aiOrchestrator = {
      async *sendMessage(): AsyncGenerator<StreamEvent> {
        yield { type: "error", message: "provider is down" };
      },
    } as unknown as AIOrchestrator;

    const { pipeline, transitions, deviceManager } = buildPipeline(aiOrchestrator);
    await deviceManager.refresh();
    await expect(pipeline.runTurn(device)).rejects.toThrow(/provider is down/);

    const sequence = transitions.map((t) => t.to);
    expect(sequence).toEqual([
      "listening",
      "transcribing",
      "thinking",
      "recovering",
      "thinking",
      "error",
    ]);
  });
});
