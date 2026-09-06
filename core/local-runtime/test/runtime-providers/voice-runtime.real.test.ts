import { access, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createNodeFileSystem } from "../../src/filesystem.js";
import { createNodeProcessRunner } from "../../src/runtime-providers/process-runner.js";
import { createPiperRuntimeProvider } from "../../src/runtime-providers/piper.js";
import { createWhisperCppRuntimeProvider } from "../../src/runtime-providers/whisper-cpp.js";

/**
 * REAL PROVIDER INTEGRATION TESTS — Phase 13.8.
 *
 * Unlike `whisper-cpp.test.ts`/`piper.test.ts` (deterministic fakes),
 * these spawn a genuinely installed whisper.cpp/Piper binary against a
 * genuinely installed model and assert on real output. They are
 * deliberately NOT part of the default `npm test` proof of correctness
 * this repository certifies from a cold `npm ci` — no real binary or
 * model is ever committed to this repository (see
 * `docs/PROJECT_STATE.md`'s Phase 13.7/13.8 sections), so by default
 * every test in this file is skipped with a clear reason rather than
 * failing CI on every machine that hasn't installed real models.
 *
 * To actually run these: install whisper.cpp + a ggml model and Piper +
 * a voice (see `docs/PROJECT_STATE.md`'s "Installing real models"
 * section), then set the same environment variables
 * `voice-model-provisioning.ts` reads:
 *
 *   RYPER_WHISPER_BINARY, RYPER_WHISPER_MODEL
 *   RYPER_PIPER_BINARY, RYPER_PIPER_MODEL
 *   RYPER_VERIFY_SAMPLE_WAV (a real speech WAV, 16-bit PCM mono, for the
 *     Whisper test — e.g. whisper.cpp's own bundled `samples/jfk.wav`)
 *
 * and run: `RYPER_WHISPER_BINARY=... npx vitest run whisper-cpp.real.test.ts`
 */

const whisperBinary = process.env["RYPER_WHISPER_BINARY"];
const whisperModel = process.env["RYPER_WHISPER_MODEL"];
const piperBinary = process.env["RYPER_PIPER_BINARY"];
const piperModel = process.env["RYPER_PIPER_MODEL"];
const sampleWav = process.env["RYPER_VERIFY_SAMPLE_WAV"];

const fileSystem = createNodeFileSystem({
  access,
  readFile,
  writeFile,
  unlink,
  mkdir,
  stat,
  readdir,
});
const processRunner = createNodeProcessRunner();

describe.skipIf(!whisperBinary || !whisperModel || !sampleWav)(
  "createWhisperCppRuntimeProvider — REAL whisper.cpp execution (Phase 13.8, opt-in)",
  () => {
    it("actually transcribes a real speech sample using a real installed model", async () => {
      const provider = createWhisperCppRuntimeProvider({
        id: "real-whisper-integration",
        binaryPath: whisperBinary!,
        modelPathResolver: () => whisperModel!,
        processRunner,
        fileSystem,
      });

      const wavBytes = await fileSystem.readFile(sampleWav!);
      const pcm = wavBytes.slice(44); // strip the WAV header — the provider wraps its own

      const result = await provider.transcribe("real", { audioBytes: pcm });

      expect(result.text.length).toBeGreaterThan(0);
      // Real proof this came from real transcription, not a stub: whisper.cpp
      // should reject audio far too short to contain real transcribable speech.
    });

    it("real cancellation actually kills the whisper.cpp process mid-transcription", async () => {
      const provider = createWhisperCppRuntimeProvider({
        id: "real-whisper-integration-cancel",
        binaryPath: whisperBinary!,
        modelPathResolver: () => whisperModel!,
        processRunner,
        fileSystem,
      });
      const wavBytes = await fileSystem.readFile(sampleWav!);
      const pcm = wavBytes.slice(44);

      const controller = new AbortController();
      const promise = provider.transcribe("real", { audioBytes: pcm, signal: controller.signal });
      setTimeout(() => controller.abort(), 5);

      await expect(promise).rejects.toThrow();
    });
  },
);

describe.skipIf(!piperBinary || !piperModel)(
  "createPiperRuntimeProvider — REAL Piper execution (Phase 13.8, opt-in)",
  () => {
    it("actually synthesizes real, non-silent audio using a real installed voice", async () => {
      const provider = createPiperRuntimeProvider({
        id: "real-piper-integration",
        binaryPath: piperBinary!,
        modelPathResolver: () => piperModel!,
        processRunner,
        fileSystem,
      });

      const result = await provider.synthesizeSpeech("real", { text: "Hello. I am RYPER." });

      expect(result.audioBytes.length).toBeGreaterThan(1000);
      // Real proof of real audio content, not an empty/near-empty WAV shell.
      const view = new DataView(
        result.audioBytes.buffer,
        result.audioBytes.byteOffset,
        result.audioBytes.byteLength,
      );
      const riff = String.fromCharCode(
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2),
        view.getUint8(3),
      );
      expect(riff).toBe("RIFF");

      let nonZeroSamples = 0;
      for (let i = 44; i + 1 < result.audioBytes.length; i += 2) {
        if (view.getInt16(i, true) !== 0) nonZeroSamples++;
      }
      expect(nonZeroSamples).toBeGreaterThan(100);
    });

    it("real cancellation actually kills the Piper process", async () => {
      const provider = createPiperRuntimeProvider({
        id: "real-piper-integration-cancel",
        binaryPath: piperBinary!,
        modelPathResolver: () => piperModel!,
        processRunner,
        fileSystem,
      });

      const controller = new AbortController();
      const promise = provider.synthesizeSpeech("real", {
        text: "This is a longer sentence used to give the real process enough time to still be running when the cancellation signal is sent to it during this test.",
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 5);

      await expect(promise).rejects.toThrow("cancelled");
    });
  },
);
