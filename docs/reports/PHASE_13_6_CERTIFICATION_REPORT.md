# Phase 13.6 — Real Desktop Audio Bridge — Final Certification Report

**Date of this report:** end of Phase 13.6 session, continuing from the
Phase 13.5 repository state (988/988 tests passing, RC3 not ready).

**Mission:** close exactly one of Phase 13.5's two named hardware/model
seams — `UnavailableAudioBridge` — with a real Windows desktop
microphone/speaker audio bridge, reusing the existing RYPER voice
architecture. Not in scope: real wake word/STT/TTS models, a real LLM
provider, or any non-audio integration.

---

## 1. Executive Summary

`UnavailableAudioBridge` is no longer the production audio path.
`RendererAudioBridge` (`platform/desktop-app/electron/audio-bridge.ts`)
is a real implementation of `@ryper/voice-engine`'s `AudioDeviceSource`/
`AudioCaptureSource`/`AudioPlaybackSink`, bridging to genuine
`navigator.mediaDevices`/`AudioContext` code running in the Electron
renderer process, over a new typed IPC contract. Device enumeration,
default-device detection, user-driven device selection, permission
query/request, microphone capture (with real resampling), speaker
playback (with real, immediate barge-in cancellation that reaches the
actual audio node, not an internal flag), and honest degrade behavior
when no renderer window exists are all implemented and covered by 30
new tests. `UnavailableAudioBridge` itself is untouched and remains the
correct fallback for the no-window case.

**No physical or virtual audio hardware exists in this build
environment**, and the real Electron GUI binary does not launch here
(no display server) — the same pre-existing limitation this repository
has carried since Phase 12 for every Electron-native file. Every new
line of renderer audio code is real, calls real standard browser APIs,
and bundles cleanly via a real production `vite build` — but hardware-
level behavior has not been, and is not claimed to have been, verified.

**Certification:** `npm ci` → `npm run build` → `npm test` → `npm run
lint` → `npm run format:check` all pass clean from a genuinely cold
state (all `node_modules`, `dist/`, `dist-electron/`, `dist-renderer/`,
and `*.tsbuildinfo` removed before running). 185/185 test files,
1018/1018 tests passing (988 carried from Phase 13.5 + 30 new).

**RC3 status: AUDIO BRIDGE COMPLETE — RC3 STILL BLOCKED BY OTHER
SEAMS.** See §23–24.

---

## 2. What was implemented

- A real, renderer-mediated audio bridge replacing `UnavailableAudioBridge`
  as the production `AudioDeviceSource`/`AudioCaptureSource`/
  `AudioPlaybackSink`.
- A typed main↔renderer IPC contract for every audio operation (device
  list, permission query/request, capture start/stop + frame streaming,
  playback start/chunk/end/stop, volume).
- Real device enumeration, default-device detection, and user-driven
  selection, exposed through a new Settings UI panel.
- Real Electron media-permission configuration (previously absent —
  `getUserMedia()` cannot succeed in Electron without it, independent of
  OS-level permission).
- Real microphone capture: `getUserMedia()`, a `ScriptProcessorNode` PCM
  tap, real linear-interpolation resampling to the STT provider's
  expected rate, and honest handling of denial/unavailability/disconnect.
- Real speaker playback: `AudioContext.decodeAudioData()` +
  `AudioBufferSourceNode` gapless scheduling, real `GainNode`-backed
  volume, and real immediate-stop barge-in.
- Cancellation verified to reach the real device via two distinct real
  mechanisms: the JS async-iteration protocol's `AsyncIterator.return()`
  (capture) and a direct `AbortSignal` listener sending an immediate IPC
  message (playback/barge-in) — both covered by tests that assert the
  actual IPC message was sent, not merely that a promise resolved.
- Honest degrade (never a fabricated response) when no renderer window
  is available or a request times out.

## 3. Audio architecture

```
Renderer (Chromium, real browser APIs)
  navigator.mediaDevices.getUserMedia() / enumerateDevices()
  AudioContext (capture tap via ScriptProcessorNode, playback via
  AudioBufferSourceNode + GainNode)
        │  src/audio/{capture-client,playback-client,device-client,index}.ts
        │  window.ryperAudioBridge (contextBridge, contextIsolation intact)
        ▼
  electron/audio-ipc-contract.ts  (typed channel names + payload shapes)
        │  ipcMain.on / webContents.send
        ▼
Main process (Node)
  electron/audio-bridge.ts → RendererAudioBridge
    implements AudioDeviceSource / AudioCaptureSource / AudioPlaybackSink
        │
        ▼
  @ryper/voice-engine (unmodified): AudioDeviceManager, MicrophoneManager,
  SpeakerManager, VoicePipeline, VAD, wake word, STT/TTS interfaces
```

