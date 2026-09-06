import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import {
  ModelRegistry,
  createNodeProcessRunner,
  createWhisperCppRuntimeProvider,
  createPiperRuntimeProvider,
  type FileSystemLike,
  type LocalRuntimeProvider,
  type ModelMetadata,
} from "@ryper/local-runtime";
import { ReferenceVoiceRuntimeProvider } from "./reference-voice-runtime-provider.js";

/**
 * Phase 13.7. Real local speech models are never bundled into this
 * repository (see docs/PROJECT_STATE.md's Phase 13.7 section for exact
 * installation instructions) — this file's job is to honestly find out
 * whether they're actually present on disk, register what's real with
 * `@ryper/local-runtime`'s `ModelRegistry` (so `LocalRuntimeManager`'s
 * existing, real `runWithFallback` fallback chain can pick them), and
 * report precise, actionable status distinguishing "provider installed
 * but model missing" from "voice unavailable" — never silently failing.
 *
 * Also fixes a real, pre-existing Phase 13.5/13.6 gap: nothing ever
 * registered *any* model (real or reference) into `ModelRegistry`, so
 * every STT/TTS call threw `MissingModelError` before
 * `ReferenceVoiceRuntimeProvider`'s honest placeholder was ever reached.
 * The reference model is now always registered and always marked
 * installed (it needs no real file — it's a software fallback), with a
 * deliberately huge `approxDiskBytes` so `defaultModelSelectionPolicy`
 * (smallest-first) always ranks a real, present Whisper/Piper model
 * ahead of it.
 */

export interface VoiceModelPaths {
  readonly whisperBinaryPath: string;
  readonly whisperModelPath: string;
  readonly whisperMultilingualModelPath?: string;
  readonly whisperModelLanguage?: string;
  readonly piperBinaryPath: string;
  readonly piperModelPath: string;
  readonly piperHindiModelPath?: string;
}

export type VoiceModelAvailability =
  | "installed" // binary and model both present — this is the real, active path
  | "binary-missing" // neither the binary nor (necessarily) the model is present
  | "model-missing"; // binary present, but the model file is not

export interface VoiceModelDiagnostics {
  readonly whisper: { readonly status: VoiceModelAvailability; readonly detail: string };
  readonly whisperMultilingual?: { readonly status: VoiceModelAvailability; readonly detail: string };
  readonly piper: { readonly status: VoiceModelAvailability; readonly detail: string };
  readonly piperHindi?: { readonly status: VoiceModelAvailability; readonly detail: string };
}

/** Real defaults under the app's own data directory — never a system-wide path, never auto-downloaded. */
export function defaultVoiceModelPaths(userDataDir: string): VoiceModelPaths {
  const bin = process.platform === "win32" ? ".exe" : "";
  // Defensive, not silent: a missing/invalid userDataDir must never crash
  // startup (RYPER must not crash) — falls back to a real OS temp
  // directory, which will simply mean detection below reports
  // "binary-missing" (an honest, actionable diagnostic) rather than
  // throwing out of `bootstrapVoice()`.
  const base = userDataDir && userDataDir.length > 0 ? userDataDir : tmpdir();
  const modelsDir = basename(base).toLowerCase() === "models" ? base : join(base, "models");
  return {
    whisperBinaryPath:
      process.env["RYPER_WHISPER_BINARY"] ?? join(modelsDir, "whisper", `main${bin}`),
    whisperModelPath:
      process.env["RYPER_WHISPER_MODEL"] ?? join(modelsDir, "whisper", "ggml-base.en.bin"),
    whisperMultilingualModelPath:
      process.env["RYPER_WHISPER_MULTILINGUAL_MODEL"] ?? join(modelsDir, "whisper", "ggml-base.bin"),
    ...(process.env["RYPER_WHISPER_LANGUAGE"]
      ? { whisperModelLanguage: process.env["RYPER_WHISPER_LANGUAGE"] }
      : {}),
    piperBinaryPath:
      process.env["RYPER_PIPER_BINARY"] ?? join(modelsDir, "piper", `piper${bin}`),
    piperModelPath:
      process.env["RYPER_PIPER_MODEL"] ?? join(modelsDir, "piper", "en_US-lessac-medium.onnx"),
    piperHindiModelPath:
      process.env["RYPER_PIPER_HINDI_MODEL"] ?? join(modelsDir, "piper", "hi_IN-dhiru-medium.onnx"),
  };
}

