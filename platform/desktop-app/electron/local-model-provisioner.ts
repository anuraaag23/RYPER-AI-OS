import { basename, dirname, join } from "node:path";
import { copyFile, link, mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createLogger } from "@ryper/logging";

const log = createLogger("desktop-app:model-provisioner");

export interface ProvisioningStatus {
  readonly llama: {
    readonly binary: boolean;
    readonly model: boolean;
    readonly binaryPath?: string;
    readonly modelPath?: string;
  };
  readonly whisper: {
    readonly binary: boolean;
    readonly model: boolean;
    readonly multilingualModel?: boolean;
    readonly binaryPath?: string;
    readonly modelPath?: string;
    readonly multilingualModelPath?: string;
  };
  readonly piper: {
    readonly binary: boolean;
    readonly model: boolean;
    readonly hindiModel?: boolean;
    readonly binaryPath?: string;
    readonly modelPath?: string;
    readonly hindiModelPath?: string;
  };
  readonly provisionedCount: number;
}

/**
 * Atomically links or copies a source file to a target path using `.part` file semantics.
 * If target already exists with non-zero size, it is left untouched.
 * Attempts a hard link first (instant, 0 extra disk space on same volume).
 * Falls back to streaming copy to `${target}.part` followed by atomic rename.
 */
export async function atomicCopyOrLink(source: string, target: string): Promise<boolean> {
  try {
    if (existsSync(target)) {
      const targetStat = await stat(target);
      if (targetStat.size > 0) {
        return true;
      }
    }

    if (!existsSync(source)) {
      return false;
    }

    const sourceStat = await stat(source);
    if (sourceStat.size === 0) {
      return false;
    }

    await mkdir(dirname(target), { recursive: true });

    // Try hard link first
    try {
      await link(source, target);
      log.info("Linked model file", { source, target });
      return true;
    } catch {
      // Hard link not supported or cross-device; proceed with atomic .part copy
    }

    const partPath = `${target}.part`;
    if (existsSync(partPath)) {
      try {
        await unlink(partPath);
      } catch {
        // ignore
      }
    }

    await copyFile(source, partPath);
    const partStat = await stat(partPath);
    if (partStat.size !== sourceStat.size) {
      await unlink(partPath);
      throw new Error(`Size mismatch after copying ${source} to ${partPath}`);
    }

    await rename(partPath, target);
    log.info("Copied model file atomically", { source, target });
    return true;
  } catch (err) {
    log.warn("Failed to provision file", { source, target, error: String(err) });
    return false;
  }
}

function getCandidateSources(): {
  llamaBinaries: string[];
  llamaModels: string[];
  whisperBinaries: string[];
  whisperModels: string[];
  whisperMultilingualModels: string[];
  piperBinaries: string[];
  piperModels: string[];
  piperHindiModels: string[];
} {
  const appData = process.env["APPDATA"] ?? "";
  const electronModels = appData ? join(appData, "Electron", "models") : "";

  return {
    llamaBinaries: [
      join("C:", "RyperAI", "llama", "llama-server.exe"),
      join(electronModels, "llama", "llama-server.exe"),
    ],
    llamaModels: [
      join("C:", "RyperAI", "models", "Qwen3-8B-Q4_K_M.gguf"),
      join(electronModels, "llama", "model.gguf"),
    ],
    whisperBinaries: [
      join(electronModels, "whisper", "main.exe"),
      join(electronModels, "whisper", "whisper-cli.exe"),
    ],
    whisperModels: [
      join(electronModels, "whisper", "ggml-base.en.bin"),
    ],
    whisperMultilingualModels: [
      join(electronModels, "whisper", "ggml-base.bin"),
      join(electronModels, "whisper", "ggml-small.bin"),
      join("C:", "RyperAI", "models", "ggml-base.bin"),
    ],
    piperBinaries: [
      join(electronModels, "piper", "piper.exe"),
      join(electronModels, "piper", "venv", "Scripts", "piper.exe"),
    ],
    piperModels: [
      join(electronModels, "piper", "en_US-lessac-medium.onnx"),
    ],
    piperHindiModels: [
      join(electronModels, "piper", "hi_IN-dhiru-medium.onnx"),
      join(electronModels, "piper", "hi_IN-nitin-medium.onnx"),
      join("C:", "RyperAI", "models", "hi_IN-dhiru-medium.onnx"),
    ],
  };
}

