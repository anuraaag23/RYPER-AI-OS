import { describe, expect, it, vi } from "vitest";
import { InMemoryFileSystem } from "../../src/filesystem.js";
import type {
  ProcessHandle,
  ProcessResult,
  ProcessRunner,
} from "../../src/runtime-providers/process-runner.js";
import {
  PiperBinaryNotFoundError,
  PiperModelMissingError,
  PiperSynthesisError,
  createPiperRuntimeProvider,
} from "../../src/runtime-providers/piper.js";

/**
 * DETERMINISTIC UNIT TEST DOUBLE — not a real Piper process. See the
 * equivalent notice in whisper-cpp.test.ts; the same applies here.
 */
function fakeProcessRunner(
  behavior: (
    command: string,
    args: readonly string[],
    stdin: Uint8Array | undefined,
  ) => Promise<Partial<ProcessResult>>,
): { runner: ProcessRunner; killed: string[]; capturedStdin: Uint8Array[] } {
  const killed: string[] = [];
  const capturedStdin: Uint8Array[] = [];
  const runner: ProcessRunner = (command, args, options) => {
    if (options?.stdin) capturedStdin.push(options.stdin);
    const resultPromise = behavior(command, args, options?.stdin).then(
      (partial): ProcessResult => ({
        stdout: partial.stdout ?? new Uint8Array(0),
        stderr: partial.stderr ?? "",
        exitCode: partial.exitCode ?? 0,
        signal: partial.signal ?? null,
      }),
    );
    const handle: ProcessHandle = {
      result: resultPromise,
      writeStdin: () => {},
      endStdin: () => {},
      kill: (signal) => killed.push(signal ?? "SIGTERM"),
    };
    return handle;
  };
  return { runner, killed, capturedStdin };
}

function fs(files: Record<string, string> = {}): InMemoryFileSystem {
  const memfs = new InMemoryFileSystem();
  for (const [path, content] of Object.entries(files)) {
    void memfs.writeFile(path, new TextEncoder().encode(content));
  }
  return memfs;
}

