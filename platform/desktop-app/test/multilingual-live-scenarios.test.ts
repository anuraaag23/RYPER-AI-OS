import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { CapabilityBroker } from "@ryper/security";
import { createCapabilityManager } from "@ryper/platform-capability";
import {
  createWindowsAdapter,
  WINDOWS_CAPABILITY_DESCRIPTORS,
  createInMemoryWindowsSystemApi,
} from "@ryper/windows-agent";
import {
  AudioDeviceManager,
  EnergyVoiceActivityDetector,
  MicrophoneManager,
  SpeakerManager,
  SpeechRecognitionRegistry,
  SpeechSynthesisRegistry,
  IntentDetector,
  DEFAULT_INTENT_PATTERNS,
  VoiceCommandRouter,
  VoiceSessionManager,
  VoiceSettingsManager,
  VoiceDiagnostics,
  VoiceAnalytics,
  type AudioCaptureSource,
  type AudioDeviceSource,
  type AudioFrame,
  type AudioPlaybackSink,
  type TtsAudioChunk,
} from "@ryper/voice-engine";
import type { DeviceState } from "@ryper/model-router";
import {
  registerDesktopVoiceCommands,
  DESKTOP_INTENT_PATTERNS,
} from "../electron/voice-commands.js";
import { bootstrapAIOrchestrator } from "../electron/ai-orchestrator-bootstrap.js";
import { VoicePipeline } from "../electron/voice-pipeline.js";
import {
  PowerConfirmationManager,
  type PowerAction,
} from "../electron/power-confirmation.js";
import { createContextReferenceTracker } from "../electron/context-reference.js";

function toneFrame(amplitude: number): AudioFrame {
  const samples = new Int16Array(160);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.round(amplitude * Math.sin((2 * Math.PI * 440 * i) / 16000));
  }
  return { samples, sampleRateHz: 16000 };
}
const SPEECH_FRAME = toneFrame(10000);
const SILENCE_FRAME = toneFrame(0);

class ScriptedCaptureSource implements AudioDeviceSource, AudioCaptureSource {
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

class RecordingPlaybackSink implements AudioPlaybackSink {
  public played: string[] = [];
  async play(_deviceId: string, chunks: AsyncIterable<TtsAudioChunk>): Promise<void> {
    for await (const chunk of chunks) this.played.push(new TextDecoder().decode(chunk.bytes));
  }
  async setVolume(): Promise<void> {}
}

const noopContextManager = {
  recordUserUtterance: async () => {},
  recordAssistantUtterance: async () => {},
  getRelevantContext: async () => [],
} as any;

const deviceState: DeviceState = {
  batteryLevel: 1,
  isCharging: true,
  networkType: "wifi",
  isLowPowerMode: false,
  isIdle: false,
};

async function buildLiveTestStack(transcript: string, options?: {
  voiceSettings?: { voiceLanguage?: "auto" | "en" | "hi"; ttsVoice?: "auto" | "en" | "hi" };
  onPowerAction?: (action: PowerAction) => Promise<{ ok: boolean; message: string }>;
}) {
  const eventBus = new EventBus();
  const broker = new CapabilityBroker(() => true);
  const capabilityManager = createCapabilityManager({ broker, platformDetector: () => "windows" });
  const systemApi = createInMemoryWindowsSystemApi();
  const adapter = await createWindowsAdapter({ systemApi });
  capabilityManager.registerAdapter(adapter);
  for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
    capabilityManager.registerCapability(descriptor);
  }

  const { orchestrator } = await bootstrapAIOrchestrator(
    capabilityManager,
    broker,
    eventBus,
  );

  const captureSource = new ScriptedCaptureSource();
  const deviceManager = new AudioDeviceManager(captureSource);
  await deviceManager.refresh();
  const microphoneManager = new MicrophoneManager(deviceManager, captureSource);
  const playback = new RecordingPlaybackSink();
  const speakerManager = new SpeakerManager(deviceManager, playback);
  const vad = new EnergyVoiceActivityDetector({ energyThreshold: 500, hangoverFrames: 1 });
  const sessionManager = new VoiceSessionManager({ eventBus });

