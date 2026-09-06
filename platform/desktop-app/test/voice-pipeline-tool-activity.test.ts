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

/** Same one-shot real capture source used by the retry/bargein voice-pipeline tests. */
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

function buildPipeline(aiOrchestrator: AIOrchestrator): {
  pipeline: VoicePipeline;
  deviceManager: AudioDeviceManager;
} {
  const eventBus = new EventBus();
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
      yield { type: "final", text: "open my notes" };
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

  return { pipeline, deviceManager };
}

const device: DeviceState = { online: true } as DeviceState;

describe("VoicePipeline — real tool-activity visibility (mirrors text-chat's)", () => {
  it("captures real tool_call/tool_result events from a voice turn, redacted the same way as text", async () => {
    const aiOrchestrator = {
      async *sendMessage(): AsyncGenerator<StreamEvent> {
        yield {
          type: "tool_call",
          toolCall: {
            id: "call-1",
            name: "open_file",
            arguments: { path: "C:/notes.txt", apiKey: "super-secret" },
          },
        };
        yield {
          type: "tool_result",
          toolCallId: "call-1",
          name: "open_file",
          ok: true,
          content: "Opened C:/notes.txt",
        };
        yield { type: "text_delta", delta: "Done, I opened it." };
      },
    } as unknown as AIOrchestrator;

    const { pipeline, deviceManager } = buildPipeline(aiOrchestrator);
    await deviceManager.refresh();
    const result = await pipeline.runTurn(device);

    expect(result.spokenResponse).toBe("Done, I opened it.");
    expect(result.toolActivity).toHaveLength(1);
    expect(result.toolActivity[0]).toMatchObject({
      name: "open_file",
      ok: true,
      resultSummary: "Opened C:/notes.txt",
    });
    expect(result.toolActivity[0]?.argsSummary).toContain("notes.txt");
    expect(result.toolActivity[0]?.argsSummary).not.toContain("super-secret");
    expect(result.toolActivity[0]?.argsSummary).toContain("[redacted]");
  });

  it("returns empty toolActivity when the command router handles the turn (no AI orchestrator call)", async () => {
    const aiOrchestrator = {
      async *sendMessage(): AsyncGenerator<StreamEvent> {
        yield { type: "text_delta", delta: "should not be called" };
      },
    } as unknown as AIOrchestrator;

    const eventBus = new EventBus();
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
        yield { type: "final", text: "raise the volume" };
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
      intentDetector: { detect: () => ({ intent: "volume_up", confidence: 1, slots: {} }) },
      commandRouter: { route: async () => ({ handled: true, spokenResponse: "Turned it up." }) },
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

    await deviceManager.refresh();
    const result = await pipeline.runTurn(device);

    expect(result.handledByCommand).toBe(true);
    expect(result.toolActivity).toEqual([]);
  });
});
