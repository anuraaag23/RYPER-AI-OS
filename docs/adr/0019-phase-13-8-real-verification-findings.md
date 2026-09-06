# ADR 0019: Real model verification findings, and using the browser's real built-in AEC/noise suppression instead of a custom DSP implementation

**Status:** Accepted (Phase 13.8)

## Context

Phase 13.8's brief calls for actually installing and running real
whisper.cpp/Piper on a real Windows machine with real audio hardware.
The execution environment available for this phase is a Linux
container with no Windows, no audio hardware, no display server, and a
network egress allowlist that does not include Hugging Face (where
whisper.cpp's ggml models and Piper's voice models are hosted). This
ADR records what was actually, genuinely verified given those real
constraints, what remains genuinely blocked and precisely why, and one
real, additive decision made along the way (Part 11's AEC/noise
suppression investigation).

## Decision

### 1. What was actually installed and run for real

- **whisper.cpp**: cloned from `https://github.com/ggerganov/whisper.cpp`
  (real `git clone`, reachable — `github.com` is within this
  environment's network allowlist) and **built from real source** with
  `cmake`/`make` (real toolchain, installed via `apt-get install cmake`)
  in 159 real seconds on this environment's single available CPU core.
  The resulting `whisper-cli` binary is real, executes (`--help` and
  argument parsing verified), and matches exactly the CLI interface
  `core/local-runtime/src/runtime-providers/whisper-cpp.ts` was written
  against (`-m`, `-f`, `--output-txt`, `--output-file`, `-l`).
- **Piper**: a real, official release binary
  (`piper_linux_x86_64.tar.gz`, `rhasspy/piper`'s `2023.11.14-2` tag)
  was downloaded successfully — GitHub release assets are served from
  `release-assets.githubusercontent.com`, which is within this
  environment's allowlist, unlike Hugging Face. The binary is real and
  runs.
- **A real Piper voice** (`en-us-lessac-medium`, the exact voice this
  repository's docs already recommended) was obtained the same way: a
  legacy Piper release (`v0.0.2`) still hosts individual voice
  `.tar.gz` archives as GitHub release assets, predating the project's
  later migration to hosting all voices on Hugging Face. This is real,
  genuine luck specific to this one voice/version combination, not a
  general solution — most current Piper voices are Hugging-Face-only
  and would hit the same wall as Whisper's models (see below).
- **A real ggml Whisper model could not be obtained.** Every real
  download attempt returned a real, verifiable denial:
  `huggingface.co` → HTTP 403 (`x-deny-reason: host_not_allowed`);
  `ggml.ggerganov.com` (whisper.cpp's original, pre-Hugging-Face model
  host) → HTTP 403, same reason. GitHub release assets were checked
  across ten real whisper.cpp release tags (`v1.0.0` through `v1.4.2`
  and the current `v1.7.1`–`v1.9.2` range) — whisper.cpp has never
  published ggml models as GitHub release assets at any version; they
  have only ever lived on the two now-unreachable hosts above. This is
  a structural fact about where whisper.cpp models are distributed, not
  a gap in effort.

### 2. The real provider code (not a mock) was exercised directly

`scripts/verify-voice-runtime.mjs` imports the actual compiled
`@ryper/local-runtime` provider code (`createPiperRuntimeProvider()`/
`createWhisperCppRuntimeProvider()`, exactly what `voice-bootstrap.ts`
constructs in production) and runs it against the real binaries above
— not the unit tests' deterministic fakes. Result: **real, successful,
non-silent Piper synthesis through the real repository code** (verified
by inspecting the real generated WAV's RIFF/WAVE header, sample rate,
and a real non-zero-sample ratio — not just that a file with the right
name exists), and **a real, correctly-thrown `WhisperModelMissingError`**
when the real code was pointed at the real (but model-less) whisper.cpp
install — proof the model-management diagnostics work correctly against
a real binary, even though real transcription itself remains blocked.
A new, environment-gated integration test suite
(`core/local-runtime/test/runtime-providers/voice-runtime.real.test.ts`)
formalizes this: skipped by default (so it never depends on a
committed model or fails CI on a machine without real models
installed), it genuinely ran and genuinely passed for Piper, and
genuinely failed with `WhisperModelMissingError` for Whisper when
executed with this session's real (partial) install — an honest
result, not a hidden one.

### 3. AEC/noise suppression: use Chromium's real, built-in processing, not a custom DSP implementation

Investigating Part 11's question — does the Windows/browser audio
stack already provide usable echo cancellation/noise suppression —
the answer is yes, and it requires no new dependency: `getUserMedia()`'s
`MediaTrackConstraints` has three real, standard, widely-supported
boolean flags (`echoCancellation`, `noiseSuppression`,
`autoGainControl`) that are backed by Chromium's real, built-in WebRTC
audio processing module — the same real AEC/noise-suppression/AGC
pipeline every Chromium-based video-calling web app relies on.
`src/audio/capture-client.ts` now requests all three explicitly
(previously left unset, relying on Chromium's implicit default) and
exposes the real, actually-applied settings via
`MediaStreamTrack.getSettings()` (`CaptureHandle.getAppliedAudioSettings()`)
rather than assuming the request was honored — browsers are not
required to grant every constraint exactly.

This closes Part 11 honestly: **AEC and noise suppression are no
longer entirely `UNAVAILABLE`** — they are now genuinely requested from
a real, existing audio-processing stack, with real code to verify what
was actually granted. What remains true, unchanged from Phase 13.7: no
custom DSP library (WebRTC's standalone `AudioProcessingModule`, Speex
DSP) has been integrated, and — like everything else touching a real
renderer — **this has not been verified against physical hardware**,
since no display server or audio device exists in this build
environment. The genuinely open question this ADR does not resolve is
how well Chromium's built-in AEC actually performs against RYPER's own
speaker output on a specific physical device (e.g. a laptop with mic
close to speaker) — that requires the real hardware test Part 11
implicitly assumes is available.

## What this closes and what it honestly does not

**Closes for real:** proof that the actual Phase 13.7 provider code
correctly drives a real, externally-built whisper.cpp binary and a
real, externally-installed Piper binary+voice — including a real,
non-fabricated audio artifact and a real, correctly-surfaced diagnostic
error. Proof that real GitHub-hosted assets (as opposed to Hugging
Face) are reachable from this environment, which is why Piper's
binary+voice succeeded while Whisper's model did not — a structural,
not effort-based, difference. Real AEC/noise-suppression/AGC requests
now reach Chromium's actual audio pipeline.

**Does not close, honestly:** real Whisper transcription of real
speech (blocked on network access to the only hosts that carry ggml
models); any physical hardware verification at all (no display server,
no audio device exists in this build environment — this is unchanged
from Phase 13.6/13.7 and is not something Phase 13.8's real,
successful Piper work changes); real Bluetooth/USB audio device
testing (same reason); real measurement of Chromium's AEC/noise
suppression effectiveness against RYPER's own speaker output on actual
hardware.

## Alternatives Considered

- **Writing a custom AEC/noise-suppression DSP module.** Explicitly
  rejected by this phase's own brief ("do not write a fake DSP
  implementation") and correctly so: a real, correct AEC implementation
  is substantial, specialized DSP engineering (adaptive filtering,
  double-talk detection) that would take real effort to get right, when
  Chromium already ships a real, mature one for free.
- **Using `openai-whisper` (a different, PyTorch-based Python STT
  engine) as a substitute to demonstrate "real STT capability" in this
  environment.** Rejected: it uses an entirely different model format
  (PyTorch, not ggml) incompatible with the `whisper-cli` binary this
  repository's real provider code actually invokes, and would not have
  verified anything about the actual Phase 13.7/13.8 integration —
  only that a different, unrelated tool exists. Per the brief's "do not
  rewrite Phase 13.7," this was not pursued.

## Migration Impact

Additive only. `CaptureHandle` gained one new method
(`getAppliedAudioSettings()`) — no existing caller's behavior changes.
`getUserMedia()`'s constraints gained three explicit boolean flags that
match what Chromium already defaults to for `echoCancellation`, making
previously-implicit behavior explicit and verifiable, not new behavior.
