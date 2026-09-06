# @ryper/desktop-app — Desktop Shell

Phases 12–13.5 of RYPER AI OS. An Electron application hosting Core
in-process (see `docs/adr/0014` for why this deviates from
`docs/ARCHITECTURE.md`'s original native-shells-over-Electron plan, and
what is/isn't preserved from that design).

```
Electron main process (real Node.js)
  -> bootstrapCore() -> @ryper/web-shell (real ConversationEngine, ModelRouter, ...)
  -> @ryper/security (CapabilityBroker), @ryper/platform-capability (CapabilityManager)
  -> @ryper/windows-agent (WindowsAdapter, registered only on win32)
  -> ConversationStore / SettingsStore (desktop-only, real JSON-file persistence)
  -> bootstrapVoice() -> @ryper/voice-engine (real session/VAD/STT/TTS/intent/commands),
       real @ryper/memory-system MemoryManager, real @ryper/ai-engine AIOrchestrator
       (docs/adr/0016), VoicePipeline (docs/adr/0015)
       |
       | ipcMain.handle (electron/ipc-handlers.ts)
       v
preload.ts (contextBridge, sandboxed) -> window.ryper
       |
       v
React renderer (Vite-bundled) -> App.tsx / SettingsApp.tsx
```

## Honest scope

Phase 12's brief asked for nine windows and a full physics-based voice
orb; Phase 13's asked for an Alexa/Siri-quality offline voice assistant;
Phase 13.5's asked to connect voice to real AI orchestration/planning.
What's actually built, each phase, is a real, fully-wired, tested slice
— see `docs/PROJECT_STATE.md`'s "Phase 12 desktop shell," "Phase 13
desktop voice assistant," and "Phase 13.5" honest-scope sections for the
complete list of what's delivered versus deliberately deferred (shown as
honestly-labeled "coming soon" nav entries, never as fake populated
screens).

## Voice

`bootstrapVoice()` (`electron/voice-bootstrap.ts`) assembles the entire
`@ryper/voice-engine` stack for real: session management, VAD-based
endpointing, a real offline wake-word provider, STT/TTS provider
selection, intent detection, command routing, and memory context — none
of it was wired into any shell before Phase 13. `VoicePipeline`
(`electron/voice-pipeline.ts`) orchestrates a turn exactly the way
`@ryper/voice-engine`'s own `AudioPipelineManager` does, calling a real
`@ryper/ai-engine` `AIOrchestrator` (Phase 13.5, `docs/adr/0016`) for
its conversational/task fallback — with real, observed, multi-round
tool execution against real desktop capabilities, not the simpler
`ConversationEngine` Phase 13 first used (`docs/adr/0015`). Real voice
command handlers and `AIOrchestrator` tool definitions
(`electron/voice-commands.ts`, `electron/desktop-tools.ts`) share one
real implementation (`electron/desktop-actions.ts`) that executes
through the real `CapabilityManager`/`WindowsAdapter` — verified against
a real Windows Platform Agent in tests, not mocks, including a genuine
multi-step scenario (open app → set volume → mute, each step observed
before the next).

**The tool-calling "AI" is a real LLM by default, as of Phase 13.9** —
see the "Real LLM + tool calling" section below. `HeuristicToolCallingProvider`
(`electron/heuristic-ai-provider.ts`), a deterministic pattern matcher
explicitly documented as such, remains registered as the honest
last-resort fallback when no real local LLM is detected/startable and
no cloud provider is configured — it is not removed, only demoted.

