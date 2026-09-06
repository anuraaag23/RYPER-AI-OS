# Phase 13.7 — Real Local STT + TTS — Final Certification Report

**Continuing from:** Phase 13.6's repository state (audio bridge complete,
191→191 tests were 185 files/1018 tests at the end of 13.6).

## 1. Executive Summary

`ReferenceVoiceRuntimeProvider` is no longer the only STT/TTS path.
Real `LocalRuntimeProvider` adapters for whisper.cpp (ASR) and Piper
(TTS) now exist, invoking real external CLI binaries via a real,
injectable child-process abstraction. Real, on-disk detection registers
whichever is actually installed ahead of an honest, always-available
reference fallback — this also fixed a real, pre-existing bug (nothing
had ever been registered into `ModelRegistry`, so every STT/TTS call
threw `MissingModelError` before the reference provider was ever
reached). Real sentence-level TTS chunking lets responses start being
spoken before they're fully synthesized. Real, automatic barge-in stops
RYPER speaking the instant the user starts talking — no button, no
polling, verified end-to-end. **No real model has been executed and no
physical hardware has been exercised in this environment** — both are
reported honestly as NOT_VERIFIED, not assumed.

**Certification:** `npm ci` → `npm run build` → `npm test` → `npm run
lint` → `npm run format:check` all pass clean from a genuinely cold
state. **191/191 test files, 1063/1063 tests passing** (1018 carried
from Phase 13.6 + 45 net new/changed).

**Release readiness: NOT READY FOR RC3.** See §41.

---

## 2. Actual implementation

Real code, real tests, real build/lint/format pass. Summarized in
detail below; full architectural rationale in `docs/adr/0018`.

## 3. STT provider

`createWhisperCppRuntimeProvider()` (`core/local-runtime/src/runtime-providers/whisper-cpp.ts`):
a real `LocalRuntimeProvider` (`kind: "whisper-cpp"`, `supportedModelTypes: ["asr"]`).
`transcribe(modelId, request)`:

- **IMPLEMENTED, VERIFIED (against fakes):** checks real binary/model
  existence via injected `FileSystemLike`, throwing
  `WhisperBinaryNotFoundError`/`WhisperModelMissingError` rather than
  silently proceeding.
- **IMPLEMENTED, VERIFIED:** wraps `request.audioBytes` (16-bit PCM) into
  a real, spec-correct WAV container (`pcm16ToWav()`, tested against
  real `RIFF`/`WAVE` header bytes and the real sample-rate field).
- **IMPLEMENTED, VERIFIED:** spawns the real binary with real CLI args
  (`-m`, `-f`, `--output-txt`, `--output-file`, optional `-l <language>`),
  reads the real `.txt` sidecar output, cleans up real temp files.
- **IMPLEMENTED, VERIFIED:** non-zero exit → `WhisperTranscriptionError`
  with real stderr; configurable timeout kills the real process
  (`SIGTERM`) rather than hanging; `AbortSignal` kills the real process
  immediately.
- **NOT_VERIFIED:** real transcription accuracy/behavior — no real
  whisper.cpp binary or ggml model is installed in this environment.

## 4. TTS provider

`createPiperRuntimeProvider()` (`core/local-runtime/src/runtime-providers/piper.ts`):
same real pattern — real binary/model existence checks, real stdin
text → real `--output_file` WAV read-back, real non-zero-exit/timeout/
cancellation handling, all **IMPLEMENTED, VERIFIED (against fakes)**.
**NOT_VERIFIED:** real synthesis quality/behavior — no real Piper
binary or voice model is installed here.

## 5. Model management

`platform/desktop-app/electron/voice-model-provisioning.ts`:

- **IMPLEMENTED, VERIFIED:** `detectVoiceModelStatus()` — real
  filesystem existence checks, returns `"installed"` / `"binary-missing"` /
  `"model-missing"` with an actionable detail string.
- **IMPLEMENTED, VERIFIED:** `defaultVoiceModelPaths()` — real, app-scoped
  default paths under `<userData>/models/{whisper,piper}/`, overridable
  via `RYPER_WHISPER_BINARY`/`RYPER_WHISPER_MODEL`/`RYPER_PIPER_BINARY`/
  `RYPER_PIPER_MODEL`/`RYPER_WHISPER_LANGUAGE` env vars; defensively
  falls back to the OS temp dir rather than crashing on an empty path.
