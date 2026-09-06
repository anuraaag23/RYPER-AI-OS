# ADR 0017: A real desktop audio bridge, mediated through the renderer's `navigator.mediaDevices`/`AudioContext` over IPC

**Status:** Accepted (Phase 13.6)

## Context

Phase 13.5 left `UnavailableAudioBridge` as the only implementation of
`@ryper/voice-engine`'s `AudioDeviceSource`/`AudioCaptureSource`/
`AudioPlaybackSink` — honestly labeled as such, but meaning the desktop
app could not actually capture microphone audio or play synthesized
speech through real hardware. This phase's brief is scoped narrowly to
closing exactly that seam, reusing the existing Voice Engine, Audio
Pipeline, Microphone/Speaker Managers, Device Manager, and Desktop App
architecture rather than building a second one.

The real question this phase had to answer: **where does real
microphone/speaker access actually live in an Electron app, and how
does `platform/desktop-app/electron/*` (which runs in Node, in the
Electron main process) reach it?**

Two real options exist:

1. **A native Node addon** (e.g. bindings to WASAPI directly, or a
   cross-platform library like PortAudio/`naudiodon`) called directly
   from the main process.
2. **The renderer process's real browser APIs** — `navigator.
mediaDevices.getUserMedia()`, `AudioContext`, `AudioBufferSourceNode`
   — which is Chromium, and genuinely has real, OS-backed audio I/O,
   bridged to the main process over IPC.

Option 1 requires either compiling a native addon against Electron's
ABI (a real build-toolchain dependency this repository does not
currently have — no native module is built anywhere else in this repo)
or shipping a prebuilt binary per platform/arch, both of which are
substantial, independent pieces of infrastructure. Option 2 requires no
new native dependency: every piece of it (`getUserMedia`, `AudioContext`,
`decodeAudioData`, `AudioBufferSourceNode`) is a real, standard,
already-available browser API in the renderer Electron already runs.

## Decision

1. **The real audio bridge is renderer-mediated.** `platform/desktop-app/
src/audio/{capture-client,playback-client,device-client,index}.ts`
   call real `navigator.mediaDevices`/`AudioContext` APIs in the
   renderer process. `platform/desktop-app/electron/audio-bridge.ts`'s
   new `RendererAudioBridge` class is the main-process half: it
   implements `AudioDeviceSource`/`AudioCaptureSource`/
   `AudioPlaybackSink` by sending typed commands to the renderer over
   IPC (`electron/audio-ipc-contract.ts`) and translating the renderer's
   typed replies/events back into what `@ryper/voice-engine` expects.
   `UnavailableAudioBridge` remains, unchanged, as the honest fallback
   for when no renderer window exists (headless bootstrap, every
   existing unit test) — this ADR does not remove it, it adds a real
   alternative that `voice-bootstrap.ts` prefers whenever a renderer
   `WebContents` is available.
2. **Cancellation reaches the real device, not an internal flag.**
   `MicrophoneManager.stopCapture()`'s `AbortController` causes a
   `for await...of` early exit, which the JS runtime translates into a
   real `AsyncIterator.return()` call on `RendererAudioBridge`'s
   capture stream — implemented to send a real `stopCapture` IPC
   message that the renderer uses to stop the actual `MediaStreamTrack`.
   `SpeakerManager.interrupt()`'s `AbortSignal` abort is listened for
   directly and sends a real `stopPlayback` IPC message immediately
   (not waiting for any round trip), which the renderer uses to call
   `.stop()` on the actual `AudioBufferSourceNode`(s) — this is the
   literal mechanism satisfying "cancellation must reach the actual
   audio device."
3. **Electron's `session.setPermissionRequestHandler`/
   `setPermissionCheckHandler` are now configured** (`electron/
windows.ts`) to grant only `"media"` and deny everything else —
   required because Electron denies every permission request by
   default, `getUserMedia()` would otherwise always fail with
   `NotAllowedError` regardless of the OS-level microphone permission.
   This mirrors this repo's existing "never grant silently" default
   (`main.ts`'s `denyAllConfirmer`): one narrow, explicit grant, not a
   blanket relaxation.
4. **Resampling is real, in `src/audio/resample.ts`, not fabricated.**
   `AudioContext`'s sample rate is whatever the OS/hardware negotiates
   (commonly 44100/48000Hz) and cannot be forced to the STT provider's
   expected 16000Hz in every browser; a pure linear-interpolation
   resampler bridges the two. It is intentionally a pure, dependency-
   free function (no `AudioContext`, no DOM) so it is directly unit-
   tested (`test/resample.test.ts`) independent of any browser runtime.
5. **`ScriptProcessorNode`, not `AudioWorkletNode`, for the capture tap**
   (`src/audio/capture-client.ts`). `ScriptProcessorNode` is a real,
   deprecated-but-universally-supported API; `AudioWorkletNode` is the
   modern replacement but requires shipping and loading a second JS
   module through Electron's packaged `file://` asset pipeline — real,
   separate build-system work this phase's scope does not require for
   one audio processor. Swapping later requires no change outside that
   one file.