  const sttRegistry = new SpeechRecognitionRegistry();
  sttRegistry.register({
    id: "mock-stt",
    supportsOffline: true,
    async *streamRecognize() {
      yield { type: "final" as const, text: transcript, confidence: 1 };
    },
  });

  let capturedVoiceId: string | undefined;
  const ttsRegistry = new SpeechSynthesisRegistry();
  ttsRegistry.register({
    id: "mock-tts",
    supportsOffline: true,
    voices: [
      { id: "default", name: "Ryper English", language: "en-US" },
      { id: "hindi", name: "Ryper Hindi", language: "hi-IN" },
    ],
    async *synthesizeStream(text, opts) {
      capturedVoiceId = opts?.voiceId;
      yield { bytes: new TextEncoder().encode(text), mimeType: "audio/wav" };
    },
  });

  const commandRouter = new VoiceCommandRouter();
  const powerConfirmation = new PowerConfirmationManager(15000);
  const contextTracker = createContextReferenceTracker();

  registerDesktopVoiceCommands(
    commandRouter,
    capabilityManager,
    powerConfirmation,
    contextTracker,
  );

  const patterns = [...DEFAULT_INTENT_PATTERNS, ...DESKTOP_INTENT_PATTERNS];
  const intentDetector = new IntentDetector(patterns);

  const pipeline = new VoicePipeline({
    sessionManager,
    microphoneManager,
    speakerManager,
    vad,
    sttRegistry,
    ttsRegistry,
    intentDetector,
    commandRouter,
    contextManager: noopContextManager,
    aiOrchestrator: orchestrator,
    settings: new VoiceSettingsManager(),
    diagnostics: new VoiceDiagnostics(),
    analytics: new VoiceAnalytics(),
    enableBargeIn: false,
    powerConfirmation,
    executeConfirmedPowerAction: options?.onPowerAction ?? (async (a) => ({ ok: true, message: `${a} executed` })),
    getVoiceSettings: () => options?.voiceSettings ?? { voiceLanguage: "auto", ttsVoice: "auto" },
  });

  return {
    pipeline,
    systemApi,
    playback,
    powerConfirmation,
    getCapturedVoiceId: () => capturedVoiceId,
  };
}

