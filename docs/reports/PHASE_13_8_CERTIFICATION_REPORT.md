# Phase 13.8 — Real Model + Real Hardware Voice Verification — Final Certification Report

## 1. Executive Summary

This phase's brief assumes a real Windows development machine with
physical audio hardware. The actual execution environment is a Linux
container (Ubuntu 24.04.4 LTS) with no Windows, no audio hardware of
any kind (`/dev/snd` does not exist), no display server, no Bluetooth,
no USB, and a network egress allowlist that does not include Hugging
Face. This mismatch is stated here plainly, first, per the brief's own
"most important rule": do not mark anything VERIFIED that wasn't
genuinely executed.

Within those real constraints, genuine, non-trivial verification work
was still done: whisper.cpp was built from real source in this
session; a real Piper binary and a real voice model were obtained and
run; the actual Phase 13.7 repository provider code (not test fakes)
was exercised directly against both, producing real, inspected,
non-silent audio for Piper and a real, correctly-thrown diagnostic
error for Whisper (whose model remains genuinely unobtainable here — a
structural fact about network access, confirmed with repeated real
attempts, not a gap in effort). AEC/noise suppression (Part 11) was
closed for real by requesting Chromium's built-in audio processing, no
custom DSP written. Everything requiring physical hardware — the
large majority of this brief's Parts 1, 6, 7, and the Bluetooth/USB
sections — is honestly `NOT AVAILABLE`.

**Certification:** `npm ci` → `npm run build` → `npm test` → `npm run
lint` → `npm run format:check` all pass clean from a genuinely cold
state. **192 test files (191 executed + 1 correctly skipped), 1063
tests passing + 4 correctly skipped** (the new opt-in real-hardware
integration suite, skipped by default so it never depends on a
committed model).

**Release readiness:** per the brief's required framing — **"Voice
pipeline verified [for Piper/TTS and model-management diagnostics],
but RC3 remains blocked by the real LLM/tool-calling seam"** — and
additionally blocked by no real Whisper model access and no physical
hardware verification, both structural to this environment, not
scoped-out by choice.

---

## 2. Environment

- **OS:** Ubuntu 24.04.4 LTS (Linux container), `uname -m`: x86_64.
- **Not Windows.** This phase's brief explicitly assumes a Windows
  development machine; this is a Linux sandbox. Stated here rather
  than silently substituted.
- **CPU:** 1 core available (`nproc` = 1). No GPU.
- **RAM:** not independently profiled beyond what was needed to build
  whisper.cpp and run Piper, both of which succeeded without memory
  pressure.
- **Node.js/npm:** same versions used throughout this project (Node
  v22.22.2, npm 10.9.7).
- **Existing Whisper/Piper installation:** none, prior to this
  session's own installation work.
- **Audio hardware:** none. `ls /dev/snd` → "No such file or
  directory." No microphone, speaker, USB audio device, or Bluetooth
  adapter of any kind exists in this environment.
- **Display server:** none (`$DISPLAY` unset) — the Electron GUI has
  never launched in this environment, unchanged since Phase 12.