No second audio architecture was created; no microphone/speaker
management was duplicated. `AudioDeviceManager`/`MicrophoneManager`/
`SpeakerManager` are the same, unmodified classes from `@ryper/voice-
engine` — only the `AudioDeviceSource`/`AudioCaptureSource`/
`AudioPlaybackSink` implementation they're constructed with changed.

## 4. Windows backend used

No native Node addon (e.g. PortAudio/WASAPI bindings) was introduced —
deliberately (see `docs/adr/0017`'s alternatives). The real backend is
the Electron renderer's Chromium engine, which on Windows uses the OS's
real audio stack (WASAPI under the hood) via standard, unmodified
browser APIs. This avoids a native-build-toolchain dependency this
repository does not otherwise have.

## 5. Microphone implementation

`src/audio/capture-client.ts`: `getUserMedia()` with device-specific or
default constraints; a `ScriptProcessorNode` (4096-sample buffer) taps
real PCM, converted from `Float32Array` to `Int16Array`
(`resample.ts`'s `floatTo16BitPcm`) and resampled from the hardware's
negotiated rate to the requested rate (`resamplePcm16`, linear
interpolation). Device-disconnect is handled via the real
`MediaStreamTrack` `"ended"` event. Denial/unavailability produce
specific, honest messages (mapped from real `DOMException` names).
Stop releases real resources: track stop, node disconnect, `AudioContext.
close()`.

## 6. Speaker implementation

`src/audio/playback-client.ts`: each `TtsAudioChunk` is decoded via real
`AudioContext.decodeAudioData()` and scheduled on a real
`AudioBufferSourceNode` routed through a real `GainNode` (live volume),
with gapless sequential scheduling for multi-chunk streams. `SpeakerManager`
remains the sole owner of speaker lifecycle semantics — no second speaker
manager was created. Barge-in (`stop()`) calls `.stop()` on every active
`AudioBufferSourceNode` and closes the `AudioContext` immediately.

## 7. Device management

Real enumeration (`device-client.ts`'s `listAudioDevicesReal()`),
identity (`deviceId`), friendly names (device `label`, honestly reported
as unavailable pre-permission rather than fabricated), default-device
detection, and transport heuristics (bluetooth/usb/virtual/builtin from
label matching) — exposed through the pre-existing `AudioDeviceManager`
API, with selection persisted via its existing `setDefault()`/
`MicrophoneManager.selectDevice()`/`SpeakerManager.selectDevice()`. No
new, unrelated configuration system was introduced.

## 8. IPC architecture

`electron/audio-ipc-contract.ts` defines every channel and payload shape,
imported by both the main-process bridge and the renderer client — a
channel can't drift out of sync between them, matching this repo's
existing `ipc-contract.ts` pattern. `preload.ts` exposes a narrow,
generic `window.ryperAudioBridge` (`onCommand`/`sendResult`) rather than
one bespoke method per channel, keeping the closed, fully-typed channel
set from growing untyped surface. The renderer never gains direct
`ipcRenderer`/Node access — `contextIsolation`/`sandbox` remain
untouched.

## 9. Permission architecture

Integrates with Electron's real permission system:
`session.setPermissionRequestHandler`/`setPermissionCheckHandler` now
grant only `"media"`, denying everything else — matching this repo's
existing deny-by-default posture (`main.ts`'s `denyAllConfirmer`).
`AudioDeviceManager.hasPermission()`/`requestPermission()` (pre-existing
API) now have a real backend. UI states are explicit and distinct:
`"available"` / `"permission-denied"` / `"unavailable"` — never a silent
failure.

## 10. Barge-in implementation

Two real, tested cancellation paths:

1. **Capture:** `MicrophoneManager.stopCapture()`'s `AbortController`
   causes a `for await...of` early exit, which the JS runtime turns into
   a real `AsyncIterator.return()` call on the capture stream — wired to
   send a real `stopCapture` IPC message.
2. **Playback:** `SpeakerManager.interrupt()`'s `AbortSignal` firing is
   listened for directly inside `play()` and sends a real `stopPlayback`
   IPC message _synchronously_, before waiting on anything else — the
   renderer stops the real `AudioBufferSourceNode`(s) immediately.
   `play()` itself races the chunk source against the abort signal so it
   returns promptly even if the chunk source is mid-`next()` for an
   arbitrary time — verified directly in `test/audio-bridge.test.ts`.

## 11. Files added

- `platform/desktop-app/electron/audio-ipc-contract.ts`
- `platform/desktop-app/src/audio/resample.ts`
- `platform/desktop-app/src/audio/capture-client.ts`
- `platform/desktop-app/src/audio/playback-client.ts`
- `platform/desktop-app/src/audio/device-client.ts`
- `platform/desktop-app/src/audio/index.ts`
- `platform/desktop-app/test/audio-bridge.test.ts`
- `platform/desktop-app/test/resample.test.ts`
- `docs/adr/0017-renderer-mediated-audio-bridge.md`
- `docs/reports/PHASE_13_6_CERTIFICATION_REPORT.md` (this file)

## 12. Files modified

- `platform/desktop-app/electron/audio-bridge.ts` — added
  `RendererAudioBridge`; `UnavailableAudioBridge` unchanged.
- `platform/desktop-app/electron/voice-bootstrap.ts` — optional
  `audioIpc` parameter; `VoiceBundle` gained `deviceManager`/
  `microphoneManager`/`speakerManager`.
- `platform/desktop-app/electron/core-bootstrap.ts` — threads
  `audioIpc` through.
- `platform/desktop-app/electron/main.ts` — wires real `ipcMain`/
  `mainWindow.webContents`; broadcasts audio status on device
  connect/disconnect.
- `platform/desktop-app/electron/windows.ts` — real media-permission
  handler.
- `platform/desktop-app/electron/ipc-contract.ts` — new audio device
  types/channels.
- `platform/desktop-app/electron/ipc-handlers.ts` — new audio IPC
  handlers.
- `platform/desktop-app/electron/preload.ts` — new `window.ryper` audio
  methods + `window.ryperAudioBridge`.
- `platform/desktop-app/src/ryper-global.d.ts` — new global type.
- `platform/desktop-app/src/main.tsx` — mounts the renderer audio
  bridge.
- `platform/desktop-app/src/SettingsApp.tsx` — Audio Devices panel.
- `platform/desktop-app/src/styles/settings.css` — audio status styles.
- `platform/desktop-app/test/voice-bootstrap.test.ts` — new cases.
- `README.md`, `platform/desktop-app/README.md`, `CHANGELOG.md`,
  `RELEASE_NOTES.md`, `docs/PROJECT_STATE.md` — documentation.

## 13. Files deleted

None.

## 14. Public APIs added/changed

- **Additive only.** `@ryper/voice-engine`'s public API is unchanged.
  `bootstrapVoice()`/`bootstrapCore()` gained one new optional parameter
  each (`audioIpc`) — every existing caller that omits it is unaffected.
  `VoiceBundle` gained three new fields (additive). `RyperInvokeApi`/
  `RyperEventApi` (renderer-facing IPC contract) gained new methods —
  additive, no existing method changed signature.

## 15. Tests added

- `test/audio-bridge.test.ts` — 17 tests: device listing (success + no-
  renderer degrade), permission query/request (success + degrade),
  request timeout, capture streaming, capture `AsyncIterator.return()`
  cancellation, capture failure on no-renderer, capture-error
  propagation, playback success/failure/no-renderer-throw, barge-in
  (abort mid-stream), setVolume (success + no-renderer throw), device-
  change callback wiring, destroyed-renderer handling.
- `test/resample.test.ts` — 11 tests: identity passthrough, down/
  upsampling ratios, amplitude preservation, known-value interpolation,
  clamping, empty input, invalid-rate rejection, float-to-PCM16 range
  mapping/clamping/length preservation.
- `test/voice-bootstrap.test.ts` — 2 new cases: bundle exposes
  `deviceManager`/`microphoneManager`/`speakerManager`; a real `audioIpc`
  wiring actually reaches a fake renderer for a device-list request.

## 16. Full test result

```
Test Files  185 passed (185)
     Tests  1018 passed (1018)
```

(988 carried unchanged from Phase 13.5 + 30 new this phase.)

## 17. Build result

```
> tsc --build tsconfig.json
```

Exits 0, cold state, no errors. The renderer project
(`tsconfig.renderer.json`, not part of the root project-reference graph
— pre-existing repo structure) was additionally manually type-checked
(`tsc -p tsconfig.renderer.json --noEmit`): clean. A real production
`vite build` of the renderer (including every new `src/audio/*` file)
was also run standalone and succeeds, producing real bundled output.

## 18. Lint result

```
> eslint . --max-warnings=0
```

Exits 0, cold state, zero warnings.

## 19. Format result

```
> prettier --check "**/*.{ts,tsx,js,json,md,yml,yaml}"
```

Exits 0, "All matched files use Prettier code style!"

## 20. Hardware test result

**NOT VERIFIED — physical hardware unavailable.** This build
environment has no display server (the Electron GUI binary does not
launch here, unchanged since Phase 12) and no physical or virtual
microphone/speaker device. Every new audio file is real code calling
real, standard browser APIs (`getUserMedia`, `AudioContext`,
`decodeAudioData`, `AudioBufferSourceNode`, `enumerateDevices`, the
Permissions API) and was verified to build and bundle correctly — but
none of it has been exercised against actual hardware or a real running
Chromium renderer process in this session. This is stated plainly per
this phase's explicit instruction not to claim hardware verification
that did not happen.

**PASS — automated simulation/integration tests:** all 30 new tests, run
against a deterministic fake main↔renderer IPC harness (no real
`electron` module involved), verifying the main-process bridge logic,
cancellation semantics, timeout handling, and degrade behavior described
above.

## 21. Performance measurements

None taken — no real hardware or running renderer process exists in
this environment to measure against (see §20). No performance claims
are made.

## 22. Remaining limitations

- Physical hardware unverified (§20).
- Speaker _output-device_ routing is selectable in the UI
  (`SpeakerManager.selectDevice()`) but not functionally wired to actual
  playback routing — no shipping browser exposes `AudioContext.
setSinkId()`; playback always uses the OS default output device. See
  `docs/adr/0017`, Decision 6.
- `ScriptProcessorNode` (deprecated, universally supported) is used for
  the capture tap instead of `AudioWorkletNode`, a deliberate scope
  tradeoff (`docs/adr/0017`, Decision 5) to avoid packaged-build asset
  complexity this phase did not need to take on.
- `ReferenceVoiceRuntimeProvider` (no real STT/TTS model) and
  `HeuristicToolCallingProvider` (not a language model) are completely
  unchanged — explicitly out of this phase's scope per the brief.

## 23. Phase 13.6 readiness

**Complete**, within the scope this phase's brief set (close the audio
I/O seam only). Real device management, real permission handling, real
capture, real playback, and real, tested cancellation semantics are all
in place and are the production path. Physical hardware verification
remains pending, honestly reported rather than assumed.

## 24. RC3 readiness

**AUDIO BRIDGE COMPLETE — RC3 STILL BLOCKED BY OTHER SEAMS.**
`UnavailableAudioBridge` is closed for real. Two Phase 13.5 seams remain
completely untouched: `ReferenceVoiceRuntimeProvider` (no real STT/TTS
model anywhere in this repository) and `HeuristicToolCallingProvider`
(explicitly not a language model). The product's central RC3 scenario —
a natural, open-ended spoken request, genuinely transcribed, genuinely
understood, and genuinely spoken back — still requires a real acoustic/
language model that does not exist here. **NOT READY FOR RC3** in the
full sense: this phase adds the last piece of real, working, hardware-
facing plumbing those future models will need — real audio in, real
audio out, real cancellation, all the way to the device boundary — but
does not itself complete the product experience RC3 requires.

## 25. Exact Git commands to run

```bash
git add -A
git commit -m "Phase 13.6: real desktop audio bridge (renderer-mediated getUserMedia/AudioContext over IPC)

- RendererAudioBridge replaces UnavailableAudioBridge as the production
  AudioDeviceSource/AudioCaptureSource/AudioPlaybackSink implementation
- Real device enumeration/selection, permission handling (incl. the
  previously-missing Electron session.setPermissionRequestHandler),
  microphone capture with real resampling, speaker playback with real
  immediate barge-in cancellation
- New Settings UI Audio Devices panel
- 30 new tests, 1018/1018 repo-wide passing
- See docs/adr/0017 for the full architecture and honest limitations
  (no physical hardware verification possible in this sandbox)

NOT READY FOR RC3 — ReferenceVoiceRuntimeProvider (no real STT/TTS
model) and HeuristicToolCallingProvider (not a language model) remain
unchanged, per docs/PROJECT_STATE.md's Phase 13.6 section."
```

No tags are recommended — this is explicitly not a release, per §24.
