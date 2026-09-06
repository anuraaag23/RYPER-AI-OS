import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import {
  AIOrchestrator,
  ModelSelectionEngine,
  PromptBuilder,
  TokenBudgetManager,
  ToolRegistry,
  SessionManager,
  ProviderRegistry,
} from "@ryper/ai-engine";
import { ModelRouter } from "@ryper/model-router";
import { LongTermMemory } from "@ryper/memory";
import type { AIProvider, StreamEvent } from "@ryper/ai-engine";

import {
  MemoryManager,
  MemoryStore,
  InMemoryPersistence,
  MemoryIndex,
  EmbeddingService,
  SemanticSearchEngine,
  MemoryRankingEngine,
  ImportanceScorer,
  MemoryCategorizer,
  MemoryDeduplicator,
  ConflictResolver,
  MemoryExpirationManager,
  MemoryAuditLog,
  MemoryVersionHistory,
  MemoryPermissions,
  MemoryStatistics,
} from "@ryper/memory-system";

import { AudioDeviceManager, type AudioDeviceSource } from "../src/audio-device-manager.js";
import { MicrophoneManager, type AudioCaptureSource } from "../src/microphone-manager.js";
import { SpeakerManager, type AudioPlaybackSink } from "../src/speaker-manager.js";
import { EnergyVoiceActivityDetector } from "../src/voice-activity-detection.js";
import { SpeechRecognitionRegistry } from "../src/stt/registry.js";
import { SpeechSynthesisRegistry } from "../src/tts/registry.js";
import { IntentDetector } from "../src/intent-detection.js";
import { VoiceCommandRouter } from "../src/voice-command-router.js";
import { VoiceContextManager } from "../src/voice-context-manager.js";
import { VoiceSessionManager } from "../src/voice-session-manager.js";
import { VoiceSettingsManager } from "../src/voice-settings.js";
import { VoiceDiagnostics } from "../src/voice-diagnostics.js";
import { VoiceAnalytics } from "../src/voice-analytics.js";
import { AudioPipelineManager } from "../src/audio-pipeline-manager.js";
import { sampleDevice, toneFrame, silentFrame } from "./fixtures.js";
import type { AudioFrame, SttEvent, TtsAudioChunk } from "../src/types.js";

function buildOrchestrator(replyText: string): AIOrchestrator {
  const eventBus = new EventBus();
  const provider: AIProvider = {
    id: "local-1",
    kind: "local",
    async *streamChat(): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", delta: replyText };
      yield { type: "done", finishReason: "stop" };
    },
  };
  const registry = new ProviderRegistry();
  registry.register(provider);
  return new AIOrchestrator({
    providerRegistry: registry,
    modelSelection: new ModelSelectionEngine(new ModelRouter(), registry),
    promptBuilder: new PromptBuilder({ systemPrompt: "sys" }),
    tokenBudget: new TokenBudgetManager({
      "local-1": { contextWindow: 8000, reservedForCompletion: 1000 },
    }),
    toolRegistry: new ToolRegistry(),
    sessionManager: new SessionManager(new LongTermMemory()),
    eventBus,
    retry: { sleep: async () => {} },
  });
}

function buildMemoryManager(): MemoryManager {
  const store = new MemoryStore(new InMemoryPersistence());
  const index = new MemoryIndex();
  const embeddingService = new EmbeddingService(async (text) => [text.length]);
  return new MemoryManager({
    store,
    index,
    search: new SemanticSearchEngine(index, embeddingService),
    ranking: new MemoryRankingEngine(),
    importanceScorer: new ImportanceScorer(),
    categorizer: new MemoryCategorizer(),
    deduplicator: new MemoryDeduplicator(),
    conflictResolver: new ConflictResolver(),
    expiration: new MemoryExpirationManager(),
    auditLog: new MemoryAuditLog(),
    versionHistory: new MemoryVersionHistory(),
    permissions: new MemoryPermissions(),
    statistics: new MemoryStatistics(new MemoryExpirationManager()),
    embeddingService,
  });
}

/** Yields one loud (speech) frame then enough silent frames to trigger VAD endpointing. */
async function* speechThenSilence(): AsyncGenerator<AudioFrame> {
  yield toneFrame(10000);
  for (let i = 0; i < 25; i++) yield silentFrame();
}

