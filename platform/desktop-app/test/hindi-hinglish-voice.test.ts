import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  normalizeWhisperLanguage,
  createWhisperCppRuntimeProvider,
  ModelRegistry,
  type ProcessRunner,
  type FileSystemLike,
  type ProcessHandle,
} from "@ryper/local-runtime";
import {
  LocalSpeechRecognitionProvider,
  SpeechRecognitionRegistry,
  SpeechSynthesisRegistry,
  IntentDetector,
  VoiceCommandRouter,
  EnergyVoiceActivityDetector,
  AudioDeviceManager,
  MicrophoneManager,
  SpeakerManager,
  VoiceContextManager,
  VoiceSessionManager,
  VoiceSettingsManager,
  VoiceDiagnostics,
  VoiceAnalytics,
  type AudioFrame,
} from "@ryper/voice-engine";
import { LongTermMemory } from "@ryper/memory";
import { createSettingsStore, DEFAULT_SETTINGS } from "../electron/settings-store.js";
import { ALLOWED_SETTING_KEYS, sanitizeSettingsPatch } from "../electron/ipc-handlers.js";
import {
  detectVoiceModelStatus,
  registerVoiceModels,
  WHISPER_MULTILINGUAL_MODEL_ID,
  PIPER_HINDI_MODEL_ID,
} from "../electron/voice-model-provisioning.js";
import { DESKTOP_INTENT_PATTERNS } from "../electron/voice-commands.js";
import {
  createPowerConfirmationManager,
  matchConfirmationResponse,
  tryResolvePowerConfirmation,
  POWER_CONFIRMATION_SESSION_KEY,
} from "../electron/power-confirmation.js";
import { HeuristicToolCallingProvider } from "../electron/heuristic-ai-provider.js";
import { VoicePipeline } from "../electron/voice-pipeline.js";
import { createUnavailableAudioBridge } from "../electron/audio-bridge.js";

function createMockFs(existingFiles: Set<string> = new Set()): FileSystemLike {
  return {
    exists: async (p) => existingFiles.has(p),
    readFile: async (p) => {
      if (p.endsWith(".txt")) return new TextEncoder().encode("नमस्ते दुनिया! This is Hindi speech.");
      return new Uint8Array([1, 2, 3]);
    },
    writeFile: async () => {},
    deleteFile: async () => {},
    statSize: async () => 100_000_000,
    mkdir: async () => {},
    readdir: async () => [],
  };
}

