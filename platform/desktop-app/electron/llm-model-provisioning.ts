import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import type { FileSystemLike, ProcessHandle, ProcessRunner } from "@ryper/local-runtime";
import type { HttpFetch } from "@ryper/ai-engine";

/**
 * Phase 13.9. Mirrors `voice-model-provisioning.ts`'s (Phase 13.7/13.8)
 * exact pattern for whisper.cpp/Piper: real, on-disk detection of a
 * real, externally-installed binary+model, never bundled into this
 * repository, with actionable diagnostics distinguishing "binary
 * missing" from "model missing" rather than a bare "AI unavailable."
 *
 * Unlike whisper.cpp/Piper (a single CLI invocation per request),
 * llama.cpp's `llama-server` is a real, long-running HTTP server
 * process — this file additionally manages that process's lifecycle
 * (start, real HTTP health-check polling for readiness, stop) via the
 * same `ProcessRunner` abstraction Phase 13.7/13.8 established. Once
 * running, `@ryper/local-runtime`'s existing `createLlamaCppProvider`
 * (unchanged, Phase 4) talks to it — this file only owns getting a
 * real server process up and telling the rest of the architecture
 * where it's actually listening.
 */

export interface LlamaServerPaths {
  readonly binaryPath: string;
  readonly modelPath: string;
  readonly port: number;
  readonly contextSize?: number;
}

export type LlamaModelAvailability = "installed" | "binary-missing" | "model-missing";

export interface LlamaModelDiagnostics {
  readonly status: LlamaModelAvailability;
  readonly detail: string;
}