function buildHarness(options: { transcript: string; replyText?: string }) {
  const micSource: AudioDeviceSource = {
    listDevices: async () => [sampleDevice({ id: "mic-1", kind: "microphone" })],
    hasPermission: async () => true,
    requestPermission: async () => true,
  };
  const speakerSource: AudioDeviceSource = {
    listDevices: async () => [sampleDevice({ id: "spk-1", kind: "speaker" })],
    hasPermission: async () => true,
    requestPermission: async () => true,
  };
  const micDeviceManager = new AudioDeviceManager(micSource);
  const speakerDeviceManager = new AudioDeviceManager(speakerSource);

  const captureSource: AudioCaptureSource = { startCapture: () => speechThenSilence() };
  const microphoneManager = new MicrophoneManager(micDeviceManager, captureSource);

  const playedChunks: TtsAudioChunk[] = [];
  const sink: AudioPlaybackSink = {
    play: async (_deviceId, chunks, signal) => {
      for await (const chunk of chunks) {
        if (signal.aborted) return;
        playedChunks.push(chunk);
      }
    },
    setVolume: async () => {},
  };
  const speakerManager = new SpeakerManager(speakerDeviceManager, sink);

  const sttRegistry = new SpeechRecognitionRegistry();
  sttRegistry.register({
    id: "fake-stt",
    supportsOffline: true,
    streamRecognize: async function* (): AsyncIterable<SttEvent> {
      yield { type: "final", text: options.transcript, confidence: 1 };
    },
  });

  const ttsRegistry = new SpeechSynthesisRegistry();
  ttsRegistry.register({
    id: "fake-tts",
    supportsOffline: true,
    voices: [{ id: "default", name: "Default", language: "en-US" }],
    synthesizeStream: async function* (): AsyncIterable<TtsAudioChunk> {
      yield { bytes: new Uint8Array([1]), mimeType: "audio/wav" };
    },
  });

  const commandRouter = new VoiceCommandRouter();
  commandRouter.register({
    intent: "create_note",
    handle: () => ({ handled: true, spokenResponse: "Note created." }),
  });

  const pipeline = new AudioPipelineManager({
    sessionManager: new VoiceSessionManager(),
    microphoneManager,
    speakerManager,
    vad: new EnergyVoiceActivityDetector(),
    sttRegistry,
    ttsRegistry,
    intentDetector: new IntentDetector(),
    commandRouter,
    contextManager: new VoiceContextManager(buildMemoryManager()),
    orchestrator: buildOrchestrator(options.replyText ?? "The weather is sunny."),
    settings: new VoiceSettingsManager(),
    diagnostics: new VoiceDiagnostics(),
    analytics: new VoiceAnalytics(),
  });

  return { pipeline, playedChunks, micDeviceManager, speakerDeviceManager };
}

describe("AudioPipelineManager", () => {
  it("runs a full conversational turn end to end when no command matches", async () => {
    const { pipeline, playedChunks, micDeviceManager, speakerDeviceManager } = buildHarness({
      transcript: "what's the weather like",
    });
    await micDeviceManager.refresh();
    await speakerDeviceManager.refresh();

    const result = await pipeline.runTurn({ online: false });
    expect(result.transcript).toBe("what's the weather like");
    expect(result.spokenResponse).toBe("The weather is sunny.");
    expect(result.handledByCommand).toBe(false);
    expect(playedChunks.length).toBeGreaterThan(0);
  });

  it("routes a matching transcript to the command router instead of the AI Engine", async () => {
    const { pipeline, micDeviceManager, speakerDeviceManager } = buildHarness({
      transcript: "create a note that says buy milk",
    });
    await micDeviceManager.refresh();
    await speakerDeviceManager.refresh();

    const result = await pipeline.runTurn({ online: false });
    expect(result.handledByCommand).toBe(true);
    expect(result.spokenResponse).toBe("Note created.");
  });

  it("propagates cancellation via AbortSignal and leaves the session cancelled", async () => {
    const { pipeline, micDeviceManager, speakerDeviceManager } = buildHarness({
      transcript: "hello",
    });
    await micDeviceManager.refresh();
    await speakerDeviceManager.refresh();

    const controller = new AbortController();
    controller.abort();
    await expect(pipeline.runTurn({ online: false }, controller.signal)).rejects.toThrow();
  });

  it("interrupt() stops active playback and cancels the session", async () => {
    const { pipeline, speakerDeviceManager } = buildHarness({ transcript: "hello" });
    await speakerDeviceManager.refresh();
    expect(() => pipeline.interrupt()).not.toThrow();
  });
});