describe("Phase 10: Multilingual Hindi + Hinglish Voice Verification", () => {
  describe("Whisper Language Normalization & Propagation", () => {
    it("normalizes BCP-47 hi-IN to hi", () => {
      expect(normalizeWhisperLanguage("hi-IN")).toBe("hi");
      expect(normalizeWhisperLanguage("hi_IN")).toBe("hi");
      expect(normalizeWhisperLanguage("hi")).toBe("hi");
    });

    it("normalizes BCP-47 en-US to en", () => {
      expect(normalizeWhisperLanguage("en-US")).toBe("en");
      expect(normalizeWhisperLanguage("en_GB")).toBe("en");
      expect(normalizeWhisperLanguage("en")).toBe("en");
    });

    it("preserves auto for auto-detect", () => {
      expect(normalizeWhisperLanguage("auto")).toBe("auto");
      expect(normalizeWhisperLanguage("AUTO")).toBe("auto");
    });

    it("returns undefined for empty/undefined language", () => {
      expect(normalizeWhisperLanguage(undefined)).toBeUndefined();
      expect(normalizeWhisperLanguage("")).toBeUndefined();
    });

    it("passes -l hi to whisper CLI when language is hi", async () => {
      const executedArgs: string[] = [];
      const runner: ProcessRunner = (_bin, args) => {
        executedArgs.push(...args);
        return {
          result: Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
          kill: () => {},
        } as ProcessHandle;
      };

      const provider = createWhisperCppRuntimeProvider({
        id: "whisper-test",
        binaryPath: "/bin/main.exe",
        modelPathResolver: (id) => id,
        processRunner: runner,
        fileSystem: createMockFs(new Set(["/bin/main.exe", "/models/ggml-base.bin"])),
      });

      await provider.transcribe!("/models/ggml-base.bin", {
        audioBytes: new Uint8Array(3200),
        language: "hi-IN",
      });

      expect(executedArgs).toContain("-l");
      expect(executedArgs).toContain("hi");
    });

    it("passes -l auto to whisper CLI when language is auto", async () => {
      const executedArgs: string[] = [];
      const runner: ProcessRunner = (_bin, args) => {
        executedArgs.push(...args);
        return {
          result: Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
          kill: () => {},
        } as ProcessHandle;
      };

      const provider = createWhisperCppRuntimeProvider({
        id: "whisper-test",
        binaryPath: "/bin/main.exe",
        modelPathResolver: (id) => id,
        processRunner: runner,
        fileSystem: createMockFs(new Set(["/bin/main.exe", "/models/ggml-base.bin"])),
      });

      await provider.transcribe!("/models/ggml-base.bin", {
        audioBytes: new Uint8Array(3200),
        language: "auto",
      });

      expect(executedArgs).toContain("-l");
      expect(executedArgs).toContain("auto");
    });

    it("retries without -l when whisper process fails due to language flag with English model", async () => {
      let callCount = 0;
      const executedArgs: string[][] = [];
      const runner: ProcessRunner = (_bin, args) => {
        callCount++;
        executedArgs.push([...args]);
        if (callCount === 1) {
          return {
            result: Promise.resolve({
              exitCode: 1,
              stdout: "",
              stderr: "error: model does not support language 'hi'",
            }),
            kill: () => {},
          } as ProcessHandle;
        }
        return {
          result: Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
          kill: () => {},
        } as ProcessHandle;
      };

      const provider = createWhisperCppRuntimeProvider({
        id: "whisper-test",
        binaryPath: "/bin/main.exe",
        modelPathResolver: (id) => id,
        processRunner: runner,
        fileSystem: createMockFs(new Set(["/bin/main.exe", "/models/ggml-base.en.bin"])),
      });

      const result = await provider.transcribe!("/models/ggml-base.en.bin", {
        audioBytes: new Uint8Array(3200),
        language: "hi",
      });

      expect(callCount).toBe(2);
      expect(executedArgs[0]).toContain("-l");
      expect(executedArgs[1]).not.toContain("-l");
      expect(result.text).toContain("नमस्ते");
    });
  });

  describe("STT Provider Language Forwarding & Devanagari Script", () => {
    it("LocalSpeechRecognitionProvider forwards languageHint to runtimeManager.transcribe", async () => {
      let capturedLang: string | undefined;
      const mockRuntimeManager = {
        transcribe: async (req: { language?: string }) => {
          capturedLang = req.language;
          return { text: "मेरा नाम राइपर है" };
        },
      } as any;

      const provider = new LocalSpeechRecognitionProvider(mockRuntimeManager, {
        device: {
          cpuCores: 4,
          totalRamGB: 8,
          freeRamGB: 4,
          hasGpu: false,
          platform: "windows",
          isAppleSilicon: false,
        },
      });

      const frame: AudioFrame = {
        samples: new Int16Array(160),
        sampleRateHz: 16000,
      };

      async function* genAudio() {
        yield frame;
      }

      const events = [];
      for await (const ev of provider.streamRecognize(genAudio(), { languageHint: "hi" })) {
        events.push(ev);
      }

      expect(capturedLang).toBe("hi");
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "final",
        text: "मेरा नाम राइपर है",
        confidence: 1,
        language: "hi",
      });
    });
  });

  describe("Multilingual Voice Settings & IPC Storage", () => {
    it("DEFAULT_SETTINGS initializes with voiceLanguage: auto and ttsVoice: auto", () => {
      expect(DEFAULT_SETTINGS.voiceLanguage).toBe("auto");
      expect(DEFAULT_SETTINGS.ttsVoice).toBe("auto");
    });

    it("SettingsStore loads legacy JSON without language keys and sets default to auto", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "ryper-settings-test-"));
      const settingsPath = join(tempDir, "settings.json");
      await writeFile(
        settingsPath,
        JSON.stringify({ theme: "dark", voiceEnabled: true, pushToTalkShortcut: "Ctrl+Space" }),
        "utf-8",
      );

      const store = createSettingsStore(settingsPath);
      const loaded = await store.load();

      expect(loaded.theme).toBe("dark");
      expect(loaded.voiceLanguage).toBe("auto");
      expect(loaded.ttsVoice).toBe("auto");

      await rm(tempDir, { recursive: true, force: true });
    });

    it("SettingsStore sanitizes invalid voiceLanguage and ttsVoice to defaults", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "ryper-settings-test-"));
      const settingsPath = join(tempDir, "settings.json");
      await writeFile(
        settingsPath,
        JSON.stringify({ voiceLanguage: "klingon", ttsVoice: "alien" }),
        "utf-8",
      );

      const store = createSettingsStore(settingsPath);
      const loaded = await store.load();

      expect(loaded.voiceLanguage).toBe("auto");
      expect(loaded.ttsVoice).toBe("auto");

      await rm(tempDir, { recursive: true, force: true });
    });

    it("SettingsStore updates and persists valid voiceLanguage and ttsVoice", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "ryper-settings-test-"));
      const settingsPath = join(tempDir, "settings.json");

      const store = createSettingsStore(settingsPath);
      const updated = await store.update({ voiceLanguage: "hi", ttsVoice: "hi" });

      expect(updated.voiceLanguage).toBe("hi");
      expect(updated.ttsVoice).toBe("hi");

      const reloaded = await createSettingsStore(settingsPath).load();
      expect(reloaded.voiceLanguage).toBe("hi");
      expect(reloaded.ttsVoice).toBe("hi");

      await rm(tempDir, { recursive: true, force: true });
    });

    it("ALLOWED_SETTING_KEYS in IPC handler permits voiceLanguage and ttsVoice", () => {
      expect(ALLOWED_SETTING_KEYS.has("voiceLanguage")).toBe(true);
      expect(ALLOWED_SETTING_KEYS.has("ttsVoice")).toBe(true);

      const sanitized = sanitizeSettingsPatch({
        voiceLanguage: "hi",
        ttsVoice: "auto",
        unauthorizedField: "hacked",
      });
      expect(sanitized).toEqual({ voiceLanguage: "hi", ttsVoice: "auto" });
    });
  });

  describe("Model Provisioning & Registration", () => {
    it("detects multilingual Whisper model and Hindi Piper model when present on disk", async () => {
      const fs = createMockFs(
        new Set([
          "/app/whisper/main.exe",
          "/app/whisper/ggml-base.en.bin",
          "/app/whisper/ggml-base.bin",
          "/app/piper/piper.exe",
          "/app/piper/en_US-lessac-medium.onnx",
          "/app/piper/hi_IN-dhiru-medium.onnx",
        ]),
      );

      const paths = {
        whisperBinaryPath: "/app/whisper/main.exe",
        whisperModelPath: "/app/whisper/ggml-base.en.bin",
        whisperMultilingualModelPath: "/app/whisper/ggml-base.bin",
        piperBinaryPath: "/app/piper/piper.exe",
        piperModelPath: "/app/piper/en_US-lessac-medium.onnx",
        piperHindiModelPath: "/app/piper/hi_IN-dhiru-medium.onnx",
      };

      const diagnostics = await detectVoiceModelStatus(fs, paths);
      expect(diagnostics.whisper.status).toBe("installed");
      expect(diagnostics.whisperMultilingual?.status).toBe("installed");
      expect(diagnostics.piper.status).toBe("installed");
      expect(diagnostics.piperHindi?.status).toBe("installed");
    });

    it("registers WHISPER_MULTILINGUAL_MODEL_ID and PIPER_HINDI_MODEL_ID in ModelRegistry", async () => {
      const registry = new ModelRegistry();
      const fs = createMockFs(
        new Set([
          "/app/whisper/main.exe",
          "/app/whisper/ggml-base.bin",
          "/app/piper/piper.exe",
          "/app/piper/hi_IN-dhiru-medium.onnx",
        ]),
      );

      const paths = {
        whisperBinaryPath: "/app/whisper/main.exe",
        whisperModelPath: "/app/whisper/ggml-base.en.bin", // missing
        whisperMultilingualModelPath: "/app/whisper/ggml-base.bin", // present
        piperBinaryPath: "/app/piper/piper.exe",
        piperModelPath: "/app/piper/en_US-lessac-medium.onnx", // missing
        piperHindiModelPath: "/app/piper/hi_IN-dhiru-medium.onnx", // present
      };

      const { providers, diagnostics } = await registerVoiceModels(registry, fs, paths);

      expect(diagnostics.whisperMultilingual?.status).toBe("installed");
      expect(diagnostics.piperHindi?.status).toBe("installed");

      const installedAsr = registry.query({ type: "asr", installedOnly: true });
      expect(installedAsr.some((m) => m.id === WHISPER_MULTILINGUAL_MODEL_ID)).toBe(true);

      const installedTts = registry.query({ type: "tts", installedOnly: true });
      expect(installedTts.some((m) => m.id === PIPER_HINDI_MODEL_ID)).toBe(true);

      expect(providers.some((p) => p.id === "whisper-cpp-local")).toBe(true);
      expect(providers.some((p) => p.id === "piper-local")).toBe(true);
    });
  });

  describe("Hindi & Hinglish Fast-Path Intent Detection", () => {
    const detector = new IntentDetector(DESKTOP_INTENT_PATTERNS);

    it("matches Hindi volume up phrases", () => {
      expect(detector.detect("volume badhao")?.intent).toBe("volume_up");
      expect(detector.detect("aawaz badhao")?.intent).toBe("volume_up");
      expect(detector.detect("आवाज़ बढ़ाओ")?.intent).toBe("volume_up");
      expect(detector.detect("वॉल्यूम बढ़ाओ")?.intent).toBe("volume_up");
    });

    it("matches Hindi volume down phrases", () => {
      expect(detector.detect("volume kam karo")?.intent).toBe("volume_down");
      expect(detector.detect("aawaz kam karo")?.intent).toBe("volume_down");
      expect(detector.detect("आवाज़ कम करो")?.intent).toBe("volume_down");
    });

    it("matches Hindi set volume with slot", () => {
      const match = detector.detect("volume 50 karo");
      expect(match?.intent).toBe("set_volume");
      expect(match?.slots["percent2"]).toBe("50");
    });

    it("matches Hindi mute/unmute", () => {
      expect(detector.detect("mute karo")?.intent).toBe("mute");
      expect(detector.detect("aawaz band karo")?.intent).toBe("mute");
      expect(detector.detect("unmute karo")?.intent).toBe("unmute");
      expect(detector.detect("aawaz chalu karo")?.intent).toBe("unmute");
    });

    it("matches Hindi close application with slot", () => {
      const match1 = detector.detect("Notepad band karo");
      expect(match1?.intent).toBe("close_application");
      expect(match1?.slots["app"]).toBe("Notepad");

      const match2 = detector.detect("Chrome close karo");
      expect(match2?.intent).toBe("close_application");
      expect(match2?.slots["app"]).toBe("Chrome");
    });

    it("matches Hindi media transport commands", () => {
      expect(detector.detect("gaana bajao")?.intent).toBe("media_play");
      expect(detector.detect("gaana roko")?.intent).toBe("media_pause");
      expect(detector.detect("agla gaana")?.intent).toBe("media_next");
      expect(detector.detect("pichhla gaana")?.intent).toBe("media_previous");
    });

    it("matches Hindi power commands", () => {
      expect(detector.detect("computer band karo")?.intent).toBe("shutdown");
      expect(detector.detect("shutdown karo")?.intent).toBe("shutdown");
      expect(detector.detect("restart karo")?.intent).toBe("restart");
      expect(detector.detect("sleep mode")?.intent).toBe("sleep");
    });
  });

  describe("Hindi Power Confirmation Interception", () => {
    it("recognizes affirmative Hindi responses as confirmed", () => {
      expect(matchConfirmationResponse("haan")).toBe("confirmed");
      expect(matchConfirmationResponse("ha")).toBe("confirmed");
      expect(matchConfirmationResponse("haanji")).toBe("confirmed");
      expect(matchConfirmationResponse("kar do")).toBe("confirmed");
      expect(matchConfirmationResponse("theek hai")).toBe("confirmed");
      expect(matchConfirmationResponse("bilkul")).toBe("confirmed");
      expect(matchConfirmationResponse("हाँ")).toBe("confirmed");
    });

    it("recognizes negative Hindi responses as denied", () => {
      expect(matchConfirmationResponse("nahi")).toBe("denied");
      expect(matchConfirmationResponse("nahin")).toBe("denied");
      expect(matchConfirmationResponse("na")).toBe("denied");
      expect(matchConfirmationResponse("mat karo")).toBe("denied");
      expect(matchConfirmationResponse("नहीं")).toBe("denied");
    });

    it("recognizes cancellation Hindi responses as cancelled", () => {
      expect(matchConfirmationResponse("ruko")).toBe("cancelled");
      expect(matchConfirmationResponse("cancel karo")).toBe("cancelled");
      expect(matchConfirmationResponse("रद्‍द करो")).toBe("cancelled");
    });

    it("tryResolvePowerConfirmation resolves real shutdown upon hearing haan", async () => {
      const pwr = createPowerConfirmationManager();
      pwr.request(POWER_CONFIRMATION_SESSION_KEY, "shutdown");

      let executed = false;
      const executeAction = async () => {
        executed = true;
        return { ok: true, message: "Shutting down system." };
      };

      const res = await tryResolvePowerConfirmation("haan, kar do", pwr, executeAction);
      expect(executed).toBe(true);
      expect(res?.reply).toBe("Shutting down system.");
      expect(pwr.hasPending(POWER_CONFIRMATION_SESSION_KEY)).toBe(false);
    });

    it("tryResolvePowerConfirmation cancels shutdown upon hearing nahi", async () => {
      const pwr = createPowerConfirmationManager();
      pwr.request(POWER_CONFIRMATION_SESSION_KEY, "shutdown");

      let executed = false;
      const executeAction = async () => {
        executed = true;
        return { ok: true, message: "Shutting down." };
      };

      const res = await tryResolvePowerConfirmation("nahi", pwr, executeAction);
      expect(executed).toBe(false);
      expect(res?.reply).toContain("cancelling");
      expect(pwr.hasPending(POWER_CONFIRMATION_SESSION_KEY)).toBe(false);
    });
  });

  describe("Heuristic Provider Step Splitting on Hindi Connectives", () => {
    it("splits multi-step request on aur, fir, uske baad", () => {
      const provider = new HeuristicToolCallingProvider(new Set(["mute", "close_application"]));
      const splitSteps = (provider as any).splitSteps.bind(provider);

      const steps1 = splitSteps("mute karo aur Notepad band karo");
      expect(steps1).toEqual(["mute karo", "Notepad band karo"]);

      const steps2 = splitSteps("volume badhao fir Chrome open karo uske baad gaana bajao");
      expect(steps2).toEqual(["volume badhao", "Chrome open karo", "gaana bajao"]);
    });
  });

  describe("VoicePipeline Dynamic Voice Routing & Fallback", () => {
    it("detects Devanagari script and selects hindi voiceId when ttsVoice is auto", async () => {
      const sessionManager = new VoiceSessionManager();
      const settings = new VoiceSettingsManager();
      const diagnostics = new VoiceDiagnostics();
      const analytics = new VoiceAnalytics();
      const vad = new EnergyVoiceActivityDetector();
      const bridge = {
        listDevices: async () => [
          { id: "mock-spk", name: "Mock Speaker", kind: "speaker" as const, isDefault: true },
        ],
        hasPermission: async () => true,
        requestPermission: async () => true,
        startCapture: () => ({ async *[Symbol.asyncIterator]() {} }),
        play: async (_devId: string, chunks: AsyncIterable<any>) => {
          for await (const _ of chunks) {
            /* consume */
          }
        },
        setVolume: async () => {},
      };
      const devMgr = new AudioDeviceManager(bridge as any);
      await devMgr.refresh();
      const mic = new MicrophoneManager(devMgr, bridge as any);
      const spk = new SpeakerManager(devMgr, bridge as any);

      let requestedVoiceId: string | undefined;
      const ttsRegistry = new SpeechSynthesisRegistry();
      ttsRegistry.register({
        id: "mock-tts",
        supportsOffline: true,
        voices: [
          { id: "default", name: "Ryper", language: "en-US" },
          { id: "hindi", name: "Ryper Hindi", language: "hi-IN" },
        ],
        async *synthesizeStream(_text, options) {
          requestedVoiceId = options?.voiceId;
          yield { bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" };
        },
      });

      const sttRegistry = new SpeechRecognitionRegistry();
      sttRegistry.register({
        id: "mock-stt",
        supportsOffline: true,
        async *streamRecognize() {
          yield { type: "final" as const, text: "नमस्ते", confidence: 1 };
        },
      });

      const pipeline = new VoicePipeline({
        sessionManager,
        microphoneManager: mic,
        speakerManager: spk,
        vad,
        sttRegistry,
        ttsRegistry,
        intentDetector: new IntentDetector([]),
        contextManager: new VoiceContextManager({
          createMemory: async () => ({ id: "1" }),
          searchMemories: async () => [],
        } as any),
        aiOrchestrator: {
          sendMessage: async function* () {
            yield { type: "text_delta" as const, delta: "नमस्ते! मैं आपकी क्या सहायता कर सकता हूँ?" };
            yield { type: "done" as const, finishReason: "stop" as const };
          },
        } as any,
        settings,
        diagnostics,
        analytics,
        enableBargeIn: false,
        getVoiceSettings: () => ({ voiceLanguage: "auto", ttsVoice: "auto" }),
      });

      const result = await pipeline.runTurn(
        { batteryLevel: 1, isCharging: true, networkType: "wifi", isLowPowerMode: false, isIdle: false },
        undefined,
        16000,
        "नमस्ते",
      );

      expect(result.spokenResponse).toContain("नमस्ते");
      expect(requestedVoiceId).toBe("hindi");
    });
  });
});
