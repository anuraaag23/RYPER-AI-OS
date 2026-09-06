# ADR 0018: Real local STT/TTS as CLI-invoked child processes, sentence-chunked TTS, and monitor-based automatic barge-in

**Status:** Accepted (Phase 13.7)

## Context

Phase 13.6 closed the real-audio-I/O seam (`UnavailableAudioBridge` →
`RendererAudioBridge`). Two named seams remained: `ReferenceVoiceRuntimeProvider`
(no real STT/TTS model anywhere in this repository) and
`HeuristicToolCallingProvider` (not a language model, unchanged and out
of scope this phase). Phase 13.7's brief is to close the STT/TTS seam
with real local Whisper/Piper integration, real sentence-level TTS
chunking, and mandatory automatic barge-in.

Three real architectural questions had to be answered:

1. **How does a real local Whisper/Piper model actually get invoked
   from Node?** No native Node bindings for either are already present
   in this repository, and building one would require a native
   compiler toolchain this repository doesn't otherwise use anywhere.
2. **How does an already-complete AI response get spoken without
   waiting for the whole thing to synthesize as one blocking call?**
3. **How does RYPER stop talking the instant the user starts talking,
   without a "stop" button?**

## Decision

### 1. Whisper.cpp and Piper are invoked as real, external CLI child processes

`core/local-runtime/src/runtime-providers/{whisper-cpp,piper}.ts`
implement `@ryper/local-runtime`'s existing `LocalRuntimeProvider`
interface (Phase 4) by spawning the real, standalone whisper.cpp and
Piper CLI binaries via a new, injectable `ProcessRunner` abstraction
(`process-runner.ts`) — the same dependency-injection convention this
repository already uses for `HttpFetch`/`FileSystemLike`/`OnnxSessionLoader`.
This was chosen over a native Node addon because:

- Both projects ship real, maintained standalone CLI binaries — this is
  their primary, most-supported integration path, not a workaround.
- No native build toolchain (node-gyp, cmake, a C++ compiler pinned to
  the right ABI) needs to be introduced into this repository's tooling
  just for two optional, swappable runtime providers.
- Cancellation is real and simple: killing a child process (`SIGTERM`)
  is a genuine, immediate stop — a native binding would need its own,
  separate cancellation mechanism, likely non-trivial to build.

Whisper's CLI reads a WAV file and writes text; the provider wraps the
16-bit PCM `AudioFrame`s the (Phase 13.6) audio bridge already produces
into a real, minimal WAV container before invoking it. Piper's CLI
reads text on stdin and writes a WAV file; the provider does exactly
that and returns the bytes as a `TtsAudioChunk` with `mimeType: "audio/wav"` —
the same shape `SpeakerManager`/`RendererAudioBridge` (Phase 13.6)
already know how to play, unmodified.

Real, on-disk model/binary detection (`platform/desktop-app/electron/
voice-model-provisioning.ts`) determines whether these real providers
are actually usable, and registers them into `@ryper/local-runtime`'s
existing `ModelRegistry`/`LocalRuntimeManager` fallback chain (Phase 4,
unmodified) ahead of the honest `ReferenceVoiceRuntimeProvider`
fallback — which itself is now, for the first time, _always_
registered and installed (see the bugfix below), so a working
placeholder path exists even with nothing real installed.

### 2. A real, pre-existing bug is fixed: nothing was ever registered into `ModelRegistry`

Investigating the existing code before writing anything new (per this
phase's mandatory first step) surfaced a real bug: `voice-bootstrap.ts`
never called `ModelRegistry.addToCatalog()`/`markInstalled()` for
_any_ model — meaning `ModelSelector.selectRanked({ installedOnly: true })`
(the default) always returned an empty candidate list, and every
STT/TTS call threw `MissingModelError` before `ReferenceVoiceRuntimeProvider`
was ever reached. This predates Phase 13.7 and was not introduced by
it, but closing the STT/TTS seam requires fixing it: `voice-model-provisioning.ts`
now always registers a reference-model catalog entry (needs no real
file, always "installed") with a deliberately enormous
`approxDiskBytes` so the default (smallest-first) selection policy
always prefers a real, present Whisper/Piper model when one exists,
falling back to the reference entry otherwise — turning "voice
unavailable" into "Whisper provider installed but model missing," per
the brief's explicit diagnostic-quality requirement.

### 3. Sentence-level TTS chunking, reusing Phase 13.6's existing streaming playback unchanged

`core/voice-engine/src/tts/sentence-splitter.ts` is a pure,
dependency-free sentence splitter (handles common abbreviations and
decimal numbers, merges very-short sentences to avoid tiny synthesis
calls). `LocalSpeechSynthesisProvider.synthesizeStream()` now splits
the full AI response into sentence-sized pieces and synthesizes/yields
them one at a time. No change was needed to `SpeakerManager.play()` or
`RendererAudioBridge.play()` (Phase 13.6): both already pull chunks via
`for await` and schedule each for gapless playback as soon as it
arrives, so the first sentence starts playing while later sentences are
still being synthesized — real pipelining, achieved entirely by
changing what the _producer_ yields. This is explicitly **not**
token-level AI streaming (the full response text is already in hand
before this runs) and is never described as such, per the brief's
explicit instruction.

### 4. Automatic barge-in via a concurrent VAD monitor during playback

`VoicePipeline.speak()` (`platform/desktop-app/electron/voice-pipeline.ts`)
now starts a concurrent barge-in monitor alongside `speakerManager.play()`,
reusing the pipeline's existing `endpointedFrames()` generator (same
VAD, same endpointing logic `captureAndRecognize()` already uses — not
a second implementation). The monitor's _first yielded frame_ is, by
construction, the first real detected speech frame — at that instant,
`interrupt()` is called immediately (before waiting for the rest of the
utterance or running STT on it), which is what makes "RYPER must NOT
continue speaking over the user" real rather than approximate: the real
`AudioBufferSourceNode` stop (Phase 13.6) fires within one VAD-frame's
latency of the user's first sound, not after a full utterance is
buffered. The monitor then keeps capturing/endpointing to transcribe
the full interrupting utterance, and `runTurn()` returns a `bargeIn`
result the caller (`main.ts`) uses to immediately continue the
conversation with the interrupting transcript — skipping a redundant
re-listen phase — bounded to 3 automatic continuations per voice-turn
request to prevent a runaway loop from a VAD misdetection.

