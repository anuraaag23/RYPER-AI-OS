#!/usr/bin/env node
/**
 * Phase 13.8 real-model verification script.
 *
 * Imports the ACTUAL compiled `@ryper/local-runtime` provider code (not a
 * test double) and runs it against a real, externally-installed
 * whisper.cpp/Piper install, producing a JSON report of what genuinely
 * executed. This is the script used to produce the results in
 * `docs/reports/PHASE_13_8_CERTIFICATION_REPORT.md` — re-run it on any
 * machine with real binaries/models installed to reproduce or extend
 * that verification.
 *
 * Usage:
 *   node --experimental-vm-modules scripts/verify-voice-runtime.mjs
 *
 * Configuration (all optional, same env vars `voice-model-provisioning.ts`
 * reads):
 *   RYPER_WHISPER_BINARY, RYPER_WHISPER_MODEL, RYPER_WHISPER_LANGUAGE
 *   RYPER_PIPER_BINARY, RYPER_PIPER_MODEL
 *   RYPER_VERIFY_SAMPLE_WAV   — a real speech WAV file for the Whisper
 *                               direct test (16-bit PCM mono; the
 *                               classic whisper.cpp `samples/jfk.wav` is
 *                               a good, freely available choice)
 *   RYPER_VERIFY_OUTPUT_DIR   — where to write generated audio for manual
 *                               playback verification (default: os.tmpdir())
 *
 * This script never invents a result: every field is either a real
 * measurement/error from a real process, or explicitly `null`/an error
 * object explaining what's missing. Run `npm run build` first so
 * `core/local-runtime/dist` is up to date.
 */
import { access, readFile, writeFile, unlink, mkdir, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeFileSystem } from "../core/local-runtime/dist/filesystem.js";
import { createNodeProcessRunner } from "../core/local-runtime/dist/runtime-providers/process-runner.js";
import { createPiperRuntimeProvider } from "../core/local-runtime/dist/runtime-providers/piper.js";
import { createWhisperCppRuntimeProvider } from "../core/local-runtime/dist/runtime-providers/whisper-cpp.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(__dirname, "..");

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

const outputDir = process.env["RYPER_VERIFY_OUTPUT_DIR"] ?? tmpdir();
const whisperBinary =
  process.env["RYPER_WHISPER_BINARY"] ??
  join(repoRoot, "..", "whisper.cpp", "build", "bin", "whisper-cli");
const whisperModel =
  process.env["RYPER_WHISPER_MODEL"] ??
  join(repoRoot, "..", "whisper.cpp", "models", "ggml-base.en.bin");
const piperBinary =
  process.env["RYPER_PIPER_BINARY"] ?? join(repoRoot, "..", "piper-bin", "piper", "piper");
const piperModel =
  process.env["RYPER_PIPER_MODEL"] ??
  join(repoRoot, "..", "piper-voice", "en-us-lessac-medium.onnx");
const sampleWav = process.env["RYPER_VERIFY_SAMPLE_WAV"];

async function errorOf(promise) {
  try {
    const value = await promise;
    return { ok: true, value };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
    };
  }
}

async function main() {
  const report = { ranAt: new Date().toISOString(), whisper: {}, piper: {} };

  // ---- Whisper: availability + real transcription if a real sample WAV was given ----
  const whisperProvider = createWhisperCppRuntimeProvider({
    id: "verify-whisper",
    binaryPath: whisperBinary,
    modelPathResolver: () => whisperModel,
    processRunner,
    fileSystem,
  });
  report.whisper.binaryPath = whisperBinary;
  report.whisper.modelPath = whisperModel;
  report.whisper.binaryAvailable = await whisperProvider.isAvailable();
  report.whisper.modelFileExists = await fileSystem.exists(whisperModel);

  if (sampleWav) {
    const wavBytes = await fileSystem.readFile(sampleWav);
    // Strip the 44-byte WAV header — the provider expects raw PCM and
    // wraps its own header (matching what MicrophoneManager delivers).
    const pcm = wavBytes.slice(44);
    const start = Date.now();
    const result = await errorOf(whisperProvider.transcribe("verify", { audioBytes: pcm }));
    report.whisper.directTranscriptionTest = {
      sampleWav,
      elapsedMs: Date.now() - start,
      ...result,
    };
  } else {
    report.whisper.directTranscriptionTest = {
      skipped: true,
      reason: "RYPER_VERIFY_SAMPLE_WAV not set — no real speech sample provided",
    };
  }

  // ---- Piper: availability + real synthesis ----
  const piperProvider = createPiperRuntimeProvider({
    id: "verify-piper",
    binaryPath: piperBinary,
    modelPathResolver: () => piperModel,
    processRunner,
    fileSystem,
  });
  report.piper.binaryPath = piperBinary;
  report.piper.modelPath = piperModel;
  report.piper.binaryAvailable = await piperProvider.isAvailable();
  report.piper.modelFileExists = await fileSystem.exists(piperModel);

  const start = Date.now();
  const synth = await errorOf(
    piperProvider.synthesizeSpeech("verify", { text: "Hello. I am RYPER." }),
  );
  report.piper.directSynthesisTest = { elapsedMs: Date.now() - start, ...synth };

  if (synth.ok) {
    const outPath = join(outputDir, "ryper-verify-piper-output.wav");
    await fileSystem.writeFile(outPath, synth.value.audioBytes);
    report.piper.directSynthesisTest.writtenTo = outPath;
    report.piper.directSynthesisTest.audioBytesLength = synth.value.audioBytes.length;
    delete report.piper.directSynthesisTest.value; // don't dump raw audio bytes into the JSON report
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error("verification script failed:", err);
  process.exitCode = 1;
});