const README_CONTENT = `RYPER AI OS — LOCAL AI MODELS DIRECTORY
=======================================

This folder stores the local AI runtime binaries and model weights used by RYPER AI OS.
RYPER operates 100% locally and privately when these files are present.
If absent, RYPER will gracefully fall back to heuristic and reference providers without crashing.

Expected Directory Structure:
-----------------------------

1. Llama.cpp (Local LLM - Qwen3-8B):
   models/llama/llama-server.exe
   models/llama/model.gguf

2. Whisper (Speech-to-Text):
   models/whisper/main.exe  (or whisper-cli.exe)
   models/whisper/ggml-base.en.bin (English)
   models/whisper/ggml-base.bin    (Multilingual - Hindi, English, Hinglish)

3. Piper (Text-to-Speech):
   models/piper/piper.exe
   models/piper/en_US-lessac-medium.onnx (English voice)
   models/piper/en_US-lessac-medium.onnx.json
   models/piper/hi_IN-dhiru-medium.onnx  (Hindi voice)
   models/piper/hi_IN-dhiru-medium.onnx.json

Environment Variable Overrides:
-------------------------------
You may also point RYPER to models located anywhere on your system via environment variables:
- RYPER_LLAMA_SERVER_BINARY
- RYPER_LLAMA_MODEL
- RYPER_WHISPER_BINARY
- RYPER_WHISPER_MODEL
- RYPER_WHISPER_MULTILINGUAL_MODEL
- RYPER_PIPER_BINARY
- RYPER_PIPER_MODEL
- RYPER_PIPER_HINDI_MODEL
`;

/**
 * Provisions local model files into the application's models directory.
 * Discovers existing models on the system (e.g. from developer setup or Electron data),
 * links/copies them into place atomically, and creates setup documentation.
 */