- **Network:** egress-restricted to an explicit allowlist (npm,
  PyPI, crates.io, GitHub, Ubuntu archives, Anthropic's own API).
  Hugging Face (`huggingface.co`) and whisper.cpp's original model
  host (`ggml.ggerganov.com`) are both outside it — confirmed via real
  HTTP 403 responses with `x-deny-reason: host_not_allowed`. GitHub
  release assets (`release-assets.githubusercontent.com`) are inside
  it, which is what made real Piper installation possible.

## 3. Whisper installation

**IMPLEMENTED, VERIFIED (binary only).** `git clone
https://github.com/ggerganov/whisper.cpp` (real, succeeded).
`cmake`/`make` installed via `apt-get`. Real build:
`cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j1`,
completed in 159 real seconds. Produced a real, executing `whisper-cli`
binary (`--help` output inspected; real CLI flags — `-m`, `-f`,
`--output-txt`, `--output-file`, `-l` — match exactly what
`whisper-cpp.ts` was written against, confirming the Phase 13.7
integration targets the real CLI correctly). No fake executable, no
predetermined-text script — the real, compiled whisper.cpp source.

## 4. Whisper model

**BLOCKED — could not be installed.** Real attempts:
`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin`
→ real HTTP 403 (`host_not_allowed`);
`https://ggml.ggerganov.com/ggml-model-whisper-tiny.en.bin` → same. Ten
real whisper.cpp GitHub release tags (v1.0.0, v1.2.0, v1.2.1, v1.3.0,
v1.4.0, v1.4.2, v1.7.1–v1.9.2) were individually checked via their real
`expanded_assets` pages — none has ever published a ggml model as a
release asset, at any version. This is a structural fact about where
whisper.cpp models are distributed (only ever the two blocked hosts
above), confirmed with real requests, not assumed. No model was
substituted, fabricated, or worked around.

## 5. Whisper direct test

**BLOCKED**, downstream of §4. A real, human-speech sample was
available (`whisper.cpp`'s own bundled `samples/jfk.wav`, real 16-bit
PCM/16kHz/mono audio), and the actual repository provider code
(`createWhisperCppRuntimeProvider().transcribe()`) was run against it
via `scripts/verify-voice-runtime.mjs` — but with no real model file
present, the real, correct result was a real, correctly-thrown
`WhisperModelMissingError`, not a transcript. This is the honest,
correct behavior of the real code given the real (partial)
installation — reported as `BLOCKED`, not `FAIL` and not `PASS`.

## 6. Whisper microphone test

**NOT AVAILABLE.** No microphone exists in this environment; also
downstream of §4 (no real model regardless).

## 7. Piper installation

**IMPLEMENTED, VERIFIED.** A real official release binary,
`piper_linux_x86_64.tar.gz` (`rhasspy/piper`, tag `2023.11.14-2`, 26MB),
downloaded successfully via a real redirect through
`release-assets.githubusercontent.com`. Extracted and run:
`--help` output confirms real CLI flags (`-m`/`--model`,
`-c`/`--config`, `-f`/`--output_file`) matching exactly what `piper.ts`
was written against.

## 8. Piper voice

**IMPLEMENTED, VERIFIED.** `en-us-lessac-medium` (58MB, `.onnx` +
`.onnx.json`), downloaded via a real, legacy GitHub release
(`rhasspy/piper`, tag `v0.0.2`) that predates the project's later
migration to Hugging-Face-only voice hosting. Real, genuine luck
specific to this one voice/version — not a general solution; most
current Piper voices are Hugging-Face-only. No Hindi-capable voice was
obtained (same hosting reason), so Hindi/mixed-language testing (brief
Part 10) is `NOT AVAILABLE`.

## 9. Piper direct test

**IMPLEMENTED, VERIFIED — real, not a filename check.** Both a raw CLI
invocation and the actual repository provider code
(`createPiperRuntimeProvider().synthesizeSpeech()`, via
`scripts/verify-voice-runtime.mjs`) were run with the input "Hello. I
am RYPER." Result inspected directly: a real `RIFF`/`WAVE`-headed WAV
file, 16-bit/16kHz/mono, 61,996 bytes (repo-code run) /57,388–62,508
bytes (raw CLI runs across several sentences), peak amplitude 32767
(full 16-bit range), non-zero sample ratio ~74%. This is real,
directly-inspected audio content, not merely a correctly-named file.

## 10. Piper playback test

**NOT AVAILABLE.** No speaker or audio output device exists in this
environment. The generated WAV files are real and valid (§9) but were
never played through real hardware.

## 11. End-to-end voice test

**NOT AVAILABLE.** Requires real microphone input and real speaker
output, neither of which exists here; also blocked on §4/§6 for the
STT half.

## 12. Barge-in test

**PASS (software-level, Phase 13.7's test, not re-verified against
hardware this phase); NOT AVAILABLE (hardware-level, this phase).**
`voice-pipeline-bargein.test.ts` (written in Phase 13.7, still passing
this phase's cold-state run) verifies the full mechanism — concurrent
VAD monitor during playback, immediate `interrupt()` on detected
speech, playback genuinely stops mid-response — using a controllable
fake microphone stream and a playback sink with real wall-clock delay.
This was not re-run against physical hardware this phase, because none
exists here.

## 13. Conversation interruption tests

**NOT AVAILABLE.** All 8 variants in the brief (Part 6) require real
speech input against real hardware.

## 14. Audio device tests

**NOT AVAILABLE.** No built-in microphone or speaker exists in this
environment.

## 15. USB tests

**NOT AVAILABLE.** No USB audio device exists.

## 16. Bluetooth tests

**NOT AVAILABLE.** No Bluetooth adapter exists.

## 17. Disconnect/reconnect tests

**NOT AVAILABLE** for real hardware. Phase 13.6's software-level
disconnect _detection_ (`MediaStreamTrack`'s real `ended` event
handling in `capture-client.ts`) remains real and unchanged, but was
not re-exercised against a real device this phase.

## 18. Offline tests

**Piper: NOT VERIFIED (positive signal, not formally tested).** Every
real Piper synthesis call in this session made no network requests
during synthesis (the binary and voice were already resident on local
disk) — a real, positive signal that Piper's synthesis path is
offline-capable, but this container was not additionally, formally
disconnected from the network to confirm it. **Whisper: NOT
AVAILABLE**, downstream of §4 — there is no real model to test offline
behavior with in the first place.

## 19. Model registry verification

**IMPLEMENTED, VERIFIED against a real install.**
`voice-model-provisioning.ts`'s real, on-disk detection logic (already
unit-tested with fakes in Phase 13.7) was exercised this phase via the
real integration test/verification script against the real Piper
install: correctly detected `"installed"`. Against the real
(model-less) Whisper install: correctly detected `"model-missing"`,
producing the real, actionable `WhisperModelMissingError` rather than
a generic "voice unavailable" — exactly the diagnostic-quality
improvement the brief asks for, now confirmed against real files, not
only fakes.

## 20. AEC status

**Real request now made; real effectiveness NOT VERIFIED.**
`echoCancellation: true` is now explicitly set in
`getUserMedia()`'s constraints (`src/audio/capture-client.ts`),
requesting Chromium's real, built-in WebRTC audio processing — not a
custom DSP implementation, per the brief's explicit instruction. The
real, actually-granted setting is exposed via
`CaptureHandle.getAppliedAudioSettings()` (`MediaStreamTrack.getSettings()`)
rather than assumed. Whether this meaningfully reduces echo on any
specific real device remains `NOT VERIFIED` — no audio hardware exists
here to test it against.

## 21. Noise suppression status

Same as §20: `noiseSuppression: true` and `autoGainControl: true` are
now explicitly requested from Chromium's real, built-in stack. Real
effectiveness `NOT VERIFIED` for the same hardware reason.

## 22. Performance measurements

Real, where measurable; explicitly `NOT MEASURED` where not:

- Piper synthesis (5 real calls, real repo code, single sample per
  sentence): **MIN 291ms / MAX 568ms / AVG 417.4ms**.
- Piper real cancellation: **SINGLE SAMPLE, 11ms** (real process kill
  to real promise rejection).
- whisper.cpp real build time: **SINGLE SAMPLE, 159 seconds** (1 CPU
  core, Release config, cold).
- Whisper initialization/transcription latency, memory usage, CPU
  usage during real inference, and full-pipeline/first-audio latency:
  **NOT MEASURED** — no real Whisper model and no real audio hardware
  exist here to measure against. No numbers were invented.

## 23. Voice quality observations

Piper only (Whisper never produced real output to evaluate). Real,
objectively-inspected WAV properties across multiple different
sentences (short commands and longer sentences): 16-bit PCM, 16kHz,
mono; peak amplitude reaching the full 16-bit range; non-zero sample
ratio consistently 70–75%, indicating a real, non-degenerate,
non-silent waveform. This is a description of the generated signal's
objective properties, not a subjective listening-quality judgment — no
human or automated listener evaluated intelligibility or naturalness,
since that requires audio playback hardware this environment does not
have. No artificial quality score is given.

## 24. Automated test results

**192 test files total: 191 executed and passing, 1 correctly skipped
by default. 1067 tests total: 1063 passing, 4 correctly skipped**
(the new opt-in `voice-runtime.real.test.ts`, which — when actually
run with real env vars pointing at this session's real installs —
genuinely passed for Piper and genuinely failed with
`WhisperModelMissingError` for Whisper, both confirmed directly this
session). Verified from a cold `npm ci` state.

## 25. Build results

`npm run build` (`tsc --build`): pass, cold state. Standalone
`vite build` of the renderer (including the new AEC-constraint change
in `capture-client.ts`): pass, real bundled output produced.

## 26. Lint results

`npm run lint` (`eslint . --max-warnings=0`): pass, cold state, zero
warnings. Required one real, justified config addition
(`eslint.config.js` gained a `scripts/**/*.mjs` block with Node
globals for the new verification script — previously no config block
covered plain `.mjs` files).

## 27. Format results

`npm run format:check`: pass, cold state.

## 28. Security verification

- No API keys/model credentials committed (checked: no `sk-`/`AKIA`-style
  patterns found in any tracked source file).
- No model binaries committed (checked: no `.bin`/`.onnx`/`.gguf`/`.wav`
  files anywhere in the repository).
- No microphone recordings or generated audio committed (all real WAV
  output from this session's testing was written to `/tmp` or a
  separate, non-repository working directory, never to the repository
  itself).
- No private transcripts committed — none were produced (Whisper never
  ran against real audio).
- No secrets in logs — logging throughout uses `@ryper/logging`'s
  structured logger, unchanged this phase.
- Raw microphone audio is not persisted by default — unchanged from
  Phase 13.7 (short-lived temp WAV files, written and deleted per
  call).

## 29. Repository health

**92/100** (unchanged from Phase 13.7's assessment — no repository
structure changes this phase beyond the additions in §36).

## 30. Architecture health

**91/100.** The real AEC/noise-suppression decision (using Chromium's
built-in processing rather than a custom DSP module) is a genuinely
good, low-risk architectural choice, executed cleanly and additively.
Points withheld for the same reasons as Phase 13.7 (no device-failure
auto-fallback, no voice-model-diagnostics Settings UI panel) plus the
fact that AEC effectiveness remains unverified against any real
acoustic environment.

## 31. Build health

**100/100.** Clean cold-state build, twice-verified.

## 32. Test health

**96/100.** All existing tests preserved and passing; new, real,
non-fake integration tests were added and genuinely exercised in this
session (not merely written and left unrun). Points withheld because
the opt-in real-hardware suite could only be exercised for Piper, not
Whisper, in this session.

## 33. Performance health

**N/A — mostly NOT MEASURED, real where possible.** Not scored
numerically for the same reason as Phase 13.7: scoring implies a false
precision where most of what the brief asks to measure requires
hardware/models this environment lacks. What real numbers exist (§22)
are reported plainly.

## 34. Security health

**95/100**, unchanged rationale from Phase 13.7 — no new capability
surface, all STT/TTS output still flows through existing, unmodified
security gates; points withheld for the same residual child-process
argument-construction risk noted in that phase's report.

## 35. Documentation health

**94/100.** `docs/adr/0019` (real findings + the real AEC decision),
`docs/PROJECT_STATE.md`'s Phase 13.8 section (the full real-world
certification matrix, itemized per the brief's required format),
README/desktop-app README/CHANGELOG/RELEASE_NOTES all updated, this
report exists. Points withheld for the same `docs/ARCHITECTURE.md`
gap noted in Phase 13.7's report (no standalone file by that name
exists; equivalent detail lives in the ADRs and PROJECT_STATE.md).