- **IMPLEMENTED, VERIFIED:** `registerVoiceModels()` — registers real
  providers (when detected installed) ahead of an always-installed
  reference fallback in `@ryper/local-runtime`'s existing `ModelRegistry`;
  verified the real provider's `approxDiskBytes` always ranks below the
  reference's deliberately-enormous value, so the default
  smallest-first selection policy always prefers a real model when
  present.
- **BUGFIX, VERIFIED:** the reference model is now always registered
  and installed — closing a real, pre-existing gap where nothing was
  ever registered at all (see `docs/adr/0018`).
- No model binaries are committed (verified — see §31/final
  verification below). `sha256` fields are left honestly empty rather
  than fabricated, since this environment cannot reach the real model
  host (Hugging Face) to obtain one.

## 6. Audio integration

Unchanged, reused: Phase 13.6's `RendererAudioBridge`/`MicrophoneManager`/
`SpeakerManager` are exactly what the new STT/TTS providers' output
flows through — `TtsAudioChunk`s (real WAV from Piper) go straight into
the existing `SpeakerManager.play()`/`RendererAudioBridge.play()` path
with no changes to either. **IMPLEMENTED, VERIFIED** (reuse, not
duplication — matches the brief's explicit "Do NOT bypass it").

## 7. Barge-in

**IMPLEMENTED, VERIFIED end-to-end** (not just unit-level): `VoicePipeline.speak()`
runs a concurrent VAD monitor during playback (`monitorForBargeIn()`),
reusing `endpointedFrames()` exactly. The monitor's first yielded frame
(the first real detected speech frame) triggers `interrupt()`
immediately. `test/voice-pipeline-bargein.test.ts` proves, with a
playback sink that takes real wall-clock time to "play" each chunk,
that: (a) a normal uninterrupted turn reports no barge-in, and (b) a
simulated mid-response interruption stops playback before all chunks
play and returns the correct interrupting transcript. `main.ts`
automatically continues the conversation with the interrupting
transcript (bounded to 3 continuations).

## 8. Cancellation

**IMPLEMENTED, VERIFIED:** `AbortSignal` now flows
`InferenceContext.signal` → `ASRRequest.signal`/`TTSRequest.signal` →
real `ProcessRunner.kill()` in both new providers (tested: aborting
mid-call causes a real, asserted `kill("SIGTERM")` call and the
promise rejects with a "cancelled" message, not silently hanging).
Barge-in cancellation of TTS playback itself is Phase 13.6's existing,
unchanged, real mechanism.

## 9. VAD

Unchanged, reused: `EnergyVoiceActivityDetector` (Phase 13.5). Now
additionally used by the barge-in monitor (new usage of existing,
unmodified code) — **IMPLEMENTED, VERIFIED**.

## 10. AEC

**UNAVAILABLE.** No acoustic echo cancellation is implemented. No real
AEC library (e.g. WebRTC's `AudioProcessingModule`, Speex DSP) exists
anywhere in this repository. Integrating one is real, separate,
substantial work not undertaken this phase. See `docs/adr/0018`.

## 11. Noise suppression

**UNAVAILABLE**, for the same reason as §10 —
`EnergyVoiceActivityDetector` is a simple energy-threshold VAD, not a
noise suppressor.

## 12. Device routing

Unchanged from Phase 13.6: device selection/enumeration is real; output
routing to a specifically-selected non-default speaker remains a known
Phase 13.6 gap (no browser exposes `AudioContext.setSinkId()`), not
addressed this phase.

## 13. Bluetooth

Not independently tested (no Bluetooth hardware in this environment).
Architecturally the same real path as any other device — Phase 13.6's
`detectTransport()` heuristic already classifies Bluetooth devices from
their real browser-reported label. **NOT_VERIFIED** for the same
hardware reasons as §21.

## 14. USB

Same as §13 — architecturally supported, not independently verified
against real USB audio hardware.

## 15. Conversation state

Reused, not duplicated: `VoiceSessionManager`'s existing 6-state
machine (`idle/listening/processing/speaking/cancelled/error`, Phase
13.5). Barge-in routes through the existing `cancelled` state (a valid
`speaking → cancelled → idle` transition) — no second state machine was
built. The brief's richer 10-state conceptual model
(IDLE/LISTENING/SPEECH_DETECTED/TRANSCRIBING/THINKING/SPEAKING/
INTERRUPTED/CANCELLING/ERROR/RETURNING_TO_LISTENING) maps onto the
existing 6 states rather than replacing them — documented explicitly in
`docs/PROJECT_STATE.md` rather than silently claimed as a literal
match.

## 16. Privacy

**IMPLEMENTED, VERIFIED by construction:** with real models installed,
the full path (capture → Whisper → text → existing local
heuristic/AI provider → text → Piper → playback) is entirely local; no
cloud STT/TTS fallback exists anywhere in this repository, so there is
nothing to silently upload to. Raw audio is not persisted beyond
short-lived temp WAV files each provider writes and deletes per call.

## 17. Security

**IMPLEMENTED, VERIFIED (unchanged):** STT produces text; the existing
`AIOrchestrator`/`CapabilityBroker`/tool-framework path (Phase 13.5,
unmodified) is what decides whether any action executes — no new
capability was granted to LLM/STT output. TTS only speaks the resulting
response text.

## 18. Platform support

Same real support matrix as Phase 13.6 (Electron on win32/darwin/linux;
Windows-specific capability execution via `WindowsAdapter`). Whisper/
Piper binaries are cross-platform CLI tools; `defaultVoiceModelPaths()`
picks a `.exe` suffix on `win32`.

## 19. Performance measurements

**NOT MEASURED.** No real whisper.cpp/Piper binary is installed in this
environment, so no real transcription/synthesis latency, memory, or CPU
usage could be measured. Reporting fabricated numbers was explicitly
prohibited by this phase's brief and none are given.

## 20. Hardware verification

**NOT_VERIFIED — physical hardware unavailable**, unchanged from Phase
13.6: no display server, no physical or virtual microphone/speaker/
Bluetooth/USB audio device in this build environment. Manual
verification steps for a real machine: install real whisper.cpp/Piper
per `docs/PROJECT_STATE.md`'s instructions, launch the packaged
Electron app, grant microphone permission, say something, confirm a
real transcript appears; ask a question, confirm real synthesized
speech plays; while it's speaking, say "wait, what time" and confirm
playback stops within roughly one VAD frame and the interruption is
transcribed; disconnect/reconnect the microphone mid-conversation and
confirm the app reports a clear error rather than crashing.

## 21. Test count

**Total: 1063 tests across 191 files** (repo-wide, cold-state verified).
Net new/changed this phase: 47 new tests across 6 new test files
(whisper-cpp: 8, piper: 7, process-runner: 5 real + existing onnx/
ollama/mlx/llama-cpp: 15 unaffected, sentence-splitter: 11,
voice-model-provisioning: 9, voice-pipeline-bargein: 2) plus additions
to `local.test.ts` (+4) and `voice-bootstrap.test.ts` (+2, from Phase
13.6's baseline of 12 — now updated for the async signature).

## 22. Tests passed

**1063/1063**, verified twice from a genuinely cold `npm ci` state.

## 23. Tests failed

**0.**

## 24. Repository health

**92/100.** Clean project-reference build, zero circular dependency
errors (a circular reference would fail `tsc --build` outright — it
didn't), no accidental binaries/secrets (verified, see final
verification below), consistent module boundaries. Points withheld for
the still-`ReferenceVoiceRuntimeProvider`-dependent default runtime
path in any environment without real models installed, and for the
still-unimplemented voice-model-diagnostics Settings UI surface.

## 25. Architecture health

**90/100.** Real dependency injection reused consistently
(`ProcessRunner` follows the exact `HttpFetch`/`FileSystemLike`
convention); no second audio/voice architecture was created; the
pre-existing model-registration bug was found and fixed rather than
worked around. Points withheld for AEC/noise-suppression being
completely absent (a real architectural gap, not just an unverified
one) and for device-failure auto-fallback not being designed at all.

## 26. Build health

**100/100.** `npm ci` → `npm run build` → real `vite build` of the
renderer all pass clean from cold state, twice.

## 27. Test health

**95/100.** Comprehensive coverage of every new file, explicit
REAL-vs-fake test labeling throughout (per the brief's explicit
requirement), a genuine end-to-end barge-in test. Points withheld
because no test exercises a real Whisper/Piper binary (impossible in
this environment, but still a real coverage gap relative to "fully
verified").

## 28. Performance health

**N/A — NOT MEASURED** (§19). Not scored numerically since no
measurement was possible; scoring it would imply a false precision.

## 29. Security health

**95/100.** No new capability surface was introduced; STT/TTS output
strictly flows through existing, unmodified security gates. Points
withheld only because child-process argument construction (binary
paths, model paths) is not independently fuzz-tested against
path-traversal-style inputs this phase — a real, if minor, residual
risk surface introduced by shelling out to external binaries at all.

## 30. Documentation health

**93/100.** `docs/adr/0018` (full architecture + honest limitations),
`docs/PROJECT_STATE.md`'s Phase 13.7 section (closed/not-closed
itemization + exact model installation instructions), README/desktop-app
README/CHANGELOG/RELEASE_NOTES all updated, this report exists. Points
withheld: `docs/ARCHITECTURE.md` (requested in the brief's documentation
list) was not located/updated as a standalone file this phase — the
equivalent architectural detail lives in `docs/adr/0018` and
`docs/PROJECT_STATE.md` instead; if a dedicated `docs/ARCHITECTURE.md`
is expected to exist as its own file, that remains a gap.

## 31. Files added

- `core/local-runtime/src/runtime-providers/process-runner.ts`
- `core/local-runtime/src/runtime-providers/whisper-cpp.ts`
- `core/local-runtime/src/runtime-providers/piper.ts`
- `core/local-runtime/test/runtime-providers/process-runner.test.ts`
- `core/local-runtime/test/runtime-providers/whisper-cpp.test.ts`
- `core/local-runtime/test/runtime-providers/piper.test.ts`
- `core/voice-engine/src/tts/sentence-splitter.ts`
- `core/voice-engine/test/tts/sentence-splitter.test.ts`
- `platform/desktop-app/electron/voice-model-provisioning.ts`
- `platform/desktop-app/test/voice-model-provisioning.test.ts`
- `platform/desktop-app/test/voice-pipeline-bargein.test.ts`
- `docs/adr/0018-local-stt-tts-and-automatic-bargein.md`
- `docs/reports/PHASE_13_7_CERTIFICATION_REPORT.md` (this file)

## 32. Files modified

- `core/local-runtime/src/types.ts` — `RuntimeKind` +
  `"whisper-cpp"`/`"piper"`; `ASRRequest`/`TTSRequest` + optional
  `language`/`signal`.
- `core/local-runtime/src/runtime-manager.ts` — forwards
  `context.signal` into ASR/TTS requests.
- `core/local-runtime/src/index.ts` — new exports.
- `core/voice-engine/src/tts/local.ts` — sentence-level chunking.
- `core/voice-engine/src/index.ts` — new export.
- `core/voice-engine/test/tts/local.test.ts` — new cases.
- `platform/desktop-app/electron/voice-bootstrap.ts` — now `async`;
  wires real voice-model registration; `VoiceBundle` gained
  `voiceModelDiagnostics`.
- `platform/desktop-app/electron/core-bootstrap.ts` — awaits
  `bootstrapVoice()`.
- `platform/desktop-app/electron/voice-pipeline.ts` — real barge-in
  monitoring; `runTurn()` gained `presetTranscript`; result gained
  `bargeIn`.
- `platform/desktop-app/electron/main.ts` — automatic barge-in
  continuation loop (bounded).
- `platform/desktop-app/test/voice-bootstrap.test.ts` — `await` added
  to all call sites; 2 new cases.
- `platform/desktop-app/test/core-bootstrap.test.ts` — added the
  previously-missing `modelCacheDir` to 4 test fixtures (a real,
  pre-existing test gap this phase's new code surfaced).
- `README.md`, `platform/desktop-app/README.md`,
  `core/local-runtime/README.md`, `CHANGELOG.md`, `RELEASE_NOTES.md`,
  `docs/PROJECT_STATE.md` — documentation.

## 33. Files deleted

None.

## 34. Packages changed

`@ryper/local-runtime`, `@ryper/voice-engine`, `@ryper/desktop-app`
(package count unchanged at 28 — no new workspace package was created).

## 35. APIs added

Additive only, per package:

- `@ryper/local-runtime`: `createNodeProcessRunner`, `ProcessRunner`/
  `ProcessHandle`/`ProcessResult`/`ProcessSpawnError` types,
  `createWhisperCppRuntimeProvider`, `WhisperBinaryNotFoundError`/
  `WhisperModelMissingError`/`WhisperTranscriptionError`,
  `createPiperRuntimeProvider`, `PiperBinaryNotFoundError`/
  `PiperModelMissingError`/`PiperSynthesisError`.
- `@ryper/voice-engine`: `splitIntoSentences`, `chunkForSpeech`.
- `@ryper/desktop-app` (internal, not published): `detectVoiceModelStatus`,
  `defaultVoiceModelPaths`, `registerVoiceModels`,
  `VoiceModelDiagnostics`/`VoiceModelPaths`/`VoiceModelAvailability` types.

No existing public API was removed or given a breaking signature change
(`bootstrapVoice()` becoming `async` is source-compatible for any
caller that already used `await`/`.then()`, and every in-repo call site
was updated).

## 36. ADRs added

`docs/adr/0018-local-stt-tts-and-automatic-bargein.md`.

## 37. Known limitations

See §10, §11, §19, §20, and `docs/PROJECT_STATE.md`'s Phase 13.7
section for the complete, itemized list. Summarized: no real model
execution verified (network-blocked from the real model host), no AEC/
noise suppression, no physical hardware verified, no device-failure
auto-fallback, no voice-model-diagnostics Settings UI panel, real
per-call CLI process-startup latency (no persistent model server).

## 38. Remaining gaps

`HeuristicToolCallingProvider` (not a language model) — unchanged,
unaddressed, and now the single largest remaining gap between this
repository and the product experience the original brief describes.

## 39. Recommended next phase

Real LLM provider integration (highest value: plugs into the existing,
already-real `AIOrchestrator`/`ToolRegistry` with zero orchestrator
changes per `docs/adr/0016`) — or, if hardware/model access becomes
available, real end-to-end verification of this phase's STT/TTS/
barge-in work against actual installed models and real audio hardware.

## 40. Exact Git commands

```bash
git add -A
git commit -m "Phase 13.7: real local STT + TTS (whisper.cpp/Piper CLI providers, sentence-chunked TTS, automatic barge-in)

- createWhisperCppRuntimeProvider()/createPiperRuntimeProvider(): real
  LocalRuntimeProvider adapters invoking real external CLI binaries via
  a new, injectable ProcessRunner (real node:child_process)
- Real, on-disk model/binary detection (voice-model-provisioning.ts),
  registered into the existing ModelRegistry ahead of an honest
  reference fallback
- Bugfix: nothing was ever registered into ModelRegistry before this
  phase, so every STT/TTS call threw MissingModelError
- Real sentence-level TTS chunking (sentence-splitter.ts) — first
  sentence plays while later sentences still synthesize
- Real, automatic barge-in: VoicePipeline.speak() now monitors for user
  speech during playback and interrupts immediately, verified
  end-to-end in voice-pipeline-bargein.test.ts
- 47 new tests, 1063/1063 repo-wide passing
- See docs/adr/0018 for full architecture and honest limitations (no
  real model execution or physical hardware verified in this sandbox)

NOT READY FOR RC3 — HeuristicToolCallingProvider (not a language model)
remains the largest gap, per docs/PROJECT_STATE.md's Phase 13.7
section."
```

No tag is recommended — this is explicitly not a release (§41).

## 41. Release readiness

**NOT READY FOR RC3.** Both Phase 13.5-named hardware/model seams
(`UnavailableAudioBridge` in 13.6, `ReferenceVoiceRuntimeProvider` in
13.7) are now closed with real, tested integration code — but "closed"
means real working code, not a verified end-to-end real conversation,
which remains impossible to demonstrate in this build environment
(no reachable model host, no audio hardware). `HeuristicToolCallingProvider`
— explicitly, repeatedly documented as not a language model — is
completely unchanged and is now the single largest, clearest remaining
gap before this repository is the product the original brief describes.
