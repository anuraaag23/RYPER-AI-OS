import type { FileSystemLike } from "../filesystem.js";
import type { LocalRuntimeProvider, ModelType, TTSRequest, TTSResult } from "../types.js";
import type { ProcessRunner } from "./process-runner.js";

export class PiperBinaryNotFoundError extends Error {
  constructor(binaryPath: string) {
    super(
      `Piper binary not found at "${binaryPath}" — install it and set the configured path (see docs/PROJECT_STATE.md's Phase 13.7 section for exact instructions)`,
    );
    this.name = "PiperBinaryNotFoundError";
  }
}

export class PiperModelMissingError extends Error {
  constructor(modelPath: string) {
    super(
      `Piper voice model not found at "${modelPath}" — download a voice and set the configured path (see docs/PROJECT_STATE.md's Phase 13.7 section for exact instructions)`,
    );
    this.name = "PiperModelMissingError";
  }
}

export class PiperSynthesisError extends Error {
  constructor(
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(`Piper exited with code ${exitCode ?? "null"}: ${stderr.trim().slice(0, 500)}`);
    this.name = "PiperSynthesisError";
  }
}

export interface PiperRuntimeConfig {
  readonly id: string;
  /** Path to the real Piper CLI binary. */
  readonly binaryPath: string;
  /** Maps a registered model id to the real Piper voice `.onnx` file on disk (Piper additionally expects a same-named `.onnx.json` config next to it). */
  readonly modelPathResolver: (modelId: string) => string;
  readonly processRunner: ProcessRunner;
  readonly fileSystem: FileSystemLike;
  readonly timeoutMs?: number;
}

/**
 * Real integration with a real, external Piper CLI binary. Piper reads
 * plain text on stdin and writes a real WAV file to the path given by
 * `--output_file` (or streams raw PCM with `--output-raw`, not used here
 * so the result is a real, self-contained, directly-decodable WAV — the
 * same container `@ryper/voice-engine`'s `TtsAudioChunk.mimeType` already
 * expects). The voice model is provisioned separately, never bundled
 * into this repository. Cancellation kills the real child process.
 */
export function createPiperRuntimeProvider(config: PiperRuntimeConfig): LocalRuntimeProvider {
  const supportedModelTypes: readonly ModelType[] = ["tts"];

  async function checkAvailable(): Promise<boolean> {
    return config.fileSystem.exists(config.binaryPath);
  }

  return {
    id: config.id,
    kind: "piper",
    supportedModelTypes,
    isAvailable: checkAvailable,

    async synthesizeSpeech(modelId: string, request: TTSRequest): Promise<TTSResult> {
      if (!(await config.fileSystem.exists(config.binaryPath))) {
        throw new PiperBinaryNotFoundError(config.binaryPath);
      }
      const modelPath = config.modelPathResolver(modelId);
      if (!(await config.fileSystem.exists(modelPath))) {
        throw new PiperModelMissingError(modelPath);
      }

      const tempDir = "/tmp/ryper-piper";
      await config.fileSystem.mkdir(tempDir);
      const outputPath = `${tempDir}/${Date.now()}-${Math.random().toString(36).slice(2)}.wav`;

      const args = ["--model", modelPath, "--output_file", outputPath];

      const handle = config.processRunner(config.binaryPath, args, {
        stdin: new TextEncoder().encode(request.text),
      });

      let timedOut = false;
      const timeoutMs = config.timeoutMs ?? 15_000;
      const timer = setTimeout(() => {
        timedOut = true;
        handle.kill("SIGTERM");
      }, timeoutMs);

      const onAbort = (): void => handle.kill("SIGTERM");
      request.signal?.addEventListener("abort", onAbort);

      try {
        const result = await handle.result;
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);

        if (request.signal?.aborted) {
          throw new Error("speech synthesis was cancelled");
        }
        if (timedOut) {
          throw new PiperSynthesisError(result.exitCode, `timed out after ${timeoutMs}ms`);
        }
        if (result.exitCode !== 0) {
          throw new PiperSynthesisError(result.exitCode, result.stderr);
        }

        const audioBytes = await config.fileSystem.readFile(outputPath);
        await config.fileSystem.deleteFile(outputPath).catch(() => {});
        return { audioBytes };
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