const DANGEROUS_BINARY_NAMES = new Set([
  "cmd.exe",
  "cmd",
  "powershell.exe",
  "powershell",
  "pwsh.exe",
  "pwsh",
  "bash.exe",
  "bash",
  "sh.exe",
  "sh",
  "wscript.exe",
  "cscript.exe",
]);

export function isValidBinaryPath(binaryPath: string): boolean {
  if (!binaryPath || typeof binaryPath !== "string") return false;
  if (binaryPath.includes("\0")) return false;
  const basename = binaryPath.split(/[/\\]/).pop()?.toLowerCase();
  if (!basename || DANGEROUS_BINARY_NAMES.has(basename)) return false;
  return true;
}

async function detectOne(
  fileSystem: FileSystemLike,
  binaryPath: string,
  modelPath: string,
): Promise<{ status: VoiceModelAvailability; detail: string }> {
  if (!isValidBinaryPath(binaryPath)) {
    return {
      status: "binary-missing",
      detail: `binary path "${binaryPath}" is invalid or unsafe`,
    };
  }
  const binaryExists = await fileSystem.exists(binaryPath);
  if (!binaryExists) {
    return {
      status: "binary-missing",
      detail: `binary not found at "${binaryPath}"`,
    };
  }
  const modelExists = await fileSystem.exists(modelPath);
  if (!modelExists) {
    return {
      status: "model-missing",
      detail: `binary installed at "${binaryPath}", but the model is missing at "${modelPath}"`,
    };
  }
  return { status: "installed", detail: "binary and model both found" };
}

/** Real, on-disk detection — no assumption that a configured path actually holds a working binary/model, only that files exist there. */
export async function detectVoiceModelStatus(
  fileSystem: FileSystemLike,
  paths: VoiceModelPaths,
): Promise<VoiceModelDiagnostics> {
  const [whisper, piper, whisperMultilingual, piperHindi] = await Promise.all([
    detectOne(fileSystem, paths.whisperBinaryPath, paths.whisperModelPath),
    detectOne(fileSystem, paths.piperBinaryPath, paths.piperModelPath),
    paths.whisperMultilingualModelPath
      ? detectOne(fileSystem, paths.whisperBinaryPath, paths.whisperMultilingualModelPath)
      : Promise.resolve(undefined),
    paths.piperHindiModelPath
      ? detectOne(fileSystem, paths.piperBinaryPath, paths.piperHindiModelPath)
      : Promise.resolve(undefined),
  ]);
  return {
    whisper,
    piper,
    ...(whisperMultilingual ? { whisperMultilingual } : {}),
    ...(piperHindi ? { piperHindi } : {}),
  };
}

export const REFERENCE_ASR_MODEL_ID = "reference-asr";
export const REFERENCE_TTS_MODEL_ID = "reference-tts";
export const WHISPER_MODEL_ID = "whisper-local";
export const WHISPER_MULTILINGUAL_MODEL_ID = "whisper-multilingual-local";
export const PIPER_MODEL_ID = "piper-local";
export const PIPER_HINDI_MODEL_ID = "piper-hindi-local";

// Deliberately much larger than any real installed model so the default
// (smallest-first) selection policy always prefers a real one when present.
const REFERENCE_APPROX_DISK_BYTES = Number.MAX_SAFE_INTEGER;