## What this closes and what it honestly does not

**Closes for real:** a real, working, swappable local STT/TTS provider
architecture; the pre-existing model-registration bug; real
sentence-level TTS pipelining; real, automatic (no button) barge-in
that stops the actual audio device within one VAD frame of detected
speech and preserves the interrupting utterance for the next turn.

**Does not close, honestly:**

- **No real model execution has been verified.** Whisper's ggml models
  and Piper's voice `.onnx` files are hosted on Hugging Face, which is
  outside this build environment's network allowlist — this was true
  before any code was written and does not change based on how good the
  integration code is. `docs/PROJECT_STATE.md`'s Phase 13.7 section
  gives exact manual installation instructions; every provider file has
  full test coverage against deterministic fakes, and `process-runner.ts`
  additionally has tests that spawn genuine OS processes — but no test
  in this repository spawns a real whisper.cpp or Piper binary, because
  neither is installed here.
- **AEC (acoustic echo cancellation) and real noise suppression are not
  implemented.** `EnergyVoiceActivityDetector` (Phase 13.5) is a simple
  RMS-energy VAD; it is not an echo canceller. Real AEC needs a real DSP
  library (e.g. WebRTC's `AudioProcessingModule`, or Speex DSP) that
  does not exist anywhere in this repository, and integrating one is
  real, substantial, separate work this phase did not undertake. In
  practice this means the barge-in monitor's microphone stream can pick
  up RYPER's own voice from the speaker as "user speech" on hardware
  without a physically/acoustically separated mic and speaker (e.g. a
  laptop's built-in mic close to its built-in speaker) — a real,
  user-visible limitation, stated here rather than hidden.
- **No physical hardware has been exercised**, unchanged from Phase
  13.6 — no display server, no audio hardware in this build
  environment.
- **Device-failure automatic fallback** (auto-selecting a different
  microphone/speaker mid-turn if the active one disconnects) is not
  implemented this phase — Phase 13.6's disconnect _detection_ remains
  real and unchanged (a clear error surfaces, RYPER does not crash), but
  there is no automatic re-routing to a different device.

## Alternatives Considered

- **A native Node addon for whisper.cpp (e.g. an N-API binding) instead
  of a CLI child process.** Rejected: no native build toolchain exists
  in this repository's tooling, and introducing one for two optional
  providers is a real, disproportionate cost. A CLI child process is
  whisper.cpp's own most-supported, most-portable integration path.
- **A single, un-chunked TTS call with client-side sentence splitting
  at playback time (splitting the audio, not the text).** Rejected:
  splitting already-synthesized audio can't move the first sentence's
  _synthesis_ earlier — the whole point is starting playback before the
  rest of the response has even been synthesized, which requires
  chunking the input text before the synthesis calls, not the output
  audio after.
- **Barge-in via a fixed "always listening" background wake-word-style
  stream, independent of the SPEAKING stage.** Rejected as broader scope
  than this phase needs: the mandatory requirement is specifically that
  RYPER stop speaking when interrupted _while speaking_ — a monitor
  scoped to exactly the SPEAKING stage (reusing existing capture/VAD
  machinery) satisfies that directly, without introducing a second,
  continuously-running capture pathway that would need its own
  wake-word/false-positive handling.

## Tradeoffs

- The barge-in monitor and the primary STT capture never run
  concurrently with each other (they're strictly sequential — STT
  capture always finishes before `speak()` starts), so there's no
  device-contention risk from `MicrophoneManager`'s single-active-capture
  constraint. But this also means barge-in detection only starts once
  RYPER begins speaking, not a fraction of a second earlier — an
  acceptable, real tradeoff given the requirement is specifically about
  interrupting _speech_, not detecting speech before RYPER starts.
- Whisper/Piper CLI invocation has real per-call process-startup
  latency (loading the model fresh on every single call, since no
  persistent server process is kept running) — a real, honest
  performance cost of the CLI-child-process approach versus a
  long-lived native binding or local server process. Not measured in
  this environment (§20 of the certification report) since no real
  binary is installed here to measure.

## Migration Impact

Additive only. `@ryper/local-runtime`'s `LocalRuntimeProvider`
interface, `ASRRequest`/`TTSRequest` (gained optional `language`/`signal`
fields), and `RuntimeKind` (gained `"whisper-cpp"`/`"piper"`) are
backward compatible — every existing provider (`llama-cpp`, `ollama`,
`onnx`, `mlx`) is unaffected. `bootstrapVoice()` is now `async`
(previously synchronous) — every call site in this repository was
updated; any external caller would need the same one-line `await` added.
`VoicePipeline.runTurn()` gained an optional `presetTranscript`
parameter and its result gained an optional `bargeIn` field — both
additive.