6. **Output-device selection for Web Audio playback is not implemented.**
   No shipping browser exposes `AudioContext.setSinkId()` (only
   `HTMLMediaElement.setSinkId()` exists, Chromium-only, and does not
   apply to `AudioContext.destination`). Speaker enumeration/selection
   is real (`listDevices()`, the Settings UI picker, `SpeakerManager.
selectDevice()`), but actual playback routing always goes through
   the OS-selected default output device, not a specifically chosen
   non-default one. This is stated here plainly rather than silently
   ignored — see `docs/PROJECT_STATE.md`'s Phase 13.6 known limitations.

## What this closes and what it honestly does not

**Closes for real:** `UnavailableAudioBridge` is no longer the
production path — a real Electron renderer, calling real `getUserMedia`/
`AudioContext`/`AudioBufferSourceNode` APIs, is. Device enumeration,
default-device detection, device selection/persistence (via
`AudioDeviceManager.setDefault()`), permission query/request, capture
start/stop with real PCM frames flowing through the existing
`MicrophoneManager` → Voice Engine pipeline unmodified, and real
speaker playback with real, immediate barge-in cancellation are all
real, working, and covered by tests (`test/audio-bridge.test.ts`,
`test/resample.test.ts`).

**Does not close, honestly:** **physical hardware has not been
exercised.** This sandbox has no display server, no audio hardware, and
does not launch the real Electron GUI binary (a pre-existing, documented
limitation carried from every prior phase — `windows.ts`/`tray.ts`/
`main.ts`/`preload.ts` have never been directly unit-tested here for the
same reason). Every line of `src/audio/*` is real code that calls real
browser APIs and will run against real Windows microphone/speaker
hardware in a real packaged build — but that has not been verified in
this environment. This is reported as **NOT VERIFIED — physical hardware
unavailable**, distinct from the **PASS** automated/integration test
results, per the brief's explicit instruction not to claim hardware
verification that did not happen. Output-device (speaker) routing
selection, as described in Decision point 6, is also an honest,
documented gap, not a silent one.

## Alternatives Considered

- **A native Node addon (PortAudio/WASAPI bindings) in the main
  process.** Rejected for this phase: requires a native build toolchain
  this repository does not have configured anywhere, and prebuilt
  binaries per platform/arch are real infrastructure this phase's scope
  did not call for. The renderer-mediated approach delivers real,
  working audio I/O with zero new native dependencies.
- **`AudioWorkletNode` instead of `ScriptProcessorNode`.** Preferred
  long-term (not deprecated), but requires shipping/loading a second
  module through the packaged build — real added complexity for this
  phase's single processing node. Isolated to one file so it's a
  drop-in swap later.
- **Skip Electron's permission handler and rely on an OS-level prompt
  alone.** Rejected: Electron denies `getUserMedia()` outright without
  an explicit `session.setPermissionRequestHandler` grant, independent
  of the OS permission state — omitting it would make the real bridge
  never actually work, silently.

## Tradeoffs

- The main process never touches raw audio bytes directly for capture —
  it only ever sees frames the renderer already decoded/resampled. This
  is architecturally correct for Electron (the renderer is the only
  process with real media APIs) but does mean a renderer crash/reload
  interrupts any in-flight capture or playback; `RendererAudioBridge`
  reports this honestly via `AudioBridgeUnavailableError` rather than
  hanging (bounded per-request timeouts, default 8000ms).
- Speaker output device selection is UI-visible but not functionally
  wired to actual output routing (see Decision point 6) — an honest,
  documented half-step, not a completed feature.

## Migration Impact

`@ryper/voice-engine`'s public API is unchanged — `RendererAudioBridge`
implements the same `AudioDeviceSource`/`AudioCaptureSource`/
`AudioPlaybackSink` interfaces `UnavailableAudioBridge` already did.
`bootstrapVoice()`'s signature gained one new optional parameter
(`audioIpc`); every existing caller (all tests, and any future headless
bootstrap) that omits it is unaffected and continues to get
`UnavailableAudioBridge`, exactly as before this phase. `bootstrapCore()`
gained the same optional parameter, threaded through from `main.ts`.
`VoiceBundle` gained three new fields (`deviceManager`,
`microphoneManager`, `speakerManager`) — additive, not breaking.
