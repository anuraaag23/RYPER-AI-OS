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

/**
 * Builds a real `AudioPipelineManager` wired to a `VoiceSessionManager`
 * that shares an `EventBus` with the rest of the harness, so a test can
 * observe the exact, real sequence of `voice_engine.session_transition`
 * events a turn produces — not just its final state.
 */
function buildHarness(options: {
  transcript: string;
  provider: AIProvider;
  toolRegistry?: ToolRegistry;
  retrySleep?: (ms: number) => Promise<void>;
  commandRouter?: VoiceCommandRouter;
}) {
  const eventBus = new EventBus();
  const transitions: Array<{ from: string; to: string }> = [];
  eventBus.on<{ from: string; to: string }>("voice_engine.session_transition", (event) => {
    transitions.push({ from: event.payload.from, to: event.payload.to });
  });

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

  const commandRouter = options.commandRouter ?? new VoiceCommandRouter();

  const registry = new ProviderRegistry();
  registry.register(options.provider);

  const orchestrator = new AIOrchestrator({
    providerRegistry: registry,
    modelSelection: new ModelSelectionEngine(new ModelRouter(), registry),
    promptBuilder: new PromptBuilder({ systemPrompt: "sys" }),
    tokenBudget: new TokenBudgetManager({
      "local-1": { contextWindow: 8000, reservedForCompletion: 1000 },
    }),
    toolRegistry: options.toolRegistry ?? new ToolRegistry(),
    sessionManager: new SessionManager(new LongTermMemory()),
    eventBus,
    retry: { sleep: async () => {} },
  });

  const sessionManager = new VoiceSessionManager({ eventBus });

  const pipeline = new AudioPipelineManager({
    sessionManager,
    microphoneManager,
    speakerManager,
    vad: new EnergyVoiceActivityDetector(),
    sttRegistry,
    ttsRegistry,
    intentDetector: new IntentDetector(),
    commandRouter,
    contextManager: new VoiceContextManager(buildMemoryManager()),
    orchestrator,
    settings: new VoiceSettingsManager(),
    diagnostics: new VoiceDiagnostics(),
    analytics: new VoiceAnalytics(),
    eventBus,
  });

  return { pipeline, playedChunks, micDeviceManager, speakerDeviceManager, transitions };
}

