import type { FileSystemLike } from "../filesystem.js";
import type { ASRRequest, ASRResult, LocalRuntimeProvider, ModelType } from "../types.js";
import type { ProcessRunner } from "./process-runner.js";

export class WhisperBinaryNotFoundError extends Error {
  constructor(binaryPath: string) {
    super(
      `whisper.cpp binary not found at "${binaryPath}" — install it and set the configured path (see docs/PROJECT_STATE.md's Phase 13.7 section for exact instructions)`,
    );
    this.name = "WhisperBinaryNotFoundError";
  }
}

export class WhisperModelMissingError extends Error {
  constructor(modelPath: string) {
    super(
      `whisper.cpp model not found at "${modelPath}" — download a ggml model and set the configured path (see docs/PROJECT_STATE.md's Phase 13.7 section for exact instructions)`,
    );
    this.name = "WhisperModelMissingError";
  }
}

export class WhisperTranscriptionError extends Error {
  constructor(
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(`whisper.cpp exited with code ${exitCode ?? "null"}: ${stderr.trim().slice(0, 500)}`);
    this.name = "WhisperTranscriptionError";
  }
}

export interface WhisperCppRuntimeConfig {
  readonly id: string;
  /** Path to a whisper.cpp CLI binary (`main`/`whisper-cli`, built with `-otxt` output support). */
  readonly binaryPath: string;
  /** Maps a registered model id to the real `.bin` (ggml) file on disk. */
  readonly modelPathResolver: (modelId: string) => string;
  readonly processRunner: ProcessRunner;
  readonly fileSystem: FileSystemLike;
  readonly timeoutMs?: number;
}

/** `ASRRequest.audioBytes` are raw 16-bit PCM mono samples at this rate (matches `@ryper/voice-engine`'s `MicrophoneManager` default). Wrapped into a real, minimal WAV container — whisper.cpp's CLI reads WAV files, not raw PCM. */
const PCM_SAMPLE_RATE_HZ = 16000;

function pcm16ToWav(pcm: Uint8Array, sampleRateHz: number): Uint8Array {
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcm);
  return new Uint8Array(buffer);
}

/**
 * Real integration with a real, external whisper.cpp CLI binary — the
 * binary and model are provisioned separately (see Phase 13.7's model
 * management docs), never bundled into this repository. Audio in, real
 * transcript out: writes the request's PCM to a real temp WAV file,
 * spawns the real binary with `--output-txt`, reads its real stdout/the
 * `.txt` sidecar file it writes, and cleans up. Cancellation kills the
 * real child process, not merely an internal flag.
 */
export function normalizeWhisperLanguage(lang?: string): string | undefined {
  if (!lang) return undefined;
  const trimmed = lang.trim().toLowerCase();
  if (trimmed === "auto") return "auto";
  const primary = trimmed.split(/[-_]/)[0];
  return primary || trimmed;
}

export function createWhisperCppRuntimeProvider(
  config: WhisperCppRuntimeConfig,
): LocalRuntimeProvider {
  const supportedModelTypes: readonly ModelType[] = ["asr"];

  async function checkAvailable(): Promise<boolean> {
    return config.fileSystem.exists(config.binaryPath);
  }

  return {
    id: config.id,
    kind: "whisper-cpp",
    supportedModelTypes,
    isAvailable: checkAvailable,

    async transcribe(modelId: string, request: ASRRequest): Promise<ASRResult> {
      if (!(await config.fileSystem.exists(config.binaryPath))) {
        throw new WhisperBinaryNotFoundError(config.binaryPath);
      }
      const modelPath = config.modelPathResolver(modelId);
      if (!(await config.fileSystem.exists(modelPath))) {
        throw new WhisperModelMissingError(modelPath);
      }

      const tempDir = "/tmp/ryper-whisper";
      await config.fileSystem.mkdir(tempDir);
      const inputPath = `${tempDir}/${Date.now()}-${Math.random().toString(36).slice(2)}.wav`;
      const outputPathBase = inputPath.replace(/\.wav$/, "");

      const wavBytes = pcm16ToWav(request.audioBytes, PCM_SAMPLE_RATE_HZ);
      await config.fileSystem.writeFile(inputPath, wavBytes);

      const normalizedLang = normalizeWhisperLanguage(request.language);
      const buildArgs = (includeLanguage: boolean): string[] => {
        const a = [
          "-m",
          modelPath,
          "-f",
          inputPath,
          "--output-txt",
          "--output-file",
          outputPathBase,
          "--no-prints",
        ];
        if (includeLanguage && normalizedLang) a.push("-l", normalizedLang);
        return a;
      };

      const runOnce = async (includeLanguage: boolean): Promise<{ exitCode: number | null; stderr: string; timedOut: boolean }> => {
        const handle = config.processRunner(config.binaryPath, buildArgs(includeLanguage));
        let timedOut = false;
        const timeoutMs = config.timeoutMs ?? 30_000;
        const timer = setTimeout(() => {
          timedOut = true;
          handle.kill("SIGTERM");
        }, timeoutMs);

        const onAbort = (): void => handle.kill("SIGTERM");
        request.signal?.addEventListener("abort", onAbort);

        try {
          const result = await handle.result;
          return { exitCode: result.exitCode, stderr: result.stderr, timedOut };
        } finally {
          clearTimeout(timer);
          request.signal?.removeEventListener("abort", onAbort);
        }
      };

      let execution = await runOnce(Boolean(normalizedLang));

      if (request.signal?.aborted) {
        throw new Error("transcription was cancelled");
      }
      if (execution.timedOut) {
        throw new WhisperTranscriptionError(execution.exitCode, `timed out after ${config.timeoutMs ?? 30_000}ms`);
      }

      // Defensive fallback: if whisper CLI failed with an incompatible language flag (e.g. English-only model), retry once without -l
      if (execution.exitCode !== 0 && normalizedLang) {
        const errLow = execution.stderr.toLowerCase();
        if (errLow.includes("language") || errLow.includes("model") || errLow.includes("unsupported") || errLow.includes("unknown")) {
          execution = await runOnce(false);
        }
      }

      if (execution.exitCode !== 0) {
        throw new WhisperTranscriptionError(execution.exitCode, execution.stderr);
      }

      const outputPath = `${outputPathBase}.txt`;
      const textBytes = await config.fileSystem.readFile(outputPath);
      const text = new TextDecoder().decode(textBytes).trim();
      await config.fileSystem.deleteFile(outputPath).catch(() => {});
      await config.fileSystem.deleteFile(inputPath).catch(() => {});
      return { text };
    },
  };
}