describe("createPiperRuntimeProvider", () => {
  it("isAvailable() reflects real binary existence on the injected filesystem", async () => {
    const withBinary = createPiperRuntimeProvider({
      id: "piper",
      binaryPath: "/opt/piper/piper",
      modelPathResolver: () => "/opt/piper/voice.onnx",
      processRunner: fakeProcessRunner(async () => ({})).runner,
      fileSystem: fs({ "/opt/piper/piper": "binary" }),
    });
    await expect(withBinary.isAvailable()).resolves.toBe(true);

    const withoutBinary = createPiperRuntimeProvider({
      id: "piper",
      binaryPath: "/opt/piper/piper",
      modelPathResolver: () => "/opt/piper/voice.onnx",
      processRunner: fakeProcessRunner(async () => ({})).runner,
      fileSystem: fs(),
    });
    await expect(withoutBinary.isAvailable()).resolves.toBe(false);
  });

  it("throws PiperBinaryNotFoundError, honestly, rather than fabricating audio", async () => {
    const provider = createPiperRuntimeProvider({
      id: "piper",
      binaryPath: "/opt/piper/piper",
      modelPathResolver: () => "/opt/piper/voice.onnx",
      processRunner: fakeProcessRunner(async () => ({})).runner,
      fileSystem: fs(),
    });
    await expect(provider.synthesizeSpeech?.("piper-en-us", { text: "hello" })).rejects.toThrow(
      PiperBinaryNotFoundError,
    );
  });

  it("throws PiperModelMissingError when the binary exists but the voice model doesn't", async () => {
    const provider = createPiperRuntimeProvider({
      id: "piper",
      binaryPath: "/opt/piper/piper",
      modelPathResolver: () => "/opt/piper/voice.onnx",
      processRunner: fakeProcessRunner(async () => ({})).runner,
      fileSystem: fs({ "/opt/piper/piper": "binary" }),
    });
    await expect(provider.synthesizeSpeech?.("piper-en-us", { text: "hello" })).rejects.toThrow(
      PiperModelMissingError,
    );
  });

  it("writes text to real stdin, invokes the binary with real args, and reads the real WAV output", async () => {
    const memfs = fs({ "/opt/piper/piper": "binary", "/opt/piper/piper-en-us.onnx": "voice" });
    let capturedArgs: readonly string[] = [];
    const wavBytes = new Uint8Array([82, 73, 70, 70]); // "RIFF"
    const { runner, capturedStdin } = fakeProcessRunner(async (command, args) => {
      expect(command).toBe("/opt/piper/piper");
      capturedArgs = args;
      const outputIndex = args.indexOf("--output_file");
      const outputPath = args[outputIndex + 1] as string;
      await memfs.writeFile(outputPath, wavBytes);
      return { exitCode: 0 };
    });

    const provider = createPiperRuntimeProvider({
      id: "piper",
      binaryPath: "/opt/piper/piper",
      modelPathResolver: (modelId) => `/opt/piper/${modelId}.onnx`,
      processRunner: runner,
      fileSystem: memfs,
    });

    const result = await provider.synthesizeSpeech?.("piper-en-us", {
      text: "Ten AM.",
    });

    expect(result?.audioBytes).toEqual(wavBytes);
    expect(capturedArgs).toContain("--model");
    expect(capturedArgs).toContain("/opt/piper/piper-en-us.onnx");
    expect(new TextDecoder().decode(capturedStdin[0])).toBe("Ten AM.");
  });

  it("throws PiperSynthesisError with real stderr on a non-zero exit code", async () => {
    const memfs = fs({ "/opt/piper/piper": "binary", "/opt/piper/voice.onnx": "voice" });
    const { runner } = fakeProcessRunner(async () => ({ exitCode: 1, stderr: "bad voice config" }));
    const provider = createPiperRuntimeProvider({
      id: "piper",
      binaryPath: "/opt/piper/piper",
      modelPathResolver: () => "/opt/piper/voice.onnx",
      processRunner: runner,
      fileSystem: memfs,
    });

    await expect(provider.synthesizeSpeech?.("piper-en-us", { text: "hi" })).rejects.toThrow(
      PiperSynthesisError,
    );
  });

  it("cancellation via AbortSignal kills the real process, not merely an internal flag", async () => {
    const memfs = fs({ "/opt/piper/piper": "binary", "/opt/piper/voice.onnx": "voice" });
    let resolveProcess: (() => void) | undefined;
    const { runner, killed } = fakeProcessRunner(
      () =>
        new Promise((resolve) => {
          resolveProcess = () => resolve({ exitCode: 1, signal: "SIGTERM" });
        }),
    );
    const provider = createPiperRuntimeProvider({
      id: "piper",
      binaryPath: "/opt/piper/piper",
      modelPathResolver: () => "/opt/piper/voice.onnx",
      processRunner: runner,
      fileSystem: memfs,
    });

    const controller = new AbortController();
    const promise = provider.synthesizeSpeech?.("piper-en-us", {
      text: "Your meeting tomorrow is scheduled for ten AM and—",
      signal: controller.signal,
    });

    await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    resolveProcess?.();

    await expect(promise).rejects.toThrow("cancelled");
    expect(killed).toContain("SIGTERM");
  });

  it("kills the process and fails cleanly on timeout, rather than hanging forever", async () => {
    vi.useFakeTimers();
    try {
      const memfs = fs({ "/opt/piper/piper": "binary", "/opt/piper/voice.onnx": "voice" });
      let resolveProcess: (() => void) | undefined;
      const { runner, killed } = fakeProcessRunner(
        () =>
          new Promise((resolve) => {
            resolveProcess = () => resolve({ exitCode: 1, signal: "SIGTERM" });
          }),
      );
      const provider = createPiperRuntimeProvider({
        id: "piper",
        binaryPath: "/opt/piper/piper",
        modelPathResolver: () => "/opt/piper/voice.onnx",
        processRunner: runner,
        fileSystem: memfs,
        timeoutMs: 100,
      });

      const promise = provider.synthesizeSpeech?.("piper-en-us", { text: "hi" });
      const assertion = expect(promise).rejects.toThrow(PiperSynthesisError);
      await vi.advanceTimersByTimeAsync(150);
      resolveProcess?.();
      await assertion;
      expect(killed).toContain("SIGTERM");
    } finally {
      vi.useRealTimers();
    }
  });
});