## 36. Files added

- `scripts/verify-voice-runtime.mjs`
- `core/local-runtime/test/runtime-providers/voice-runtime.real.test.ts`
- `docs/adr/0019-phase-13-8-real-verification-findings.md`
- `docs/reports/PHASE_13_8_CERTIFICATION_REPORT.md` (this file)

## 37. Files modified

- `platform/desktop-app/src/audio/capture-client.ts` — real
  `echoCancellation`/`noiseSuppression`/`autoGainControl` constraints;
  `CaptureHandle` gained `getAppliedAudioSettings()`.
- `eslint.config.js` — added a `scripts/**/*.mjs` Node-globals block.
- `README.md`, `platform/desktop-app/README.md`, `CHANGELOG.md`,
  `RELEASE_NOTES.md`, `docs/PROJECT_STATE.md` — documentation.

## 38. Files deleted

None.

## 39. Packages changed

`@ryper/desktop-app` (capture-client.ts), `@ryper/local-runtime` (new
opt-in test file only — no source change). Package count unchanged at 28.

## 40. APIs changed

Additive only: `CaptureHandle.getAppliedAudioSettings()` (new method);
`getUserMedia()`'s requested constraints gained three explicit boolean
fields (previously relied on Chromium's implicit default for the same
values). No breaking change to any existing public API.

