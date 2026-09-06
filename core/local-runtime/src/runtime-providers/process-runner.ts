/**
 * Real local speech models (whisper.cpp, Piper) ship as standalone CLI
 * binaries, not something you `import`/link against — the real
 * integration is spawning a real child process. This interface is
 * injected the same way `HttpFetch` and `FileSystemLike` are elsewhere
 * in this codebase: tests use a deterministic fake, `createNodeProcessRunner()`
 * (below) is the real Node.js `child_process` implementation platform
 * shells pass in.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
export interface ProcessResult {
  readonly stdout: Uint8Array;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
}

export class ProcessSpawnError extends Error {
  constructor(
    public readonly command: string,
    cause: unknown,
  ) {
    super(
      `failed to spawn "${command}": ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "ProcessSpawnError";
  }
}

export interface ProcessHandle {
  /** Resolves once the process exits — never rejects for a non-zero exit code, only for a real spawn failure (`ProcessSpawnError`, e.g. binary not found). */
  readonly result: Promise<ProcessResult>;
  /** Writes to the process's real stdin. */
  writeStdin(chunk: Uint8Array): void;
  /** Closes stdin, signaling no more input (many CLIs, including Piper, wait for EOF). */
  endStdin(): void;
  /** Sends a real signal (default `SIGTERM`) to the real process — the mechanism `AbortSignal`-driven cancellation uses to actually stop inference. */
  kill(signal?: NodeJS.Signals): void;
}

export interface ProcessRunOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Bytes to write to stdin immediately, then close it (convenience for CLIs that read all input before producing output). */
  readonly stdin?: Uint8Array;
}

export type ProcessRunner = (
  command: string,
  args: readonly string[],
  options?: ProcessRunOptions,
) => ProcessHandle;

/**
 * The real implementation, backed by Node's `node:child_process`. Kept in
 * its own function (rather than imported at module scope everywhere a
 * provider is constructed) so every runtime-provider file above it stays
 * testable with a fake `ProcessRunner` and never needs to spawn a real
 * process to be unit-tested.
 */
export function createNodeProcessRunner(): ProcessRunner {
  return (command, args, options) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, args, {
        cwd: options?.cwd,
        env: options?.env ? { ...process.env, ...options.env } : process.env,
      });
    } catch (err) {
      throw new ProcessSpawnError(command, err);
    }

    const stdoutChunks: Uint8Array[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(new Uint8Array(chunk)));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    const result = new Promise<ProcessResult>((resolve, reject) => {
      child.once("error", (err) => reject(new ProcessSpawnError(command, err)));
      child.once("close", (code, signal) => {
        const totalLength = stdoutChunks.reduce((sum, c) => sum + c.byteLength, 0);
        const stdout = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of stdoutChunks) {
          stdout.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve({ stdout, stderr, exitCode: code, signal });
      });
    });

    if (options?.stdin) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    }

    return {
      result,
      writeStdin: (chunk: Uint8Array) => child.stdin.write(chunk),
      endStdin: () => child.stdin.end(),
      kill: (signal: NodeJS.Signals = "SIGTERM") => child.kill(signal),
    };
  };
}