/** Real defaults under the app's own data directory — never a system-wide path, never auto-downloaded. */
export function defaultLlamaServerPaths(userDataDir: string): LlamaServerPaths {
  const bin = process.platform === "win32" ? ".exe" : "";
  const base = userDataDir && userDataDir.length > 0 ? userDataDir : tmpdir();
  const modelsDir = basename(base).toLowerCase() === "models" ? base : join(base, "models");
  const envCtx = process.env["RYPER_LLAMA_CTX_SIZE"];
  return {
    binaryPath:
      process.env["RYPER_LLAMA_SERVER_BINARY"] ??
      join(modelsDir, "llama", `llama-server${bin}`),
    modelPath: process.env["RYPER_LLAMA_MODEL"] ?? join(modelsDir, "llama", "model.gguf"),
    port: Number(process.env["RYPER_LLAMA_SERVER_PORT"] ?? 8090),
    contextSize: envCtx ? Number(envCtx) : 8192,
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

export async function detectLlamaModelStatus(
  fileSystem: FileSystemLike,
  paths: LlamaServerPaths,
): Promise<LlamaModelDiagnostics> {
  if (!isValidBinaryPath(paths.binaryPath)) {
    return { status: "binary-missing", detail: `binary path "${paths.binaryPath}" is invalid or unsafe` };
  }
  const binaryExists = await fileSystem.exists(paths.binaryPath);
  if (!binaryExists) {
    return { status: "binary-missing", detail: `binary not found at "${paths.binaryPath}"` };
  }
  const modelExists = await fileSystem.exists(paths.modelPath);
  if (!modelExists) {
    return {
      status: "model-missing",
      detail: `local LLM runtime is installed at "${paths.binaryPath}" but the configured model is missing at "${paths.modelPath}"`,
    };
  }
  return { status: "installed", detail: "binary and model both found" };
}

export class LlamaServerStartError extends Error {}

/**
 * Manages the lifecycle of a real `llama-server` process.
 * Mirrors `voice-model-provisioning.ts`'s process management style.
 */
export class LlamaServerManager {
  private handle: ProcessHandle | undefined;
  private baseUrl: string | undefined;

  constructor(
    private readonly processRunner: ProcessRunner,
    private readonly httpFetch: HttpFetch,
  ) {}

  isRunning(): boolean {
    return this.handle !== undefined;
  }

  getBaseUrl(): string | undefined {
    return this.baseUrl;
  }

  async start(paths: LlamaServerPaths, readyTimeoutMs = 60_000): Promise<string> {
    if (this.handle) return this.baseUrl!;
    if (!isValidBinaryPath(paths.binaryPath)) {
      throw new LlamaServerStartError(`Unsafe or invalid binary path: "${paths.binaryPath}"`);
    }

    const ctx = paths.contextSize ?? 8192;
    this.handle = this.processRunner(paths.binaryPath, [
      "-m",
      paths.modelPath,
      "--port",
      String(paths.port),
      "--host",
      "127.0.0.1",
      "-c",
      String(ctx),
      // Required for correct structured tool-calling (docs/adr/0021):
      // without `--jinja`, llama.cpp's server does not render the GGUF's
      // embedded Jinja chat template, which is what encodes Qwen3's (and
      // most modern models') tool-call format — the server instead falls
      // back to a generic completion template with no tool-call-aware
      // parsing hooks, so `tools`/`tool_calls` in the OpenAI-compatible
      // request/response never round-trip correctly. Harmless for plain
      // chat (Phase 13.10/13.11's real verification): it only changes
      // how the prompt template is rendered internally, not the
      // OpenAI-compatible wire format this repo's `OpenAICompatibleProvider`
      // already speaks.
      // GPU offload layers (default 99 offloads all layers if GPU is available, fallback to CPU)
      "-ngl",
      process.env["RYPER_LLAMA_GPU_LAYERS"] ?? "99",
      "--flash-attn",
      process.env["RYPER_LLAMA_FLASH_ATTN"] ?? "on",
      "--jinja",
    ]);
    this.baseUrl = `http://127.0.0.1:${paths.port}/v1`;
    const healthUrl = `http://127.0.0.1:${paths.port}/health`;

    // Real exit is also a real, immediate startup failure — don't wait
    // out the full readiness timeout if the process died right away.
    // A genuine spawn failure (missing binary, permission denied, etc.
    // — `ProcessHandle.result` *rejects* for this, per
    // `process-runner.ts`) must be treated the same way: without this
    // rejection handler, `exited` never became `true`, so `start()`
    // polled a health endpoint that could never succeed for the
    // *entire* timeout instead of failing immediately, and the
    // unobserved rejection surfaced only as an unhandled promise
    // rejection elsewhere.
    let exited = false;
    let spawnError: unknown;
    void this.handle.result.then(
      () => {
        exited = true;
      },
      (err: unknown) => {
        exited = true;
        spawnError = err;
      },
    );

    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline) {
      if (exited) {
        this.handle = undefined;
        this.baseUrl = undefined;
        if (spawnError !== undefined) {
          const reason = spawnError instanceof Error ? spawnError.message : String(spawnError);
          throw new LlamaServerStartError(
            `llama-server failed to start (binary: "${paths.binaryPath}", model: "${paths.modelPath}"): ${reason}`,
          );
        }
        throw new LlamaServerStartError(
          `llama-server exited before becoming ready (binary: "${paths.binaryPath}", model: "${paths.modelPath}")`,
        );
      }
      try {
        const response = await this.httpFetch(healthUrl, { method: "GET", headers: {} });
        if (response.ok) return this.baseUrl;
      } catch {
        // Not listening yet — real connection refused while the server starts. Keep polling.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    this.stop();
    throw new LlamaServerStartError(`llama-server did not become ready within ${readyTimeoutMs}ms`);
  }

  stop(): void {
    this.handle?.kill("SIGTERM");
    this.handle = undefined;
    this.baseUrl = undefined;
  }
}

export function createLlamaServerManager(
  processRunner: ProcessRunner,
  httpFetch: HttpFetch,
): LlamaServerManager {
  return new LlamaServerManager(processRunner, httpFetch);
}