## 41. ADRs added

`docs/adr/0019-phase-13-8-real-verification-findings.md`.

## 42. Remaining limitations

Everything itemized as `NOT AVAILABLE`/`BLOCKED` in the certification
matrix (§ "real-world certification matrix" in
`docs/PROJECT_STATE.md`'s Phase 13.8 section): no real Whisper model
access, no physical audio hardware of any kind, no Bluetooth/USB
testing, no real end-to-end voice conversation, no real barge-in
verification against hardware, no Hindi/multilingual voice testing, no
device-failure auto-fallback (unchanged from Phase 13.7), no
voice-model-diagnostics Settings UI panel (unchanged from Phase 13.7).

## 43. RC3 blockers

1. `HeuristicToolCallingProvider` — still a deterministic pattern
   matcher, not a language model (unchanged since Phase 13.5).
2. No real Whisper model has ever transcribed real speech in this
   repository's history — structurally blocked from this build
   environment, not a code gap.
3. No physical audio hardware has ever been used with this repository
   — structurally blocked from this build environment.

## 44. Recommended next phase

Two independent, real paths forward, neither of which this build
environment can itself complete:

- **On a real Windows machine with real audio hardware**: install a
  real ggml Whisper model (reachable from a normal internet
  connection, unlike this sandbox) alongside the Piper install this
  phase already proved works, and run the real hardware verification
  matrix this phase's brief specifies — built-in mic/speaker, USB,
  Bluetooth, live end-to-end conversation, real barge-in.
- **In this or a similar sandboxed environment**: real LLM provider
  integration (`docs/adr/0016`'s architecture already supports it with
  zero orchestrator changes) — the highest-value remaining gap that
  doesn't require hardware this environment structurally lacks.

## 45. Exact Git commands

```bash
git add -A
git commit -m "Phase 13.8: real model + real hardware voice verification (partial — sandboxed, no physical hardware)

- Built whisper.cpp from real source in this session; obtained and ran
  a real Piper binary + voice via GitHub release assets
- Ran the actual Phase 13.7 provider code (not fakes) against both:
  real, non-silent Piper audio produced and inspected; real, correct
  WhisperModelMissingError against the real (model-less) install
- Confirmed structurally that no real Whisper model is reachable from
  this build environment (Hugging Face + ggml.ggerganov.com both
  host_not_allowed; checked across 10 whisper.cpp release tags)
- Real AEC/noise suppression/AGC: now explicitly requested from
  Chromium's built-in audio stack (capture-client.ts) — no custom DSP
- New scripts/verify-voice-runtime.mjs + opt-in
  voice-runtime.real.test.ts (skipped by default, genuinely run this
  session with real env vars)
- See docs/adr/0019 and docs/PROJECT_STATE.md's Phase 13.8 section for
  the full real-world certification matrix

NOT READY FOR RC3 — blocked by HeuristicToolCallingProvider (not a
real language model), no real Whisper model access from this
environment, and no physical audio hardware in this environment. See
docs/PROJECT_STATE.md's Phase 13.8 section."
```

No tag is recommended — this is explicitly not a release (§46).

## 46. Release readiness

**NOT READY FOR RC3.** Real, additional progress was made this
phase — the actual Phase 13.7 provider code has now been proven to
correctly drive a real external binary (Piper) with real, inspected
output, and the model-management diagnostics have been proven correct
against a real (if incomplete) install, not only against fakes. But
per the brief's own required framing: **"Voice pipeline verified [for
Piper/TTS and model-management diagnostics], but RC3 remains blocked
by the real LLM/tool-calling seam."** Independently, RC3 is also
blocked by the complete absence of real Whisper model access and real
physical hardware in this build environment — both structural facts
about this environment, not choices made this phase, and both would
need a different environment (a real internet-connected machine with
real audio hardware) to close.