function referenceMetadata(id: string, type: "asr" | "tts"): ModelMetadata {
  return {
    id,
    name: type === "asr" ? "Reference ASR placeholder" : "Reference TTS placeholder",
    type,
    runtime: "onnx",
    version: "1.0.0",
    requirements: { minRamGB: 0, approxDiskBytes: REFERENCE_APPROX_DISK_BYTES },
    downloadUrl: "",
    sha256: "",
    license: "N/A — no model file, software fallback only",
    runtimeModelId: id,
  };
}

function realMetadata(
  id: string,
  type: "asr" | "tts",
  runtime: "whisper-cpp" | "piper",
  runtimeModelId: string,
  approxDiskBytes: number,
  downloadUrl: string,
): ModelMetadata {
  return {
    id,
    name:
      type === "asr"
        ? id === WHISPER_MULTILINGUAL_MODEL_ID
          ? "Whisper.cpp Multilingual (local)"
          : "Whisper.cpp (local)"
        : id === PIPER_HINDI_MODEL_ID
          ? "Piper Hindi (local)"
          : "Piper (local)",
    type,
    runtime,
    version: "1.0.0",
    requirements: { minRamGB: 1, approxDiskBytes },
    downloadUrl,
    sha256: "",
    license:
      type === "asr"
        ? "MIT (whisper.cpp) — model license varies"
        : "MIT (Piper) — voice license varies",
    runtimeModelId,
  };
}

export interface VoiceRuntimeProviders {
  readonly providers: readonly LocalRuntimeProvider[];
  readonly diagnostics: VoiceModelDiagnostics;
}

/**
 * Registers every real-or-reference ASR/TTS model into `registry` and
 * returns the ordered provider list for `LocalRuntimeManager` — real
 * Whisper/Piper providers first (when actually detected installed), the
 * honest reference fallback always last. `LocalRuntimeManager`'s
 * existing `runWithFallback` (unchanged) does the rest: try the best
 * candidate, fall back to the next on failure, never fabricate a result.
 */