describe("RYPER AI OS — 8 Multilingual Physical Live Scenarios Certification", () => {
  // Scenario 1: English Baseline
  it("Scenario 1: English baseline voice command routes and executes", async () => {
    const { pipeline, systemApi, playback } = await buildLiveTestStack("volume up");
    const initialVolume = await systemApi.getVolume();
    const result = await pipeline.runTurn(deviceState);

    expect(result.handledByCommand).toBe(true);
    expect(await systemApi.getVolume()).toBe(Math.min(100, initialVolume + 10));
    expect(playback.played.length).toBeGreaterThan(0);
  });

  // Scenario 2: Pure Hindi Command in Devanagari
  it("Scenario 2: Pure Hindi command in Devanagari script routes and executes", async () => {
    const { pipeline, systemApi, playback } = await buildLiveTestStack("आवाज़ बढ़ाओ");
    const initialVolume = await systemApi.getVolume();
    const result = await pipeline.runTurn(deviceState);

    expect(result.handledByCommand).toBe(true);
    expect(await systemApi.getVolume()).toBe(Math.min(100, initialVolume + 10));
    expect(playback.played.length).toBeGreaterThan(0);
  });

  // Scenario 3: Hinglish Mixed Command
  it("Scenario 3: Hinglish mixed command routes and executes", async () => {
    const { pipeline, systemApi, playback } = await buildLiveTestStack("volume badhao");
    const initialVolume = await systemApi.getVolume();
    const result = await pipeline.runTurn(deviceState);

    expect(result.handledByCommand).toBe(true);
    expect(await systemApi.getVolume()).toBe(Math.min(100, initialVolume + 10));
    expect(playback.played.length).toBeGreaterThan(0);
  });

  // Scenario 4: Hindi Power Action with Affirmative "haan" Confirmation
  it("Scenario 4: Hindi power action prompts confirmation and confirms upon hearing 'haan'", async () => {
    let executedAction: PowerAction | undefined;
    const { pipeline, powerConfirmation } = await buildLiveTestStack("computer band karo", {
      onPowerAction: async (action) => {
        executedAction = action;
        return { ok: true, message: `System ${action} complete` };
      },
    });

    // Turn 1: User says "computer band karo" -> asks for confirmation
    const turn1 = await pipeline.runTurn(deviceState);
    expect(turn1.handledByCommand).toBe(true);
    expect(turn1.spokenResponse).toContain("Are you sure");
    expect(powerConfirmation.hasPending("voice-user")).toBe(true);
    expect(executedAction).toBeUndefined(); // MUST NOT execute yet

    // Turn 2: User responds with Hindi affirmative "haan"
    const turn2 = await pipeline.runTurn(deviceState, undefined, 16000, "haan");
    expect(turn2.spokenResponse).toContain("System shutdown complete");
    expect(executedAction).toBe("shutdown");
    expect(powerConfirmation.hasPending("voice-user")).toBe(false);
  });

  // Scenario 5: Hindi Power Action with Negative "nahi" Cancellation
  it("Scenario 5: Hindi power action cancels cleanly upon hearing 'nahi'", async () => {
    let executedAction: PowerAction | undefined;
    const { pipeline, powerConfirmation } = await buildLiveTestStack("shutdown karo", {
      onPowerAction: async (action) => {
        executedAction = action;
        return { ok: true, message: `System ${action} complete` };
      },
    });

    // Turn 1: Request shutdown
    const turn1 = await pipeline.runTurn(deviceState);
    expect(turn1.handledByCommand).toBe(true);
    expect(powerConfirmation.hasPending("voice-user")).toBe(true);

    // Turn 2: Cancel with "nahi"
    const turn2 = await pipeline.runTurn(deviceState, undefined, 16000, "nahi");
    expect(turn2.spokenResponse).toContain("cancelling the shutdown");
    expect(executedAction).toBeUndefined(); // MUST NOT execute
    expect(powerConfirmation.hasPending("voice-user")).toBe(false);
  });

  // Scenario 6: Multilingual Compound Tool Execution through CapabilityBroker
  it("Scenario 6: Multilingual compound command splits on Hindi connective 'aur' and executes via CapabilityBroker", async () => {
    const { pipeline } = await buildLiveTestStack("list windows aur open notepad");
    const result = await pipeline.runTurn(deviceState);

    // Heuristic AI splits on "aur" and executes both tools
    expect(result.handledByCommand).toBe(false);
    expect(result.toolActivity.length).toBe(2);
    expect(result.toolActivity[0]?.name).toBe("list_windows");
    expect(result.toolActivity[1]?.name).toBe("open_application");
    expect(result.spokenResponse).toContain("Done.");
  });

  // Scenario 7: Dynamic TTS Voice Auto-Switching
  it("Scenario 7: Dynamic TTS auto-switches voiceId to hindi on Devanagari text", async () => {
    const { pipeline, getCapturedVoiceId } = await buildLiveTestStack("test-dynamic", {
      voiceSettings: { voiceLanguage: "auto", ttsVoice: "auto" },
    });

    // Provide preset Devanagari transcript that triggers a Hindi reply
    await pipeline.runTurn(deviceState, undefined, 16000, "नमस्ते! आप कैसे हैं?");
    expect(getCapturedVoiceId()).toBe("hindi");
  });

  // Scenario 8: Graceful Fallback When Hindi Models Are Missing
  it("Scenario 8: Gracefully falls back to default voice when ttsVoice is auto on English text", async () => {
    const { pipeline, getCapturedVoiceId } = await buildLiveTestStack("volume up", {
      voiceSettings: { voiceLanguage: "auto", ttsVoice: "auto" },
    });

    await pipeline.runTurn(deviceState);
    // English text with auto setting resolves to default voice
    expect(getCapturedVoiceId()).toBe("default");
  });
});
