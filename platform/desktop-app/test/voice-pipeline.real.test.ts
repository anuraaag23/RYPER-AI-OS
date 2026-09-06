import { access, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "@ryper/event-bus";
import { CapabilityBroker } from "@ryper/security";
import { createCapabilityManager } from "@ryper/platform-capability";
import {
  createWindowsAdapter,
  WINDOWS_CAPABILITY_DESCRIPTORS,
  createInMemoryWindowsSystemApi,
} from "@ryper/windows-agent";
import {
  ModelRegistry,
  ModelSelector,
  RuntimeHealthMonitor,
  InferenceQueue,
  ModelCache,
  LocalRuntimeManager,
  createNodeFileSystem,
  type DeviceCapabilities,
} from "@ryper/local-runtime";
import {
  AudioDeviceManager,
  EnergyVoiceActivityDetector,
  MicrophoneManager,
  SpeakerManager,
  SpeechRecognitionRegistry,
  SpeechSynthesisRegistry,
  LocalSpeechRecognitionProvider,
  LocalSpeechSynthesisProvider,
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
  type VoiceSessionState,
} from "@ryper/voice-engine";
import type { MemoryManager } from "@ryper/memory-system";
import type { DeviceState } from "@ryper/model-router";
import {
  registerDesktopVoiceCommands,
  DESKTOP_INTENT_PATTERNS,
} from "../electron/voice-commands.js";
import { bootstrapAIOrchestrator } from "../electron/ai-orchestrator-bootstrap.js";
import { VoicePipeline } from "../electron/voice-pipeline.js";
import { defaultVoiceModelPaths, registerVoiceModels } from "../electron/voice-model-provisioning.js";
import { createPowerConfirmationManager } from "../electron/power-confirmation.js";
import { createContextReferenceTracker } from "../electron/context-reference.js";

const isWindows = process.platform === "win32";
const llamaBinary = process.env["RYPER_LLAMA_SERVER_BINARY"];
const llamaModel = process.env["RYPER_LLAMA_MODEL"];
const whisperBinary = process.env["RYPER_WHISPER_BINARY"];
const whisperModel = process.env["RYPER_WHISPER_MODEL"];
const piperBinary = process.env["RYPER_PIPER_BINARY"];
const piperModel = process.env["RYPER_PIPER_MODEL"];

const REFERENCE_DEVICE_CAPABILITIES: DeviceCapabilities = {
  cpuCores: 8,
  totalRamGB: 16,
  freeRamGB: 8,
  hasGpu: true,
  platform: "windows",
  isAppleSilicon: false,
};

class RealSpeechWavCaptureSource implements AudioDeviceSource, AudioCaptureSource {
  private callCount = 0;

  constructor(private readonly wavFrames: readonly AudioFrame[]) {}

  async listDevices() {
    return [
      {
        id: "real-mic-source",
        name: "Real Microphone Source",
        kind: "microphone" as const,
        transport: "builtin" as const,
        isDefault: true,
        supportedSampleRatesHz: [16000],
      },
      {
        id: "real-speaker-sink",
        name: "Real Windows Speaker",
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
    const isFirstCall = this.callCount === 0;
    this.callCount += 1;
    const frames = this.wavFrames;
    const silenceFrame: AudioFrame = {
      samples: new Int16Array(160),
      sampleRateHz: 16000,
    };

    return {
      async *[Symbol.asyncIterator]() {
        if (isFirstCall) {
          for (const frame of frames) {
            yield frame;
          }
          for (let i = 0; i < 25; i++) {
            yield silenceFrame;
          }
        } else {
          for (let i = 0; i < 30; i++) {
            yield silenceFrame;
          }
        }
      },
    };
  }
}

class RealHardwarePlaybackSink implements AudioPlaybackSink {
  public readonly chunks: Uint8Array[] = [];
  public playedToSpeaker = false;

  async play(_deviceId: string, chunkStream: AsyncIterable<TtsAudioChunk>): Promise<void> {
    for await (const chunk of chunkStream) {
      this.chunks.push(new Uint8Array(chunk.bytes));
    }

    if (this.chunks.length > 0) {
      const totalBytes = this.chunks.reduce((acc, c) => acc + c.byteLength, 0);
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const c of this.chunks) {
        combined.set(c, offset);
        offset += c.byteLength;
      }

      const outPath = join(tmpdir(), "ryper_real_voice_turn_playback.wav");
      await writeFile(outPath, combined);

      if (process.platform === "win32") {
        try {
          execFileSync("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            '$p = New-Object System.Media.SoundPlayer "' + outPath + '"; $p.PlaySync()',
          ], { timeout: 15000 });
          this.playedToSpeaker = true;
        } catch (err) {
          console.warn("SoundPlayer error:", err);
        }
      }
    }
  }

  async setVolume(): Promise<void> {}
}

describe.skipIf(!llamaBinary || !llamaModel || !whisperBinary || !whisperModel || !piperBinary || !piperModel || !isWindows)(
  "RYPER End-to-End Voice Pipeline � REAL WINDOWS CERTIFICATION",
  () => {
    it("MICROPHONE -> REAL WHISPER STT -> VOICE ENGINE -> MODEL ROUTER -> REAL LLAMA-CPP-LOCAL (QWEN3) -> REAL PIPER TTS -> REAL SPEAKER", async () => {
      const fileSystem = createNodeFileSystem({
        access,
        readFile,
        writeFile,
        unlink,
        mkdir,
        stat,
        readdir,
      });

      const wavPath = "C:/tmp/hello_two_plus_two_16k.wav";
      const wavBytes = await readFile(wavPath);
      const pcm16 = new Int16Array(
        wavBytes.buffer,
        wavBytes.byteOffset + 44,
        (wavBytes.byteLength - 44) / 2,
      );

      const frames: AudioFrame[] = [];
      const FRAME_SIZE = 160;
      for (let i = 0; i < pcm16.length; i += FRAME_SIZE) {
        const slice = pcm16.subarray(i, Math.min(i + FRAME_SIZE, pcm16.length));
        const samples = new Int16Array(FRAME_SIZE);
        samples.set(slice);
        frames.push({ samples, sampleRateHz: 16000 });
      }

      const captureSource = new RealSpeechWavCaptureSource(frames);
      const playbackSink = new RealHardwarePlaybackSink();

      const eventBus = new EventBus();
      const deviceManager = new AudioDeviceManager(captureSource, eventBus);
      const microphoneManager = new MicrophoneManager(deviceManager, captureSource);
      const speakerManager = new SpeakerManager(deviceManager, playbackSink);
      const vad = new EnergyVoiceActivityDetector();

      const modelRegistry = new ModelRegistry();
      const modelSelector = new ModelSelector(modelRegistry);
      const healthMonitor = new RuntimeHealthMonitor();
      const inferenceQueue = new InferenceQueue(2);
      const modelCache = new ModelCache(modelRegistry, fileSystem, 2 * 1024 * 1024 * 1024);

      const voiceModelPaths = defaultVoiceModelPaths(join(tmpdir(), "ryper-models"));
      const { providers: voiceRuntimeProviders, diagnostics: voiceDiagnostics } =
        await registerVoiceModels(modelRegistry, fileSystem, voiceModelPaths);

      expect(voiceDiagnostics.whisper.status).toBe("installed");
      expect(voiceDiagnostics.piper.status).toBe("installed");
      expect(voiceRuntimeProviders.some((p) => p.id === "whisper-cpp-local")).toBe(true);
      expect(voiceRuntimeProviders.some((p) => p.id === "piper-local")).toBe(true);

      const runtimeManager = new LocalRuntimeManager({
        registry: modelSelector,
        providers: voiceRuntimeProviders,
        healthMonitor,
        queue: inferenceQueue,
        cache: modelCache,
        eventBus,
      });
      const inferenceContext = { device: REFERENCE_DEVICE_CAPABILITIES };

      const sttRegistry = new SpeechRecognitionRegistry();
      sttRegistry.register(new LocalSpeechRecognitionProvider(runtimeManager, inferenceContext));

      const ttsRegistry = new SpeechSynthesisRegistry();
      ttsRegistry.register(
        new LocalSpeechSynthesisProvider(runtimeManager, inferenceContext, [
          { id: "default", name: "Ryper", language: "en-US" },
        ]),
      );

      const broker = new CapabilityBroker(() => Promise.resolve(true));
      const capabilityManager = createCapabilityManager({
        broker,
        platformDetector: () => "windows",
      });
      const windowsAdapter = await createWindowsAdapter({
        systemApi: createInMemoryWindowsSystemApi(),
      });
      capabilityManager.registerAdapter(windowsAdapter);
      for (const d of WINDOWS_CAPABILITY_DESCRIPTORS) capabilityManager.registerCapability(d);

      const powerConfirmation = createPowerConfirmationManager();
      const contextTracker = createContextReferenceTracker();

      const aiBundle = await bootstrapAIOrchestrator(
        capabilityManager,
        broker,
        eventBus,
        { modelCacheDir: join(tmpdir(), "ryper-models") },
        fileSystem,
        powerConfirmation,
        contextTracker,
      );

      expect(aiBundle.localLLMActive).toBe(true);
      expect(aiBundle.llmDiagnostics.status).toBe("installed");

      const intentDetector = new IntentDetector([
        ...DEFAULT_INTENT_PATTERNS,
        ...DESKTOP_INTENT_PATTERNS,
      ]);
      const commandRouter = new VoiceCommandRouter();
      registerDesktopVoiceCommands(commandRouter, capabilityManager, powerConfirmation, contextTracker);

      const contextManager = {
        recordUserUtterance: async () => {},
        recordAssistantUtterance: async () => {},
        getRelevantContext: async () => [],
      } as any;

      const sessionManager = new VoiceSessionManager({ eventBus });
      const settings = new VoiceSettingsManager();
      const diagnostics = new VoiceDiagnostics();
      const analytics = new VoiceAnalytics();

      const transitions: { from: VoiceSessionState; to: VoiceSessionState }[] = [];
      eventBus.subscribe({ type: "voice_engine.session_transition" }, (ev: any) => {
        transitions.push({ from: ev.payload.from, to: ev.payload.to });
      });

      const pipeline = new VoicePipeline({
        sessionManager,
        microphoneManager,
        speakerManager,
        vad,
        sttRegistry,
        ttsRegistry,
        intentDetector,
        commandRouter,
        contextManager,
        aiOrchestrator: aiBundle.orchestrator,
        settings,
        diagnostics,
        analytics,
        powerConfirmation,
        eventBus,
      });

      console.log("\n=================================================================");
      console.log("STARTING CONTROLLED REAL END-TO-END VOICE TURN");
      console.log("Utterance: 'Hello RYPER, what is two plus two?'");
      console.log("=================================================================\n");

      const deviceState: DeviceState = {
        online: true,
        cpuCores: 8,
        totalRamGB: 16,
        freeRamGB: 8,
        batteryPercent: 100,
        batteryCharging: true,
      } as DeviceState;

      await deviceManager.refresh();
      const turnResult = await pipeline.runTurn(deviceState);

      console.log("\n=================================================================");
      console.log("TURN RESULT RECEIVED:");
      console.log("Transcript:        ", turnResult.transcript);
      console.log("Spoken Response:   ", turnResult.spokenResponse);
      console.log("Handled by Command:", turnResult.handledByCommand);
      console.log("State Transitions: ", transitions.map((t) => t.from + "->" + t.to).join(" => "));
      console.log("Audio Chunks:      ", playbackSink.chunks.length);
      console.log("Played to Speaker: ", playbackSink.playedToSpeaker);
      console.log("=================================================================\n");

      expect(turnResult.transcript.length).toBeGreaterThan(0);
      expect(turnResult.handledByCommand).toBe(false);
      expect(turnResult.spokenResponse.length).toBeGreaterThan(0);
      expect(playbackSink.chunks.length).toBeGreaterThan(0);
      expect(playbackSink.playedToSpeaker).toBe(true);

      const firstChunk = playbackSink.chunks[0];
      const view = new DataView(firstChunk.buffer, firstChunk.byteOffset, firstChunk.byteLength);
      const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
      expect(riff).toBe("RIFF");

      const stateNames = transitions.map((t) => t.to);
      expect(stateNames).toContain("listening");
      expect(stateNames).toContain("transcribing");
      expect(stateNames).toContain("thinking");
      expect(stateNames).toContain("speaking");
      expect(stateNames).toContain("idle");
    }, 180_000);
  },
);
