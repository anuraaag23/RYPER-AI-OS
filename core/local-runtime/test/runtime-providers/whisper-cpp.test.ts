import { describe, expect, it, vi } from "vitest";
import { InMemoryFileSystem } from "../../src/filesystem.js";
import type {
  ProcessHandle,
  ProcessResult,
  ProcessRunner,
} from "../../src/runtime-providers/process-runner.js";
import {
  WhisperBinaryNotFoundError,
  WhisperModelMissingError,
  WhisperTranscriptionError,
  createWhisperCppRuntimeProvider,
} from "../../src/runtime-providers/whisper-cpp.js";

/**
 * DETERMINISTIC UNIT TEST DOUBLE — not a real whisper.cpp process. These
 * tests verify this file's own orchestration logic (argument building,
 * WAV wrapping, error mapping, cancellation-to-kill wiring, timeout
 * handling, temp-file cleanup) against a fake `ProcessRunner`. They are
 * NOT proof that a real whisper.cpp binary produces correct
 * transcriptions — see docs/PROJECT_STATE.md's Phase 13.7 section for
 * what remains NOT_VERIFIED without a real installed binary/model.
 */
function fakeProcessRunner(
  behavior: (command: string, args: readonly string[]) => Promise<Partial<ProcessResult>>,
): { runner: ProcessRunner; killed: string[] } {
  const killed: string[] = [];
  const runner: ProcessRunner = (command, args) => {
    let killSignal: string | undefined;
    const resultPromise = behavior(command, args).then((partial): ProcessResult => ({
      stdout: partial.stdout ?? new Uint8Array(0),
      stderr: partial.stderr ?? "",
      exitCode: partial.exitCode ?? 0,
      signal: partial.signal ?? null,
    }));
    const handle: ProcessHandle = {
      result: resultPromise,
      writeStdin: () => {},
      endStdin: () => {},
      kill: (signal) => {
        killSignal = signal ?? "SIGTERM";
        killed.push(killSignal);
      },
    };
    void killSignal;
    return handle;
  };
  return { runner, killed };
}

function fs(files: Record<string, string> = {}): InMemoryFileSystem {
  const memfs = new InMemoryFileSystem();
  for (const [path, content] of Object.entries(files)) {
    void memfs.writeFile(path, new TextEncoder().encode(content));
  }
  return memfs;
}