export async function registerVoiceModels(
  registry: ModelRegistry,
  fileSystem: FileSystemLike,
  paths: VoiceModelPaths,
): Promise<VoiceRuntimeProviders> {
  const diagnostics = await detectVoiceModelStatus(fileSystem, paths);
  const providers: LocalRuntimeProvider[] = [];

  // Reference providers are always registered and always "installed" —
  // they need no real file, and are the documented, honest last resort.
  registry.markInstalled({
    metadata: referenceMetadata(REFERENCE_ASR_MODEL_ID, "asr"),
    localPath: "",
    installedAt: new Date(0).toISOString(),
    sizeBytes: 0,
    active: true,
  });
  registry.markInstalled({
    metadata: referenceMetadata(REFERENCE_TTS_MODEL_ID, "tts"),
    localPath: "",
    installedAt: new Date(0).toISOString(),
    sizeBytes: 0,
    active: true,
  });
  const referenceProvider = new ReferenceVoiceRuntimeProvider();
  providers.push(referenceProvider);

  const processRunner = createNodeProcessRunner();

  let whisperProviderAdded = false;

  if (diagnostics.whisper.status === "installed") {
    const sizeBytes = await fileSystem.statSize(paths.whisperModelPath).catch(() => 0);
    registry.markInstalled({
      metadata: realMetadata(
        WHISPER_MODEL_ID,
        "asr",
        "whisper-cpp",
        paths.whisperModelPath,
        sizeBytes || 148_000_000,
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
      ),
      localPath: paths.whisperModelPath,
      installedAt: new Date().toISOString(),
      sizeBytes,
      active: true,
    });
    if (!whisperProviderAdded) {
      providers.unshift(
        createWhisperCppRuntimeProvider({
          id: "whisper-cpp-local",
          binaryPath: paths.whisperBinaryPath,
          modelPathResolver: (runtimeModelId) => runtimeModelId,
          processRunner,
          fileSystem,
        }),
      );
      whisperProviderAdded = true;
    }
  } else {
    registry.addToCatalog(
      realMetadata(
        WHISPER_MODEL_ID,
        "asr",
        "whisper-cpp",
        paths.whisperModelPath,
        148_000_000,
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
      ),
    );
  }

  if (paths.whisperMultilingualModelPath && diagnostics.whisperMultilingual?.status === "installed") {
    const sizeBytes = await fileSystem.statSize(paths.whisperMultilingualModelPath).catch(() => 0);
    registry.markInstalled({
      metadata: realMetadata(
        WHISPER_MULTILINGUAL_MODEL_ID,
        "asr",
        "whisper-cpp",
        paths.whisperMultilingualModelPath,
        sizeBytes || 148_000_000,
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
      ),
      localPath: paths.whisperMultilingualModelPath,
      installedAt: new Date().toISOString(),
      sizeBytes,
      active: true,
    });
    if (!whisperProviderAdded) {
      providers.unshift(
        createWhisperCppRuntimeProvider({
          id: "whisper-cpp-local",
          binaryPath: paths.whisperBinaryPath,
          modelPathResolver: (runtimeModelId) => runtimeModelId,
          processRunner,
          fileSystem,
        }),
      );
      whisperProviderAdded = true;
    }
  } else if (paths.whisperMultilingualModelPath) {
    registry.addToCatalog(
      realMetadata(
        WHISPER_MULTILINGUAL_MODEL_ID,
        "asr",
        "whisper-cpp",
        paths.whisperMultilingualModelPath,
        148_000_000,
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
      ),
    );
  }

  let piperProviderAdded = false;

  if (diagnostics.piper.status === "installed") {
    const sizeBytes = await fileSystem.statSize(paths.piperModelPath).catch(() => 0);
    registry.markInstalled({
      metadata: realMetadata(
        PIPER_MODEL_ID,
        "tts",
        "piper",
        paths.piperModelPath,
        sizeBytes || 63_000_000,
        "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx",
      ),
      localPath: paths.piperModelPath,
      installedAt: new Date().toISOString(),
      sizeBytes,
      active: true,
    });
    if (!piperProviderAdded) {
      providers.unshift(
        createPiperRuntimeProvider({
          id: "piper-local",
          binaryPath: paths.piperBinaryPath,
          modelPathResolver: (runtimeModelId) => runtimeModelId,
          processRunner,
          fileSystem,
        }),
      );
      piperProviderAdded = true;
    }
  } else {
    registry.addToCatalog(
      realMetadata(
        PIPER_MODEL_ID,
        "tts",
        "piper",
        paths.piperModelPath,
        63_000_000,
        "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx",
      ),
    );
  }

  if (paths.piperHindiModelPath && diagnostics.piperHindi?.status === "installed") {
    const sizeBytes = await fileSystem.statSize(paths.piperHindiModelPath).catch(() => 0);
    registry.markInstalled({
      metadata: realMetadata(
        PIPER_HINDI_MODEL_ID,
        "tts",
        "piper",
        paths.piperHindiModelPath,
        sizeBytes || 63_000_000,
        "https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/dhiru/medium/hi_IN-dhiru-medium.onnx",
      ),
      localPath: paths.piperHindiModelPath,
      installedAt: new Date().toISOString(),
      sizeBytes,
      active: true,
    });
    if (!piperProviderAdded) {
      providers.unshift(
        createPiperRuntimeProvider({
          id: "piper-local",
          binaryPath: paths.piperBinaryPath,
          modelPathResolver: (runtimeModelId) => runtimeModelId,
          processRunner,
          fileSystem,
        }),
      );
      piperProviderAdded = true;
    }
  } else if (paths.piperHindiModelPath) {
    registry.addToCatalog(
      realMetadata(
        PIPER_HINDI_MODEL_ID,
        "tts",
        "piper",
        paths.piperHindiModelPath,
        63_000_000,
        "https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/dhiru/medium/hi_IN-dhiru-medium.onnx",
      ),
    );
  }

  return { providers, diagnostics };
}

export function createRegistryForVoiceModels(): ModelRegistry {
  return new ModelRegistry();
}