export async function provisionLocalModels(modelsDirOrBase: string): Promise<ProvisioningStatus> {
  const modelsDir =
    basename(modelsDirOrBase).toLowerCase() === "models"
      ? modelsDirOrBase
      : join(modelsDirOrBase, "models");

  const llamaDir = join(modelsDir, "llama");
  const whisperDir = join(modelsDir, "whisper");
  const piperDir = join(modelsDir, "piper");

  await mkdir(llamaDir, { recursive: true });
  await mkdir(whisperDir, { recursive: true });
  await mkdir(piperDir, { recursive: true });

  const readmePath = join(modelsDir, "README_MODELS.txt");
  if (!existsSync(readmePath)) {
    try {
      await writeFile(readmePath, README_CONTENT, "utf-8");
    } catch {
      // non-critical
    }
  }

  const binExt = process.platform === "win32" ? ".exe" : "";
  const targetLlamaBin = join(llamaDir, `llama-server${binExt}`);
  const targetLlamaModel = join(llamaDir, "model.gguf");
  const targetWhisperBin = join(whisperDir, `main${binExt}`);
  const targetWhisperModel = join(whisperDir, "ggml-base.en.bin");
  const targetWhisperMultilingualModel = join(whisperDir, "ggml-base.bin");
  const targetPiperBin = join(piperDir, `piper${binExt}`);
  const targetPiperModel = join(piperDir, "en_US-lessac-medium.onnx");
  const targetPiperHindiModel = join(piperDir, "hi_IN-dhiru-medium.onnx");

  const candidates = getCandidateSources();
  let provisionedCount = 0;

async function linkCompanionDlls(srcDir: string, targetDir: string): Promise<void> {
  try {
    if (!existsSync(srcDir)) return;
    const entries = await readdir(srcDir);
    for (const entry of entries) {
      if (entry.toLowerCase().endsWith(".dll")) {
        await atomicCopyOrLink(join(srcDir, entry), join(targetDir, entry));
      }
    }
  } catch {
    // non-critical
  }
}

  // Llama server binary
  for (const src of candidates.llamaBinaries) {
    if (existsSync(src)) {
      if (!existsSync(targetLlamaBin)) {
        const ok = await atomicCopyOrLink(src, targetLlamaBin);
        if (ok) provisionedCount++;
      }
      await linkCompanionDlls(dirname(src), llamaDir);
      break;
    }
  }

  // Llama model
  if (!existsSync(targetLlamaModel)) {
    for (const src of candidates.llamaModels) {
      if (existsSync(src)) {
        const ok = await atomicCopyOrLink(src, targetLlamaModel);
        if (ok) {
          provisionedCount++;
          break;
        }
      }
    }
  }

  // Whisper binary
  for (const src of candidates.whisperBinaries) {
    if (existsSync(src)) {
      if (!existsSync(targetWhisperBin)) {
        const ok = await atomicCopyOrLink(src, targetWhisperBin);
        if (ok) provisionedCount++;
      }
      await linkCompanionDlls(dirname(src), whisperDir);
      break;
    }
  }

  // Whisper model (English)
  if (!existsSync(targetWhisperModel)) {
    for (const src of candidates.whisperModels) {
      if (existsSync(src)) {
        const ok = await atomicCopyOrLink(src, targetWhisperModel);
        if (ok) {
          provisionedCount++;
          break;
        }
      }
    }
  }

  // Whisper model (Multilingual)
  if (!existsSync(targetWhisperMultilingualModel)) {
    for (const src of candidates.whisperMultilingualModels) {
      if (existsSync(src)) {
        const ok = await atomicCopyOrLink(src, targetWhisperMultilingualModel);
        if (ok) {
          provisionedCount++;
          break;
        }
      }
    }
  }

  // Piper binary
  if (!existsSync(targetPiperBin)) {
    for (const src of candidates.piperBinaries) {
      if (existsSync(src)) {
        const ok = await atomicCopyOrLink(src, targetPiperBin);
        if (ok) {
          provisionedCount++;
          break;
        }
      }
    }
  }

  // Piper model (English)
  if (!existsSync(targetPiperModel)) {
    for (const src of candidates.piperModels) {
      if (existsSync(src)) {
        const ok = await atomicCopyOrLink(src, targetPiperModel);
        if (ok) {
          provisionedCount++;
          // Also check for .json sidecar
          const jsonSrc = `${src}.json`;
          if (existsSync(jsonSrc)) {
            await atomicCopyOrLink(jsonSrc, `${targetPiperModel}.json`);
          }
          break;
        }
      }
    }
  }

  // Piper model (Hindi)
  if (!existsSync(targetPiperHindiModel)) {
    for (const src of candidates.piperHindiModels) {
      if (existsSync(src)) {
        const ok = await atomicCopyOrLink(src, targetPiperHindiModel);
        if (ok) {
          provisionedCount++;
          const jsonSrc = `${src}.json`;
          if (existsSync(jsonSrc)) {
            await atomicCopyOrLink(jsonSrc, `${targetPiperHindiModel}.json`);
          }
          break;
        }
      }
    }
  }

  const llamaBinExists = existsSync(targetLlamaBin);
  const llamaModelExists = existsSync(targetLlamaModel);
  const whisperBinExists = existsSync(targetWhisperBin);
  const whisperModelExists = existsSync(targetWhisperModel);
  const whisperMultiModelExists = existsSync(targetWhisperMultilingualModel);
  const piperBinExists = existsSync(targetPiperBin);
  const piperModelExists = existsSync(targetPiperModel);
  const piperHindiModelExists = existsSync(targetPiperHindiModel);

  return {
    llama: {
      binary: llamaBinExists,
      model: llamaModelExists,
      ...(llamaBinExists ? { binaryPath: targetLlamaBin } : {}),
      ...(llamaModelExists ? { modelPath: targetLlamaModel } : {}),
    },
    whisper: {
      binary: whisperBinExists,
      model: whisperModelExists,
      multilingualModel: whisperMultiModelExists,
      ...(whisperBinExists ? { binaryPath: targetWhisperBin } : {}),
      ...(whisperModelExists ? { modelPath: targetWhisperModel } : {}),
      ...(whisperMultiModelExists ? { multilingualModelPath: targetWhisperMultilingualModel } : {}),
    },
    piper: {
      binary: piperBinExists,
      model: piperModelExists,
      hindiModel: piperHindiModelExists,
      ...(piperBinExists ? { binaryPath: targetPiperBin } : {}),
      ...(piperModelExists ? { modelPath: targetPiperModel } : {}),
      ...(piperHindiModelExists ? { hindiModelPath: targetPiperHindiModel } : {}),
    },
    provisionedCount,
  };
}