describe("createWhisperCppRuntimeProvider", () => {
  it("isAvailable() reflects real binary existence on the injected filesystem", async () => {
    const withBinary = createWhisperCppRuntimeProvider({
      id: "whisper",
      binaryPath: "/opt/whisper/main",
      modelPathResolver: () => "/opt/whisper/model.bin",
      processRunner: fakeProcessRunner(async () => ({})).runner,
      fileSystem: fs({ "/opt/whisper/main": "binary" }),
    });
    await expect(withBinary.isAvailable()).resolves.toBe(true);

    const withoutBinary = createWhisperCppRuntimeProvider({
      id: "whisper",
      binaryPath: "/opt/whisper/main",
      modelPathResolver: () => "/opt/whisper/model.bin",
      processRunner: fakeProcessRunner(async () => ({})).runner,
      fileSystem: fs(),
    });
    await expect(withoutBinary.isAvailable()).resolves.toBe(false);
  });

  it("throws WhisperBinaryNotFoundError, honestly, rather than fabricating a transcript", async () => {
    const provider = createWhisperCppRuntimeProvider({
      id: "whisper",
      binaryPath: "/opt/whisper/main",
      modelPathResolver: () => "/opt/whisper/model.bin",
      processRunner: fakeProcessRunner(async () => ({})).runner,
      fileSystem: fs(),
    });
    await expect(
      provider.transcribe?.("whisper-base-en", { audioBytes: new Uint8Array([1, 2, 3]) }),
    ).rejects.toThrow(WhisperBinaryNotFoundError);
  });

  it("throws WhisperModelMissingError when the binary exists but the model file doesn't", async () => {
    const provider = createWhisperCppRuntimeProvider({
      id: "whisper",
      binaryPath: "/opt/whisper/main",
      modelPathResolver: () => "/opt/whisper/model.bin",
      processRunner: fakeProcessRunner(async () => ({})).runner,
      fileSystem: fs({ "/opt/whisper/main": "binary" }),
    });
    await expect(
      provider.transcribe?.("whisper-base-en", { audioBytes: new Uint8Array([1, 2, 3]) }),
    ).rejects.toThrow(WhisperModelMissingError);
  });

  it("writes a real WAV file, invokes the binary with real args, and reads the real .txt output", async () => {
    const memfs = fs({
      "/opt/whisper/main": "binary",
      "/opt/whisper/whisper-base-en.bin": "model",
    });
    let capturedArgs: readonly string[] = [];
    const { runner } = fakeProcessRunner(async (command, args) => {
      expect(command).toBe("/opt/whisper/main");
      capturedArgs = args;
      const outputFileIndex = args.indexOf("--output-file");
      const outputBase = args[outputFileIndex + 1] as string;
      await memfs.writeFile(`${outputBase}.txt`, new TextEncoder().encode("hello world\n"));
      return { exitCode: 0 };
    });

    const provider = createWhisperCppRuntimeProvider({
      id: "whisper",
      binaryPath: "/opt/whisper/main",
      modelPathResolver: (modelId) => `/opt/whisper/${modelId}.bin`,
      processRunner: runner,
      fileSystem: memfs,
    });

    const result = await provider.transcribe?.("whisper-base-en", {
      audioBytes: new Uint8Array([1, 2, 3, 4]),
      language: "en",
    });

    expect(result?.text).toBe("hello world");
    expect(capturedArgs).toContain("-m");
    expect(capturedArgs).toContain("/opt/whisper/whisper-base-en.bin");
    expect(capturedArgs).toContain("-l");
    expect(capturedArgs).toContain("en");
    expect(capturedArgs).toContain("--output-txt");
  });

  it("wraps raw PCM into a real, valid WAV container before writing it", async () => {
    const memfs = fs({ "/opt/whisper/main": "binary", "/opt/whisper/model.bin": "model" });
    let writtenWav: Uint8Array | undefined;
    const originalWrite = memfs.writeFile.bind(memfs);
    memfs.writeFile = async (path, data) => {
      if (path.endsWith(".wav")) writtenWav = data;
      return originalWrite(path, data);
    };

    const { runner } = fakeProcessRunner(async (_command, args) => {
      const outputFileIndex = args.indexOf("--output-file");
      const outputBase = args[outputFileIndex + 1] as string;
      await memfs.writeFile(`${outputBase}.txt`, new TextEncoder().encode("ok"));
      return { exitCode: 0 };
    });

    const provider = createWhisperCppRuntimeProvider({
      id: "whisper",
      binaryPath: "/opt/whisper/main",
      modelPathResolver: () => "/opt/whisper/model.bin",
      processRunner: runner,
      fileSystem: memfs,
    });

    await provider.transcribe?.("whisper-base-en", { audioBytes: new Uint8Array([1, 2, 3, 4]) });

    expect(writtenWav).toBeDefined();
    const view = new DataView(writtenWav!.buffer, writtenWav!.byteOffset, writtenWav!.byteLength);
    expect(
      String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)),
    ).toBe("RIFF");
    expect(
      String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)),
    ).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(16000); // sample rate
  });

  it("throws WhisperTranscriptionError with real stderr on a non-zero exit code", async () => {
    const memfs = fs({ "/opt/whisper/main": "binary", "/opt/whisper/model.bin": "model" });
    const { runner } = fakeProcessRunner(async () => ({
      exitCode: 1,
      stderr: "error loading model",
    }));
    const provider = createWhisperCppRuntimeProvider({
      id: "whisper",
      binaryPath: "/opt/whisper/main",
      modelPathResolver: () => "/opt/whisper/model.bin",
      processRunner: runner,
      fileSystem: memfs,
    });

    await expect(
      provider.transcribe?.("whisper-base-en", { audioBytes: new Uint8Array([1]) }),
    ).rejects.toThrow(WhisperTranscriptionError);
  });

  it("cancellation via AbortSignal kills the real process, not merely an internal flag", async () => {
    const memfs = fs({ "/opt/whisper/main": "binary", "/opt/whisper/model.bin": "model" });
    let resolveProcess: (() => void) | undefined;
    const { runner, killed } = fakeProcessRunner(
      () =>
        new Promise((resolve) => {
          resolveProcess = () => resolve({ exitCode: 1, signal: "SIGTERM" });
        }),
    );
    const provider = createWhisperCppRuntimeProvider({
      id: "whisper",
      binaryPath: "/opt/whisper/main",
      modelPathResolver: () => "/opt/whisper/model.bin",
      processRunner: runner,
      fileSystem: memfs,
    });

    const controller = new AbortController();
    const promise = provider.transcribe?.("whisper-base-en", {
      audioBytes: new Uint8Array([1]),
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
      const memfs = fs({ "/opt/whisper/main": "binary", "/opt/whisper/model.bin": "model" });
      let resolveProcess: (() => void) | undefined;
      const { runner, killed } = fakeProcessRunner(
        () =>
          new Promise((resolve) => {
            resolveProcess = () => resolve({ exitCode: 1, signal: "SIGTERM" });
          }),
      );
      const provider = createWhisperCppRuntimeProvider({
        id: "whisper",
        binaryPath: "/opt/whisper/main",
        modelPathResolver: () => "/opt/whisper/model.bin",
        processRunner: runner,
        fileSystem: memfs,
        timeoutMs: 100,
      });

      const promise = provider.transcribe?.("whisper-base-en", { audioBytes: new Uint8Array([1]) });
      const assertion = expect(promise).rejects.toThrow(WhisperTranscriptionError);
      await vi.advanceTimersByTimeAsync(150);
      resolveProcess?.();
      await assertion;
      expect(killed).toContain("SIGTERM");
    } finally {
      vi.useRealTimers();
    }
  });
});