All three seams named in Phase 13.5 are now closed for real:
`UnavailableAudioBridge` (Phase 13.6, "Real audio bridge" section below,
`docs/adr/0017`), `ReferenceVoiceRuntimeProvider` (Phase 13.7, "Real
local STT + TTS" section below, `docs/adr/0018`), and
`HeuristicToolCallingProvider` as the _only_ option (Phase 13.9, "Real
LLM + tool calling" section below, `docs/adr/0020`).
`docs/PROJECT_STATE.md`'s Phase 13/13.5–13.9 sections have the full
detail, including exactly what remains `NOT VERIFIED` in each case.

## Real LLM + tool calling (Phase 13.9)

`electron/llm-model-provisioning.ts` does real, on-disk detection of an
externally-installed `llama-server` binary + GGUF model (never bundled
into this repository) and, when found, starts and health-checks a
real, long-running `llama-server` process, wiring it into
`@ryper/local-runtime`'s existing `createLlamaCppProvider()`. When not
found, `ai-orchestrator-bootstrap.ts` falls back to registering only
`HeuristicToolCallingProvider`, honestly. Explicit-only, optional cloud
providers (`RYPER_CLOUD_LLM_PROVIDER`/`_API_KEY`/`_MODEL`, all three
required) reuse the existing, unmodified OpenAI-/Anthropic-/
Google-compatible providers — never silently substituted for local.
Real, structural tool-argument schema validation
(`core/ai-engine/src/tool-calling/validation.ts`) now runs before every
tool call executes, closing the exact `set_volume(500)` gap named in
this phase's own brief. See `docs/adr/0020` and `docs/PROJECT_STATE.md`'s
Phase 13.9 section for the full real-model-verification account
(`llama-server` was built from real source and run for real in this
repository's sandbox; no real inference-capable GGUF chat model could
be obtained from it — structurally, the same as Phase 13.8's Whisper
finding).

## Real local STT + TTS (Phase 13.7)

`core/local-runtime/src/runtime-providers/{whisper-cpp,piper}.ts` are
real `LocalRuntimeProvider` implementations that invoke real, external
whisper.cpp/Piper CLI binaries via a new `ProcessRunner` abstraction
(real `node:child_process`). `electron/voice-model-provisioning.ts`
does real, on-disk detection of whether a real binary+model are
actually installed, registering whichever is real ahead of an honest
reference fallback into `@ryper/local-runtime`'s existing
`ModelRegistry`/`LocalRuntimeManager` (Phase 4, unmodified) — this also
fixes a real, pre-existing bug where nothing had ever been registered
into `ModelRegistry` at all, meaning STT/TTS always threw
`MissingModelError` before Phase 13.7. Real sentence-level TTS chunking
(`core/voice-engine/src/tts/sentence-splitter.ts`) lets the first
sentence of a response start playing while later sentences are still
synthesizing, reusing Phase 13.6's playback pipeline unchanged — this
is not token-level AI streaming and is never described as such. Real,
automatic barge-in (`electron/voice-pipeline.ts`'s `speak()`) stops
playback the instant the user starts talking, no button required,
verified end-to-end in `test/voice-pipeline-bargein.test.ts`. See
`docs/adr/0018` for the full architecture, and `docs/PROJECT_STATE.md`'s
Phase 13.7 section for exact model installation instructions.

## Real model + real hardware verification (Phase 13.8)

Phase 13.7's provider code above was actually run against real
binaries in this repository's build sandbox — see `docs/adr/0019` and
`docs/PROJECT_STATE.md`'s Phase 13.8 section for the full account and
the real-world certification matrix. Summary: a real Piper install
(binary + `en-us-lessac-medium` voice) was obtained and the actual
`createPiperRuntimeProvider()` code produced real, inspected,
non-silent audio; whisper.cpp was built from real source but no real
ggml model could be obtained (Hugging Face and whisper.cpp's original
model host are both outside this environment's network allowlist —
confirmed structurally, not just untried). `scripts/verify-voice-runtime.mjs`
and `core/local-runtime/test/runtime-providers/voice-runtime.real.test.ts`
(opt-in, skipped by default) exist to reproduce or extend this
verification on a machine with real models installed. AEC/noise
suppression (Part 11) is now real: Chromium's built-in
`echoCancellation`/`noiseSuppression`/`autoGainControl` are explicitly
requested in `src/audio/capture-client.ts`. No physical audio hardware,
Bluetooth, USB device, or Windows machine exists in this sandbox, so
none of that could be tested — reported honestly as `NOT AVAILABLE`,
not assumed passing.

## Real audio bridge (Phase 13.6)

`RendererAudioBridge` (`electron/audio-bridge.ts`) is now the production
`AudioDeviceSource`/`AudioCaptureSource`/`AudioPlaybackSink`, replacing
`UnavailableAudioBridge` (which remains, unchanged, as the honest
fallback for the no-renderer-window case). It bridges to real
`navigator.mediaDevices`/`AudioContext` code running in the renderer
(`src/audio/{capture-client,playback-client,device-client,index}.ts`)
over a typed IPC contract (`electron/audio-ipc-contract.ts`). Real
device enumeration/selection is exposed through a new Settings UI
"Audio Devices" panel. `windows.ts` now configures Electron's
`session.setPermissionRequestHandler` to grant `"media"` — required for
`getUserMedia()` to ever succeed, previously missing. See
`docs/adr/0017` for the full architecture and its honest limitations
(no physical hardware verification possible in this sandbox; speaker
output-device routing is selectable in the UI but not yet functionally
wired, since no browser exposes `AudioContext.setSinkId()`).

## Building and testing

```sh
npm run build              # tsc --build (main process + preload) + vite build (renderer)
npm run build:electron     # tsc --build only
npm run build:renderer     # vite build only
npm test                   # vitest — unit tests (real temp-file persistence, real Core
                            # wiring) + jsdom/React Testing Library component tests
npm run dev:renderer       # vite dev server, for renderer-only iteration
```

**Cannot be verified in this build sandbox:** actually launching the
Electron GUI (`electron .`). There is no display server here, and while
the `electron` npm package's official TypeScript types (v43.3.0)
install and compile cleanly, the native platform binary does not
download/run in this environment. Every line of main-process and
renderer logic is still real code, verified by a real `tsc --build`, a
real `vite build` producing a real bundled output, and real Vitest
tests (including jsdom + React Testing Library for components) — the
same "real code, sandbox-limited runtime verification" pattern already
established for `@ryper/windows-agent`'s `PowerShellWindowsSystemApi`.
The same applies to Phase 13.6's real audio bridge (`src/audio/*`): it
calls real, standard browser APIs and builds/bundles cleanly, but no
physical or virtual microphone/speaker exists in this environment to
verify against — see `docs/adr/0017` and `docs/PROJECT_STATE.md`'s
Phase 13.6 section for the precise, itemized account.

## Key modules

| File                                                         | Role                                                                                                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/main.ts`                                           | App lifecycle, window/tray creation, wires everything together                                                                                                                  |
| `electron/core-bootstrap.ts`                                 | `bootstrapCore()` — reuses `@ryper/web-shell`, adds security/platform-capability/windows-agent/stores, reports live startup diagnostics                                         |
| `electron/ipc-contract.ts`                                   | The single typed source of truth for every IPC channel — imported by main, preload, and renderer, so a channel can't drift out of sync between them                             |
| `electron/conversation-store.ts`                             | Real JSON-file-backed conversation/message persistence — the desktop shell's own state, not a duplicate of `ConversationEngine` (see its doc comment)                           |
| `electron/settings-store.ts`                                 | Real JSON-file-backed settings, with field-by-field sanitization of untrusted on-disk JSON                                                                                      |
| `electron/windows.ts` / `electron/tray.ts`                   | Real `BrowserWindow`/`Tray` construction                                                                                                                                        |
| `electron/ipc-handlers.ts` / `electron/preload.ts`           | Real `ipcMain`/`contextBridge` wiring — every handler calls a real Core service, never fabricates a response                                                                    |
| `src/App.tsx` / `src/SettingsApp.tsx`                        | Main window / settings window React roots                                                                                                                                       |
| `src/components/*`                                           | `Sidebar`, `ChatPanel`, `MessageBubble`, `Composer`, `VoiceOrb`, `SplashOverlay`                                                                                                |
| `src/lib/markdown.ts`                                        | Real `marked` (GFM) + `highlight.js` + `DOMPurify` pipeline                                                                                                                     |
| `src/lib/apply-tokens.ts`                                    | Applies `@ryper/design-system`'s real tokens as CSS custom properties at runtime — no hand-duplicated values                                                                    |
| `electron/voice-bootstrap.ts`                                | `bootstrapVoice()` — assembles the complete real `@ryper/voice-engine` stack (Phase 13)                                                                                         |
| `electron/voice-pipeline.ts`                                 | `VoicePipeline` — real turn orchestration; see `docs/adr/0015` for why it uses `ConversationEngine`, not `AudioPipelineManager`                                                 |
| `electron/voice-commands.ts`                                 | Real voice command handlers over `CapabilityManager`/`WindowsAdapter` (open/close app, volume, mute, media transport)                                                           |
| `electron/memory-bootstrap.ts`                               | `bootstrapMemoryManager()` — the first production `@ryper/memory-system` `MemoryManager` assembly in any shell                                                                  |
| `electron/audio-bridge.ts`                                   | `RendererAudioBridge` — the real Phase 13.6 audio bridge; `UnavailableAudioBridge` remains as the honest no-window fallback                                                     |
| `electron/audio-ipc-contract.ts`                             | Typed main↔renderer audio IPC channel contract (Phase 13.6)                                                                                                                     |
| `src/audio/*`                                                | Real `getUserMedia`/`AudioContext` capture, playback, device enumeration, and dispatch (Phase 13.6)                                                                             |
| `electron/reference-voice-runtime-provider.ts`               | `ReferenceVoiceRuntimeProvider` — the honest last-resort fallback when no real STT/TTS binary+model is detected installed (Phase 13.7)                                          |
| `electron/voice-model-provisioning.ts`                       | Real, on-disk Whisper/Piper detection + `ModelRegistry` registration, prioritized over the reference fallback (Phase 13.7)                                                      |
| `core/local-runtime/.../runtime-providers/whisper-cpp.ts`    | Real whisper.cpp CLI-backed `LocalRuntimeProvider` (ASR) (Phase 13.7)                                                                                                           |
| `core/local-runtime/.../runtime-providers/piper.ts`          | Real Piper CLI-backed `LocalRuntimeProvider` (TTS) (Phase 13.7)                                                                                                                 |
| `core/local-runtime/.../runtime-providers/process-runner.ts` | Real, injectable child-process abstraction backing both of the above (Phase 13.7)                                                                                               |
| `core/voice-engine/.../tts/sentence-splitter.ts`             | Pure sentence-splitting for real sentence-level TTS chunking (Phase 13.7)                                                                                                       |
| `electron/ai-orchestrator-bootstrap.ts`                      | `bootstrapAIOrchestrator()` — assembles a real `AIOrchestrator`; as of Phase 13.9, wires a real local LLM (or explicit cloud) ahead of the heuristic fallback (`docs/adr/0020`) |
| `electron/llm-model-provisioning.ts`                         | Real, on-disk `llama-server` detection + real process lifecycle management (start/health-check/stop) (Phase 13.9)                                                               |
| `core/ai-engine/.../providers/node-fetch.ts`                 | Real Node `fetch()`-backed `HttpFetch` implementation for every AI provider (Phase 13.9)                                                                                        |
| `core/ai-engine/.../tool-calling/validation.ts`              | Real, structural tool-argument schema validation, wired into `ToolRegistry.invoke()` (Phase 13.9)                                                                               |
| `electron/desktop-tools.ts`                                  | Real `ToolDefinition`s for `AIOrchestrator`'s tool-calling loop, backed by `desktop-actions.ts`                                                                                 |
| `electron/desktop-actions.ts`                                | The one real implementation shared by `voice-commands.ts` and `desktop-tools.ts` — not duplicated                                                                               |
| `electron/heuristic-ai-provider.ts`                          | `HeuristicToolCallingProvider` — explicitly **not a language model**; the real harness `AIOrchestrator` runs against today                                                      |

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on
  every `BrowserWindow` — the renderer never has direct Node/Electron
  API access, only what `preload.ts` explicitly exposes via
  `contextBridge`.
- A strict `Content-Security-Policy` meta tag on both HTML entry points.
- Every markdown-rendered message is sanitized with `DOMPurify` before
  being set as `innerHTML` — model output is untrusted input.
- The default `ConsentPrompt` passed to `bootstrapCore` denies every
  capability request (`async () => false`) until a real UI-backed
  consent prompt is wired up — matches `@ryper/windows-agent`'s
  deny-by-default pattern; silence means "no," not "yes."