describe("AudioPipelineManager — expanded voice state machine (Tier 1 completion pass)", () => {
  it("enters transcribing between listening and thinking on a normal turn", async () => {
    const provider: AIProvider = {
      id: "local-1",
      kind: "local",
      async *streamChat(): AsyncIterable<StreamEvent> {
        yield { type: "text_delta", delta: "Sure." };
        yield { type: "done", finishReason: "stop" };
      },
    };
    const { pipeline, micDeviceManager, speakerDeviceManager, transitions } = buildHarness({
      transcript: "hello",
      provider,
    });
    await micDeviceManager.refresh();
    await speakerDeviceManager.refresh();

    await pipeline.runTurn({ online: false });

    const sequence = transitions.map((t) => t.to);
    expect(sequence).toEqual(["listening", "transcribing", "thinking", "speaking", "idle"]);
  });

  it("enters tool_execution and returns to thinking for a real tool-calling round", async () => {
    const toolRegistry = new ToolRegistry();
    toolRegistry.register({
      spec: {
        name: "get_time",
        description: "Returns the current time.",
        parameters: { type: "object", properties: {} },
      },
      execute: () => ({ time: "10:00" }),
    });

    let round = 0;
    const provider: AIProvider = {
      id: "local-1",
      kind: "local",
      async *streamChat(): AsyncIterable<StreamEvent> {
        round += 1;
        if (round === 1) {
          yield {
            type: "tool_call",
            toolCall: { id: "call-1", name: "get_time", arguments: {} },
          };
          yield { type: "done", finishReason: "tool_calls" };
        } else {
          yield { type: "text_delta", delta: "It's 10:00." };
          yield { type: "done", finishReason: "stop" };
        }
      },
    };

    const { pipeline, micDeviceManager, speakerDeviceManager, transitions } = buildHarness({
      transcript: "what time is it",
      provider,
      toolRegistry,
    });
    await micDeviceManager.refresh();
    await speakerDeviceManager.refresh();

    const result = await pipeline.runTurn({ online: false });

    expect(result.spokenResponse).toBe("It's 10:00.");
    const sequence = transitions.map((t) => t.to);
    expect(sequence).toEqual([
      "listening",
      "transcribing",
      "thinking",
      "tool_execution",
      "thinking",
      "speaking",
      "idle",
    ]);
  });

  it("enters recovering on a real automatic retry and lands on speaking/idle after recovery", async () => {
    let attempt = 0;
    const provider: AIProvider = {
      id: "local-1",
      kind: "local",
      async *streamChat(): AsyncIterable<StreamEvent> {
        attempt += 1;
        if (attempt === 1) {
          yield { type: "error", message: "transient provider hiccup" };
          yield { type: "done", finishReason: "error" };
          return;
        }
        yield { type: "text_delta", delta: "Recovered." };
        yield { type: "done", finishReason: "stop" };
      },
    };

    const { pipeline, micDeviceManager, speakerDeviceManager, transitions } = buildHarness({
      transcript: "hello",
      provider,
    });
    await micDeviceManager.refresh();
    await speakerDeviceManager.refresh();

    const result = await pipeline.runTurn({ online: false });

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

  it("interrupt() lands on cancelled (core AudioPipelineManager has no automatic barge-in — that's electron VoicePipeline-only, see docs/adr/0028)", async () => {
    const provider: AIProvider = {
      id: "local-1",
      kind: "local",
      async *streamChat(): AsyncIterable<StreamEvent> {
        yield { type: "text_delta", delta: "Speaking now." };
        yield { type: "done", finishReason: "stop" };
      },
    };
    // Slow playback so the test has a real window to call interrupt()
    // while the session is genuinely still "speaking".
    const eventBus = new EventBus();
    const transitions: Array<{ from: string; to: string }> = [];
    eventBus.on<{ from: string; to: string }>("voice_engine.session_transition", (event) => {
      transitions.push({ from: event.payload.from, to: event.payload.to });
    });

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

    let releasePlayback: (() => void) | undefined;
    const sink: AudioPlaybackSink = {
      play: async (_deviceId, chunks, signal) => {
        for await (const _chunk of chunks) {
          if (signal.aborted) return;
          await new Promise<void>((resolve) => {
            releasePlayback = resolve;
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          if (signal.aborted) return;
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
        yield { type: "final", text: "hello", confidence: 1 };
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

    const registry = new ProviderRegistry();
    registry.register(provider);
    const orchestrator = new AIOrchestrator({
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

    const sessionManager = new VoiceSessionManager({ eventBus });
    const pipeline = new AudioPipelineManager({
      sessionManager,
      microphoneManager,
      speakerManager,
      vad: new EnergyVoiceActivityDetector(),
      sttRegistry,
      ttsRegistry,
      intentDetector: new IntentDetector(),
      commandRouter: new VoiceCommandRouter(),
      contextManager: new VoiceContextManager(buildMemoryManager()),
      orchestrator,
      settings: new VoiceSettingsManager(),
      diagnostics: new VoiceDiagnostics(),
      analytics: new VoiceAnalytics(),
      eventBus,
    });

    await micDeviceManager.refresh();
    await speakerDeviceManager.refresh();

    const runPromise = pipeline.runTurn({ online: false });

    // Poll for playback to actually start (session reaches "speaking")
    // before interrupting — real async timing, not a fixed sleep.
    for (let i = 0; i < 200 && sessionManager.getSnapshot().state !== "speaking"; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(sessionManager.getSnapshot().state).toBe("speaking");

    expect(() => pipeline.interrupt()).not.toThrow();
    void releasePlayback;

    // Interrupting playback here makes the sink's `play()` resolve
    // gracefully (it observes the abort and returns) rather than throw,
    // so the turn completes normally — just with a `cancelled` hop in
    // its transition history instead of a clean `speaking -> idle`.
    const result = await runPromise;
    expect(result.spokenResponse).toBe("Speaking now.");
    expect(sessionManager.getSnapshot().state).toBe("idle");

    const sequence = transitions.map((t) => t.to);
    expect(sequence).toContain("cancelled");
    expect(sequence).not.toContain("interrupted");
  });
});

describe("AudioPipelineManager — real STT/TTS lifecycle edge cases (Tier 1 completion pass, continued; see docs/adr/0029)", () => {
  const stopProvider: AIProvider = {
    id: "local-1",
    kind: "local",
    async *streamChat(): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", delta: "unused" };
      yield { type: "done", finishReason: "stop" };
    },
  };

  it("an empty/whitespace-only STT final transcript is treated as no result, not sent to the AI Engine", async () => {
    const { pipeline, micDeviceManager, speakerDeviceManager } = buildHarness({
      transcript: "   ",
      provider: stopProvider,
    });
    await micDeviceManager.refresh();
    await speakerDeviceManager.refresh();

    await expect(pipeline.runTurn({ online: false })).rejects.toThrow(
      "speech recognition produced no result",
    );
  });

  it("a whitespace-only AI Engine response is treated as empty, not silently 'spoken' as nothing", async () => {
    const whitespaceProvider: AIProvider = {
      id: "local-1",
      kind: "local",
      async *streamChat(): AsyncIterable<StreamEvent> {
        yield { type: "text_delta", delta: "   " };
        yield { type: "done", finishReason: "stop" };
      },
    };
    const { pipeline, micDeviceManager, speakerDeviceManager } = buildHarness({
      transcript: "hello",
      provider: whitespaceProvider,
    });
    await micDeviceManager.refresh();
    await speakerDeviceManager.refresh();

    await expect(pipeline.runTurn({ online: false })).rejects.toThrow(
      "AI Engine returned an empty response",
    );
  });

  it("a command handler returning an empty spokenResponse falls back to a real spoken 'Done.', not silence", async () => {
    const commandRouter = new VoiceCommandRouter();
    commandRouter.register({
      intent: "open_application",
      handle: async () => ({ handled: true, spokenResponse: "" }),
    });
    const { pipeline, playedChunks, micDeviceManager, speakerDeviceManager } = buildHarness({
      transcript: "open notepad",
      provider: stopProvider,
      commandRouter,
    });
    await micDeviceManager.refresh();
    await speakerDeviceManager.refresh();

    const result = await pipeline.runTurn({ online: false });

    expect(result.spokenResponse).toBe("Done.");
    // Real evidence TTS actually synthesized something audible, not the
    // zero real chunks `chunkForSpeech("")` would previously have
    // produced for a truly empty response.
    expect(playedChunks.length).toBeGreaterThan(0);
  });

  it("a command handler returning a whitespace-only spokenResponse also falls back to 'Done.'", async () => {
    const commandRouter = new VoiceCommandRouter();
    commandRouter.register({
      intent: "open_application",
      handle: async () => ({ handled: true, spokenResponse: "   " }),
    });
    const { pipeline, micDeviceManager, speakerDeviceManager } = buildHarness({
      transcript: "open notepad",
      provider: stopProvider,
      commandRouter,
    });
    await micDeviceManager.refresh();
    await speakerDeviceManager.refresh();

    const result = await pipeline.runTurn({ online: false });

    expect(result.spokenResponse).toBe("Done.");
  });
});
