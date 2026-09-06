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

/** A controllable, real async-iterable frame source a test can push frames into on demand. */
class ControllableCaptureSource implements AudioDeviceSource, AudioCaptureSource {
  private queue: AudioFrame[] = [];
  private waiter: ((r: IteratorResult<AudioFrame>) => void) | undefined;
  private closed = false;

  push(frame: AudioFrame): void {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = undefined;
      w({ value: frame, done: false });
    } else {
      this.queue.push(frame);
    }
  }

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
    return {
      [Symbol.asyncIterator]: () => ({
        next: (): Promise<IteratorResult<AudioFrame>> => {
          if (this.queue.length > 0) {
            return Promise.resolve({ value: this.queue.shift() as AudioFrame, done: false });
          }
          if (this.closed)
            return Promise.resolve({ value: undefined as unknown as AudioFrame, done: true });
          return new Promise((resolve) => {
            this.waiter = resolve;
          });
        },
      }),
    };
  }
}

class FakePlaybackSink implements AudioPlaybackSink {
  public played: string[] = [];

  async play(
    _deviceId: string,
    chunks: AsyncIterable<TtsAudioChunk>,
    signal: AbortSignal,
  ): Promise<void> {
    let resolveWait: (() => void) | undefined;
    const onAbort = (): void => resolveWait?.();
    signal.addEventListener("abort", onAbort);
    try {
      for await (const chunk of chunks) {
        if (signal.aborted) return;
        this.played.push(new TextDecoder().decode(chunk.bytes));
        // Simulate real playback taking real wall-clock time, so a
        // barge-in mid-utterance has something to actually interrupt.
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
          setTimeout(resolve, 30);
        });
        if (signal.aborted) return;
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
  async setVolume(): Promise<void> {}
}

function buildPipeline(options: { sttTranscript: string; bargeInTranscript?: string }): {
  pipeline: VoicePipeline;
  captureSource: ControllableCaptureSource;
  playback: FakePlaybackSink;
  deviceManager: AudioDeviceManager;
  sessionManager: VoiceSessionManager;
  transitions: Array<{ from: string; to: string }>;
} {
  const eventBus = new EventBus();
  const transitions: Array<{ from: string; to: string }> = [];
  eventBus.on<{ from: string; to: string }>("voice_engine.session_transition", (event) => {
    transitions.push({ from: event.payload.from, to: event.payload.to });
  });

  const captureSource = new ControllableCaptureSource();
  const deviceManager = new AudioDeviceManager(captureSource);
  const microphoneManager = new MicrophoneManager(deviceManager, captureSource);
  const playback = new FakePlaybackSink();
  const speakerManager = new SpeakerManager(deviceManager, playback);
  const vad = new EnergyVoiceActivityDetector({ energyThreshold: 500, hangoverFrames: 1 });
  const sessionManager = new VoiceSessionManager({ eventBus });

  const sttRegistry = new SpeechRecognitionRegistry();
  let sttCallCount = 0;
  const transcripts = [options.sttTranscript, options.bargeInTranscript ?? options.sttTranscript];
  sttRegistry.register({
    id: "fake-stt",
    supportsOffline: true,
    async *streamRecognize(frames) {
      const text = transcripts[Math.min(sttCallCount, transcripts.length - 1)] as string;
      sttCallCount += 1;
      for await (const _f of frames) {
        /* consume */
      }
      yield { type: "final", text };
    },
  });

  const ttsRegistry = new SpeechSynthesisRegistry();
  ttsRegistry.register({
    id: "fake-tts",
    supportsOffline: true,
    voices: [],
    async *synthesizeStream(text) {
      for (const word of text.split(" ")) {
        yield { bytes: new TextEncoder().encode(word), mimeType: "audio/wav" };
      }
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
    aiOrchestrator: {
      async *sendMessage() {
        yield { type: "text_delta", delta: "Your meeting tomorrow is at ten AM and more." };
      },
    } as never,
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

  return { pipeline, captureSource, playback, deviceManager, sessionManager, transitions };
}

const device: DeviceState = { online: true } as DeviceState;

describe("VoicePipeline barge-in (Phase 13.7)", () => {
  it("completes a normal turn with no interruption and reports no bargeIn", async () => {
    const { pipeline, captureSource, deviceManager } = buildPipeline({ sttTranscript: "hello" });
    await deviceManager.refresh();
    const runPromise = pipeline.runTurn(device);

    captureSource.push(SPEECH_FRAME);
    for (let i = 0; i < 25; i++) captureSource.push(SILENCE_FRAME);

    // Real microphone hardware streams frames continuously — including
    // silence — which is what lets the barge-in monitor's abort actually
    // be observed once playback finishes on its own. Simulate that here
    // so the test doesn't depend on exact timing.
    let done = false;
    void runPromise.finally(() => {
      done = true;
    });
    const keepAlive = (async (): Promise<void> => {
      while (!done) {
        captureSource.push(SILENCE_FRAME);
        await new Promise((r) => setTimeout(r, 5));
      }
    })();

    const result = await runPromise;
    await keepAlive;
    expect(result.transcript).toBe("hello");
    expect(result.bargeIn).toBeUndefined();
  });

  it("real barge-in: user speech during SPEAKING stops playback immediately and is transcribed", async () => {
    const { pipeline, captureSource, playback, deviceManager, sessionManager, transitions } =
      buildPipeline({
        sttTranscript: "what time is my meeting",
        bargeInTranscript: "wait what time",
      });
    await deviceManager.refresh();

    const runPromise = pipeline.runTurn(device);

    captureSource.push(SPEECH_FRAME);
    for (let i = 0; i < 25; i++) captureSource.push(SILENCE_FRAME);

    await new Promise((r) => setTimeout(r, 20));

    captureSource.push(SPEECH_FRAME);
    for (let i = 0; i < 25; i++) captureSource.push(SILENCE_FRAME);

    const result = await runPromise;

    expect(result.bargeIn).toBeDefined();
    expect(result.bargeIn?.transcript).toBe("wait what time");
    const totalWords = "Your meeting tomorrow is at ten AM and more.".split(" ").length;
    expect(playback.played.length).toBeLessThan(totalWords);

    // The real, automatic barge-in path lands on `interrupted` — a
    // distinct, expected conversational event — never on `cancelled`,
    // which is reserved for an explicit external stop (see
    // `VoicePipeline.interrupt()`'s doc comment and docs/adr/0028).
    const sequence = transitions.map((t) => t.to);
    expect(sequence).toContain("interrupted");
    expect(sequence).not.toContain("cancelled");
    expect(sessionManager.getSnapshot().state).toBe("idle");
  });
});
