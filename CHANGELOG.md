# Changelog

All notable changes to RYPER AI OS are recorded here, phase by phase.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
dates are omitted since phases are the unit of record, not calendar
time. See [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) for full
detail behind every entry below, and [`docs/adr/`](docs/adr/) for the
reasoning behind any decision marked with an ADR reference.

## [Unreleased] — Real Windows verification phase (this sandbox: environment-blocked; one genuine cross-platform bug found and fixed)

This phase's actual objective — running the real-hardware suites and manually verifying the Electron
app against real Windows behavior — **could not be performed in this environment**: this sandbox is a
headless Linux (Ubuntu 24.04) container, not Windows, with no `C:\` filesystem, no real audio
subsystem (`/dev/snd` absent), no installed browsers, no display server, and no real `llama-server`
binary or GGUF model. `process.platform` reports `"linux"`. None of the "REAL WINDOWS CAPABILITIES
VERIFIED" claims below exist — see the full structured report delivered in-conversation for the
complete honest breakdown (sections A–J).

### Fixed

- **Real, platform-independent production bug in `LlamaServerManager.start()`**: found while running
  `llm-runtime.real.test.ts` with the requested (non-existent-on-this-machine) binary/model paths. A
  genuine process spawn failure (`ProcessHandle.result` _rejecting_ — real Node.js behavior for e.g.
  `ENOENT`, identical on Windows or Linux) was never observed by `start()`'s readiness loop, which only
  attached a resolution handler to `handle.result`. This caused (1) the loop to poll a health endpoint
  that could never succeed for the _entire_ `readyTimeoutMs` (60s) instead of failing immediately, (2)
  an unhandled promise rejection, and (3) a misleading final error ("did not become ready") that hides
  the real cause. This would reproduce identically on real Windows with any wrong/missing binary path —
  it is not an artifact of this sandbox. Fixed by attaching a rejection handler that fails `start()`
  immediately with the real underlying error message.

### Added — tests

- `llm-model-provisioning.test.ts`: one new test reproducing the exact spawn-rejection scenario via a
  fake `ProcessRunner` whose `result` promise rejects (matching `process-runner.ts`'s real contract) —
  proven to fail (5s timeout + unhandled rejection) before the fix and pass in ~500ms after.

### Certification

Full build, full `eslint --max-warnings=0`, full `prettier --check`, and the complete Vitest suite all
clean: **214 test files / 1281 tests passing, 5 files / 12 tests correctly skipped**. This phase found
and fixed exactly one genuine bug; it did **not** perform, and cannot claim, any real Windows hardware
verification. RC3/production-ready is explicitly not declared.

## [Unreleased] — Default browser preference, and the last remaining untested wiring layer

### Added

- **Real, persistent "Default browser" setting** (`AppSettings.preferredBrowserId`, a new dropdown in
  `SettingsApp.tsx`): `open_url`/`open_application`/`open_this`/`smart_open` now consult it whenever
  the request itself doesn't name a browser. An explicitly-named browser always still wins, and a
  configured preference that turns out not to be installed degrades gracefully to the system default
  (logged, and honestly reflected in the response message) rather than failing the whole open — the
  user never typed that browser name themselves, so a stale preference shouldn't block the request.
  Threaded end-to-end through both bootstrap paths (`ai-orchestrator-bootstrap.ts` for AI tool calls,
  `voice-bootstrap.ts` for voice commands) via a new `SettingsStore.getCached()` synchronous accessor,
  read live on every call rather than captured once at startup.
- `ipc-handlers.test.ts` (new file) — **closes the last item on the running "genuinely open" list**:
  `registerIpcHandlers`'s top-level IPC wiring had no direct test, only the pure logic each handler
  delegates to. Rather than leaving this as a permanent gap, `vi.mock("electron")` replaces the
  `ipcMain` singleton with an in-memory handler registry, and every test then runs against a real
  `bootstrapCore()`-built core — not further mocks — exercising `sendMessage` end-to-end,
  `getCurrentReference`'s real timestamp-stripping, `cancelTurn`'s no-op-on-unknown-id safety,
  `deleteMessage`'s real persistence, and `selectAudioDevice`'s honest rejection of an unknown device
  id.

### Added — tests

- `desktop-actions-preferred-browser.test.ts` (new file, 7 tests) — real harness (the same in-memory
  reference `WindowsSystemApi` other `desktop-actions` tests use, seeded with only Edge "installed"):
  preference-wins-when-installed, preference-degrades-to-default-when-not, explicit-browser-always-wins,
  and an explicit uninstalled browser still failing loudly.
- `settings-store.test.ts`: 3 new tests for `preferredBrowserId` persistence, sanitization of a
  malformed on-disk value, and the new `getCached()` accessor.
- `ipc-handlers.test.ts` (new file, 8 tests, see above).

### Certification

Full build, full `eslint --max-warnings=0`, full `prettier --check`, and the complete Vitest suite all
clean: **214 test files / 1280 tests passing, 5 files / 12 tests correctly skipped**. No real Windows
hardware verification performed.

## [Unreleased] — Accessibility: keyboard/screen-reader operability for real, previously-untested UI

### Fixed

- **Real gap in a destructive-action confirmation dialog**: the power
  confirmation modal (`ConfirmationDialog.tsx`) had no focus
  management at all — a keyboard or screen-reader user could tab
  straight past a real "shut down your computer?" prompt without ever
  landing on it, and there was no way to dismiss it except clicking a
  button. Focus now moves to Deny (the safe default) the instant a
  request appears, Tab/Shift+Tab are trapped between the two real
  buttons so focus can't silently escape to background UI, and Escape
  denies — matching the same "cancel is the safe default" principle as
  the Deny button itself.
- **Real gaps closed elsewhere**: `VoiceOrb`'s button had no accessible
  name at all (the state caption was a separate, unassociated `<span>`)
  and state transitions (idle → listening → thinking → speaking, or a
  connection drop) were never announced to screen reader users;
  `Composer`'s message textarea, `Sidebar`'s search box, and its inline
  rename input relied on `placeholder` alone, which isn't reliably
  read as a label; `ChatPanel`'s message list had no `role="log"`, so
  an arriving reply was never announced.

### Added — tests (previously-untested components)

- `ConfirmationDialog.test.tsx` (new file) — **this component had zero
  tests before this pass**, despite gating real destructive actions:
  covers the render-nothing-until-requested baseline, real
  title/message rendering, initial focus landing on Deny, Escape
  denying, the Tab/Shift+Tab focus trap, and Approve sending a real
  approved response.
- `VoiceOrb.test.tsx`: two new tests confirming the button's accessible
  name matches the visible state/connection caption.

### Certification

Full build, full `eslint --max-warnings=0`, full `prettier --check`,
and the complete Vitest suite all clean: **212 test files / 1262 tests
passing, 5 files / 12 tests correctly skipped**. No existing test
needed modification beyond the two `VoiceOrb` additions. No real
screen-reader (NVDA/JAWS/Narrator) verification was performed — these
are standard ARIA patterns implemented and exercised via jsdom/RTL, not
confirmed against actual assistive technology.

## [Unreleased] — Real output-device routing (was silently broken, not just undisclosed)

### Fixed

- **Real, silent bug**: selecting a non-default speaker in Settings had
  no effect on where TTS audio actually played. `audio-bridge.ts`
  correctly sent the selected `deviceId` over IPC to the renderer, but
  `src/audio/index.ts`'s `play` command handler destructured only
  `{ requestId }` from the payload — `deviceId` was silently discarded,
  and playback always went through the browser's plain
  `AudioContext.destination`, which has no way to target a specific
  sink. The UI implied device selection worked; it didn't, and gave no
  indication either way.

### Added

- `playback-client.ts`: `createPlaybackSession()` now accepts a real
  `deviceId` and routes the Web Audio graph through a
  `MediaStreamAudioDestinationNode` → hidden `<audio>` element via the
  real, standard `HTMLMediaElement.setSinkId()` — the correct, well-
  supported technique for targeting a non-default output device from
  a raw Web Audio graph (`AudioContext` itself has no sink-selection
  API in this TypeScript DOM lib version). If routing fails or isn't
  supported by the runtime, playback honestly falls back to the
  default device and reports why via a new `onSinkRoutingFailed`
  callback — never silently claims the selected device was used.
- `PlayResult.sinkRoutingFailed` / `AudioStatusPayload.outputRoutingWarning`
  carry that reason all the way to `SettingsApp.tsx`, which now shows
  it next to the speaker selector when routing didn't take effect.
  Cleared the moment a different device is selected, so a stale
  warning from a previous device never lingers.
- `voice-bootstrap.ts`'s `VoiceBundle` now exposes the real
  `RendererAudioBridge` instance (when a renderer exists) so
  `ipc-handlers.ts` can read this state.

### Added — tests

- `playback-client-sink-routing.test.ts` (new file) — **the first test
  coverage `playback-client.ts` has ever had**: routes via a real fake
  `setSinkId`/`Audio`/`AudioContext` graph, verifies the no-device and
  `"default"` cases skip routing entirely, verifies both an
  unsupported-runtime and a rejected-`setSinkId` case fall back
  honestly and report why, and verifies `stop()` actually pauses the
  routed sink element.

### Certification

Full build, full `eslint --max-warnings=0`, full `prettier --check`,
and the complete Vitest suite all clean: **211 test files / 1254 tests
passing, 5 files / 12 tests correctly skipped**. No existing test
needed modification. No real Windows/Electron hardware verification
performed — `HTMLMediaElement.setSinkId()`'s actual behavior on the
target Electron/Chromium version and real Windows audio devices is
**not verified**; this fix is real, standards-based code exercised
against a faithful fake, not a hardware-confirmed capability.

## [Unreleased] — Real tool/error/cancellation visibility, voice-turn history, and contextual-reference UI

A follow-on Tier 1 UI pass, still implementation-focused (Phase A) —
no hardware verification, no certification run, no RC claim. Closed
several real gaps found by inspecting the actual repository rather
than trusting prior summaries.

### Fixed

- **Real, silent gaps closed in text chat**: `text-chat.ts` consumed
  the `AIOrchestrator`'s `tool_call`/`tool_result` events but only
  logged them — the UI had no idea a tool ran, whether it succeeded,
  or what it did. A rejected `sendMessage()` call also left the
  composer's "sending" spinner reset with nothing else shown — a
  genuine AI/tool failure was invisible. Neither had a real
  cancellation path.
- **Real gap closed in voice**: a completed voice turn was spoken via
  TTS and recorded only into `VoiceContextManager`'s long-term memory
  — nothing about it ever appeared in the chat window's persisted
  conversation history, and `askAIOrchestrator` discarded
  `tool_call`/`tool_result` events the same way the pre-fix text path
  did.
- **Real gap closed in the contextual-reference feature**: the backend
  `ContextReferenceTracker` (used by `open_this`/`play_this`) was fully
  wired to `open_file`/`open_url`/`open_folder` etc., but had zero test
  coverage and no UI surface — a user had no way to know what "open
  this" would resolve to before saying it.

### Added

- `tool-activity.ts` — shared, redacting tool-call/result summarizer
  (`createToolActivityCollector`) used identically by both `text-
chat.ts` and `voice-pipeline.ts`, so a tool call made by typing and
  one made by voice are described the same way in history. Keys that
  look like secrets/credentials are redacted; long payloads truncated.
- `cancelTurn` IPC channel + per-turn `AbortController` registry in
  `ipc-handlers.ts` — a typed or spoken turn can now actually be
  cancelled mid-flight, reporting a clean `cancelled: true` result
  rather than a rejected promise.
- `ConversationStore.getOrCreateByTitle()` and a new
  `voice-turn-recorder.ts` (`createVoiceTurnRecorder`) — voice turns
  are now persisted into a real, visible "Voice" conversation via the
  same store text chat uses, with a `conversationUpdated` IPC push so
  an open chat window refreshes live. Deliberately factored out of
  `main.ts` as a pure, dependency-injected function (no Electron
  import) so it's unit-testable without mocking `app`/`BrowserWindow`.
- `getCurrentReference` IPC query + `useCurrentReference()` hook + a
  quiet chip in `ChatPanel` ("Referring to this file: report.pdf") —
  the first UI surface for the contextual-reference feature. Only ever
  renders a real, backend-set reference; never fabricates a label.
- Renderer: real error banner (dismissible) and a Cancel control on
  `ChatPanel`; `MessageBubble` renders a collapsible, redacted
  tool-activity disclosure and a "cancelled by you" note.

### Added — tests (closing pre-existing coverage gaps, not just new code)

- `text-chat.test.ts`: tool-activity capture, secret redaction,
  cancellation.
- `conversation-store.test.ts`: `getOrCreateByTitle()`,
  `appendMessage()`'s toolActivity/cancelled persistence.
- `voice-pipeline-tool-activity.test.ts` (new file): voice-triggered
  tool calls captured/redacted identically to text; command-router
  turns correctly report empty tool activity.
- `voice-turn-recorder.test.ts` (new file): correct find-or-create +
  ordered append, tool-activity passthrough, notify-on-success,
  conversation reuse across turns, and two failure-swallowing cases.
- `context-reference.test.ts` (new file) — **`ContextReferenceTracker`
  had no tests at all before this**, despite being real, load-bearing
  logic: set/get, replace-not-merge, TTL expiry (with actual clearing,
  not just filtered reads), explicit `clear()`, default TTL.
- `describe-reference.test.ts` (new file): the UI's reference-label
  formatter — name/path/url fallback order, per-type wording, never
  fabricates a label.
- `ChatPanel.test.tsx` (new file) — **the first test in this codebase
  to mock the `window.ryper` bridge**, opening that pattern up for
  future component tests: empty state, message loading, the
  context-reference chip (present and absent), a real failed-send
  error banner, and the Cancel control's wiring to `cancelTurn`.

### Certification

Full build (`tsc --build`), full `eslint --max-warnings=0`, full
`prettier --check`, and the complete Vitest suite all clean:
**210 test files / 1247 tests passing, 5 files / 12 tests correctly
skipped** (opt-in real-hardware suites). No real Windows/Electron
hardware verification was performed in this pass.

### Known gaps, disclosed rather than hidden

- `main.ts`'s IPC wiring itself (`startVoiceTurn`'s call into
  `recordVoiceTurn`, the `getCurrentReference` handler) has no direct
  test — only the pure logic each delegates to
  (`createVoiceTurnRecorder`, `ContextReferenceTracker`) is unit
  tested. `main.ts` isn't currently structured for isolated testing
  (it imports `electron` directly and constructs real
  `BrowserWindow`s); building that harness is a separate effort.
- No persistent "preferred browser" setting exists — current per-
  request override / system-default behavior is correct per the "never
  silently substitute a browser" requirement, so this wasn't treated as
  a gap, but no dedicated settings UI was added for it either.
- The broader Tier 1 sub-areas not touched in this pass: a full audio-
  device settings UX polish pass, and a systematic line-by-line review
  against every remaining lettered item in the original UI brief
  (accessibility labels beyond what already existed, notification UX
  beyond existing wiring, etc.) — these were not surveyed exhaustively;
  only the gaps actually found by inspection are listed above.

## [Unreleased] — Real test coverage for the desktop UI integration pass

Closed the honest gap flagged in the previous entry: no dedicated
tests existed yet for `text-chat.ts`, `confirmation-bridge.ts`, or the
shared `tryResolvePowerConfirmation`.

### Added

- `text-chat.test.ts`, `confirmation-bridge.test.ts`,
  `desktop-intent-patterns.test.ts` — real tests against the actual
  `AIOrchestrator`/`ToolRegistry`/`WindowsAdapter` chain and the real
  confirmation-bridge round trip, not stand-ins.

### Fixed

- **Real bug caught by the new tests**: the shutdown/restart intent
  patterns accepted "shut down the pc" but not "shut down my pc" —
  every prior test constructed the intent match directly, bypassing
  the regex entirely. Fixed to accept "my"/"this"/no determiner.

### Certification

**205 test files / 1216 tests passing** (up from 202/1185 — 3 new test
files, 31 new tests), 5 files / 12 tests correctly skipped, build/
lint/format all clean.

## [Unreleased] — Tier 1 pass: real desktop UI integration

Built as an implementation-only pass, then certified afterward on
request. Full rationale in `docs/adr/0032`.

### Fixed

- **Real, severe bug**: the desktop app's text chat
  (`sendTurn`/`regenerateMessage`) called `@ryper/web-shell`'s
  `ConversationEngine`, constructed with no real model providers —
  every typed message received a literal `"[local model] <message>"`
  echo back, with no access to any real AI model, tool, or capability.
  Voice was unaffected; text was completely disconnected from the real
  backend. Fixed by routing text chat through the same real, shared
  `AIOrchestrator` instance voice uses (`text-chat.ts`'s `runTextTurn`).
- **Real, long-repeated gap closed**: `CapabilityBroker`'s consent
  prompt and `DestructiveActionGate`'s confirmer both previously
  defaulted to deny-everything with no real UI to ask through. Added a
  real main<->renderer confirmation dialog (`confirmation-bridge.ts`, a
  new `ConfirmationDialog` component, new IPC channels) wired as the
  real confirmer for both.
- `searchMemory` rewired from a now-dead `ConversationEngine` buffer to
  the real AI Engine `SessionManager`'s per-session history.

### Added

- `VoiceBundle` now exposes the shared `AIOrchestrator`, the shared
  `PowerConfirmationManager`/`ContextReferenceTracker`, and the AI
  Engine's `SessionManager` — so text chat and voice genuinely share
  tool-calling, power-confirmation, and contextual-reference state.
- `tryResolvePowerConfirmation()` extracted into a shared, exported
  function (`power-confirmation.ts`) used by both `VoicePipeline` and
  the new text-chat path — a typed "yes" now resolves a pending power
  confirmation exactly like a spoken one.

### Certification

Full cold-state certification run: no test failed against these
changes without modification (every relevant existing test file
passed as-is). **202 test files / 1185 tests passing, 5 files / 12
tests correctly skipped**, build/lint/format clean. No dedicated test
coverage was added for the new code in this pass (`text-chat.ts`,
`confirmation-bridge.ts`, the shared `tryResolvePowerConfirmation`,
the rewired `searchMemory`) — a real, disclosed gap for the next
testing phase. No real Windows/Electron hardware verification was
performed.

## [Unreleased] — Tier 1 implementation-only pass: power-action confirmation, contextual "open this", cancellation bug fix

**Testing intentionally deferred to the next phase** — this pass ran
no tests/lint/format/certification, per its own explicit scope. Full
rationale in `docs/adr/0031`.

### Added

- Real, two-phase power-action confirmation: `shutdown`/`restart`/
  `sleep` register a pending confirmation and ask the user to confirm;
  only a genuine "yes" (matched before normal intent detection)
  actually executes the real action, still through the existing,
  unchanged `DestructiveActionGate`. Distinguishes confirmed/denied/
  cancelled/expired/not-pending.
- `list_browsers`/`launch_browser` AI tools (were implemented at the
  capability layer previously but never exposed as tools).
- Contextual "open this"/"play this": a new `ContextReferenceTracker`
  records the real target of the last successful open action; a new
  `open_this` tool/handler reads it and fails honestly when nothing is
  set.

### Fixed

- **Real, serious bug**: `ToolRegistry.invoke()` never checked its own
  cancellation signal before executing a tool — a cancelled turn could
  still execute a destructive tool call (shutdown, delete_file) in
  full. Fixed with a structural check before every tool execution.
- `buildToolResult()` could silently produce `content: undefined` for
  any tool with no explicit return value, violating its own `string`
  type at runtime. Now explicit.

## [Unreleased] — Tier 1 pass: universal open, browser resolution, power management, lifecycle hardening

Built as an implementation-only pass, then certified afterward on
request. Full rationale in `docs/adr/0030`.

### Added

- Universal open capability: `open_url` (with real per-browser
  resolution), `open_file`, `open_folder`, `smart_open`
  (deterministic, filesystem-verified classification), `list_browsers`,
  `launch_browser`.
- `BrowserResolver`: real, multi-tier discovery (installed-apps list →
  Windows "App Paths" registry → known install-location probing) for
  Edge/Chrome/Firefox/Brave. Never substitutes a different browser
  than the one requested.
- OS power management: `shutdown`/`restart`/`sleep`, new
  `power_management` capability domain, new `system.power`
  `Capability`, `PowerManager` (reuses the existing
  `DestructiveActionGate`, with an explicit cancellation-race fix).
- `PathResolver`: quote stripping, narrow `%USERPROFILE%` expansion,
  known-folder resolution.

### Fixed

- **Real, serious, previously-undiscovered bug**: the voice session
  never returned to `idle` after a failed/cancelled turn, so every
  turn after the first failure threw immediately and permanently broke
  the pipeline until process restart. Fixed in both
  `AudioPipelineManager` and `VoicePipeline`.
- The literal `chrome: "microsoft.edge"` bug in `KNOWN_APP_IDS` —
  removed; browser resolution now goes through `BrowserResolver`.
- `README.md`'s inaccurate claim that the real LLM provider "replaces"
  `HeuristicToolCallingProvider` (it remains the real, always-registered
  fallback) — corrected.

### Notes

No raw shell/PowerShell/command-execution AI tool was added — every
new capability is a typed, bounded operation, consistent with the rest
of this codebase.

### Certification

Full cold-state certification run: 3 pre-existing tests updated to
match correctly-changed behavior (none weakened — an unrecognized
"open" target now genuinely attempts real classification instead of
failing outright; shutdown/restart/sleep changed from honest stubs to
real, gated capabilities), plus one new test confirming a power action
succeeds once a real confirmer approves it. **202 test files / 1185
tests passing, 5 files / 12 tests correctly skipped**, build/lint/
format clean.

## [Unreleased] — Tier 1 completion pass, continued further: retry parity, Windows/filesystem tools, integration tests, STT/TTS lifecycle fixes

Closed all four items left open at the end of the prior pass. Full
rationale in `docs/adr/0029`.

### Added

- `VoicePipeline.askAIOrchestrator` now retries transient AI Engine
  failures via `retryWithBackoff` + the `recovering` session state,
  closing the retry asymmetry with `AudioPipelineManager` noted in
  `docs/adr/0028`.
- 18 new real AI tools backed by `@ryper/windows-agent`'s
  `WindowManager`/`FileManager` (previously zero AI tool surface
  despite being fully implemented): `list_windows`,
  `get_active_window`, `focus_window`, `minimize_window`,
  `maximize_window`, `restore_window`, `snap_window`, `switch_window`,
  `list_files`, `read_file`, `search_files`, `get_folder_path`,
  `list_recent_files`, `create_folder`, `copy_file`, `move_file`,
  `rename_file`, `delete_file` (routed through the real, deny-by-default
  `DestructiveActionGate`). Matching voice-command intent patterns and
  handlers registered in `voice-commands.ts`.
- `platform/desktop-app/test/voice-to-tools-integration.test.ts`: real
  cross-subsystem integration tests using this repo's actual
  production wiring end to end (`bootstrapAIOrchestrator`, real
  `ToolRegistry`, real `HeuristicToolCallingProvider`, real
  `CapabilityManager` + `WindowsAdapter`, real `VoicePipeline`).

### Fixed

- **Real design mistake caught before shipping**: filesystem tools
  briefly had `requiredCapability` set directly on their
  `ToolDefinition`s in addition to the domain-level requirement,
  stacking two different, redundant authorization gates. Removed;
  the domain-level self-granting gate (matching every other desktop
  tool) is the single real mechanism.
- An STT provider's empty/whitespace-only `final` transcript
  previously reached the AI Engine as a real request instead of being
  treated as "no result at all."
- A command handler's empty `spokenResponse` (`?? "Done."` doesn't
  catch `""`) previously reached `speak()` and was "spoken" as
  literally nothing — no audio, no error, no fallback. Now
  `?.trim() || "Done."`.
- `AudioPipelineManager`'s AI-Engine-empty-response guard checked
  `.length` instead of `.trim().length` (unlike `VoicePipeline`, which
  already did this correctly), letting a whitespace-only response hit
  the same silent-TTS gap. Aligned.

### Certification

202 test files / 1184 tests passing (up from 199/1156 — net +3 test
files, +28 tests; 5 files / 12 tests still correctly skipped),
build/lint/format clean.

**A real architectural finding, not a bug**: `AIOrchestrator`'s
tool-calling loop is only reachable in today's real wiring via a
compound/multi-step voice command or a fully-unmatched conversational
transcript — any single-command transcript is always intercepted by
`VoiceCommandRouter`'s fast path first. Documented in `docs/adr/0029`;
matters for anyone wiring a real LLM into this orchestrator later.

**TIER 1 — closer to complete, but still not fully done.** See
`docs/PROJECT_STATE.md` for the honest list of what remains.

## [Unreleased] — Tier 1 completion pass, continued: expanded voice state machine

Continuing the Tier 1 mission, closed the first named gap from the
prior partial pass's verdict: the voice state machine.

### Added

- `VoiceSessionState` (`core/voice-engine/src/types.ts`) expanded from
  6 states to 10: `idle | listening | transcribing | thinking |
tool_execution | speaking | interrupted | recovering | cancelled |
error`. See `docs/adr/0028` for full rationale and semantics.
- `transcribing`: entered at the real VAD-endpointing boundary (new
  `markCaptureEnded()` in both `AudioPipelineManager` and
  `VoicePipeline`), closing a real gap where the session stayed
  `listening` through the whole STT-finalization window after the mic
  had already closed.
- `tool_execution`: a real sub-state of `thinking`, driven by the
  orchestrator's own already-existing `tool_call`/`tool_result` stream
  events, now surfaced to voice session state for the first time.
- `interrupted`: the real, automatic barge-in path
  (`VoicePipeline.monitorForBargeIn()`, via new `handleBargeIn()`) now
  lands here instead of `cancelled`. The explicit-stop path
  (`interrupt()`, used by the desktop app's stop button/IPC call) is
  unchanged and still lands on `cancelled`.
- `recovering`: driven by a new, optional, additive `onRetry` hook on
  `@ryper/ai-engine`'s `retryWithBackoff` (every existing caller
  unaffected), fired on a real retryable failure before the backoff
  sleep.

### Changed

- `processing` renamed to `thinking` for clarity against the new,
  more specific states above.

### Fixed

- **Real pre-existing bug**: both pipelines' `runTurn()` catch blocks
  gated their failure-recovery transition on a stale local snapshot
  captured before the turn began, which was always `"idle"` — silently
  making the transition dead code. A genuinely failed voice turn never
  actually reset session state to `cancelled`/`error`; it stayed stuck
  mid-turn indefinitely. Fixed by reading the live snapshot instead, in
  both `AudioPipelineManager` and `VoicePipeline`.

### Certification

199 test files / 1156 tests passing (up from 198/1146 — net +1 test
file, +10 tests; 5 files / 12 tests still correctly skipped as
opt-in real-Windows-hardware tests), build/lint/format clean.

**TIER 1 — STILL NOT COMPLETE.** Remaining real gaps: Windows Platform
Agent AI tool surface (window management, file/folder), cross-subsystem
voice→AI→tools→TTS integration tests, exhaustive STT/TTS lifecycle
edge-case auditing, and a newly-identified real asymmetry (the
electron `VoicePipeline` doesn't retry its AI Engine call at all, so
`recovering` is valid but currently unreached there). See
`docs/PROJECT_STATE.md` for full detail.

## [Unreleased] — Tier 1 completion pass: actor-identity fix (partial)

A broader mission to bring Tier 1 (AI Engine/Orchestrator, Windows
Platform Agent, Voice Pipeline) to 100% implementation completeness
was requested. Given its genuine scope, a full pass was not attempted
in one session. One concrete, previously-documented architectural gap
(`docs/adr/0021`'s known follow-up) was fixed and tested.

### Fixed

- `AIOrchestrator.sendMessage()` now explicitly passes `actorId:
"ai-orchestrator"` into `toolRegistry.invoke()`, aligning it with
  the actor `desktop-tools.ts` already uses for the same logical
  action's `CapabilityManager` self-granting flow. A capability
  already granted through that real flow is now correctly recognized
  by `ToolRegistry`'s own separate `requiredCapability` check on
  subsequent calls. Investigated `@ryper/plugin-runtime`'s existing
  precedent for this pattern before deciding on this fix.
- Updated `desktop-tools-capability-broker.test.ts` and
  `tool-calling.real.test.ts` to use the aligned actor.

### Honestly documented residual limitation

The first call to a `requiredCapability`-gated tool can still be
denied before `execute()` runs, since `assertGranted` is a pure check
with no self-granting path — by design, mirroring
`@ryper/plugin-runtime`. A real pre-grant/onboarding mechanism for AI
tool actors would close this fully; not built in this pass.

### Certification

198 test files / 1146 tests passing (unchanged counts), lint and
format clean.

**TIER 1 — NOT YET COMPLETE.** See `docs/PROJECT_STATE.md`'s "Tier 1
completion pass" section for the full, honest scope of what remains.

## [Unreleased] — Phase 13.15 — Real Windows desktop capability expansion (audio)

### `volume_up` — CONFIRMED on real hardware

The user re-ran the boundary-corrected
`audio-capability.real.test.ts` on real Windows 11 (i5-13450HX, RTX
4050 Laptop GPU, real llama-server, real Qwen3-8B-Q4_K_M.gguf): **1
file / 1 test passed.** Real, measured evidence: original volume
100%; test baseline set to 50% and independently confirmed; real
Qwen3 produced `volume_up`; `CapabilityBroker` granted
`automation.execute`; the real Windows audio manager set volume to
60% (a genuine +10 from the 50% baseline); an independent real volume
read confirmed 60%; `tool_result.ok === true`; real Qwen3 reported the
increase in its final reply; the original 100% volume was restored and
independently confirmed. This is the first physically-verified (not
just "no error," not a model's narration) confirmation that
`volume_up` works end to end on real Windows hardware, through the
real `IAudioEndpointVolume` COM interop this phase added.

**Scope — only `volume_up` is confirmed this way.**
`volume_down`/`set_volume`/`mute`/`unmute` share the same underlying
COM implementation but have not themselves been independently,
physically confirmed. `mediaControl` uses a different technique
(`keybd_event`) and remains unverified — see below.

### Investigation (before writing any code)

Read `windows-adapter.ts`'s full dispatch table and
`powershell-system-api.ts` end to end. Confirmed already-real:
application_control, filesystem, clipboard, device_information,
registry, background_services, process_management, display. Found two
real gaps matching Phase 13.14's exact stub pattern: audio's
`getVolume`/`setVolume`/`getMute`/`setMute`/`setDefaultAudioDevice`/
`mediaControl` were literal PowerShell comments — and critically, the
already-shipped `volume_up`/`set_volume`/`mute`/`media_*` AI tools
already called them, so this was live, silently-broken functionality;
window management has the same stub pattern but zero AI tool surface
to reach it.

### Added (real implementations)

- `getVolume`/`setVolume`/`getMute`/`setMute` via a genuinely native
  `Add-Type` C# projection of WASAPI's `IAudioEndpointVolume` COM
  interface — no third-party module, chosen because the already-shipped
  exact-level tools require it.
- `mediaControl` (play/pause/next/previous/stop) via native
  `user32.dll` `keybd_event` virtual-key presses.
- `audio` domain now requires `automation.execute` (reusing the
  existing capability type), activating real `CapabilityBroker`
  gating for audio actions for the first time — volume/media are now
  correctly denied by default on real Windows until a consent UI
  exists, matching the notifications precedent (not a regression).
- ADR `docs/adr/0024`.

### Explicitly deferred, with documented reasoning (not guessed at)

- `setDefaultAudioDevice`: no reliable native technique exists (only
  the undocumented, version-unstable `IPolicyConfig` interface, or a
  third-party module). Now throws a clear, honest error without ever
  invoking PowerShell.
- Window management: real Win32 APIs exist and are arguably
  lower-risk than the audio COM work implemented here, but zero AI
  tool surface exists yet.
- Display brightness: no interface method exists at all; WMI
  brightness support is unreliable across hardware.

### Tests

- 10 new `powershell-system-api.test.ts` tests (command construction,
  clamping, honest deferral, correct virtual-key codes, explicit
  assertions that no third-party module or undocumented interface is
  ever referenced).
- 2 new `desktop-tools-capability-broker.test.ts` tests (real
  deny/approve evidence for `volume_up`).
- New opt-in real-hardware test `audio-capability.real.test.ts` — reads
  real system volume before/after the tool call as physical proof, not
  just an exit code.

### Honest risk note

The COM vtable ordering cannot be verified by a unit test — only real
Windows hardware can confirm it's correct. Stated plainly in the ADR
and PROJECT_STATE.md, not hidden.

### Certification

Full cold-state pipeline passes clean. 196 test files / 1125 tests
passing (+12 over Phase 13.14), 4 files / 9 tests correctly skipped
(+1 file/+1 test for the new real audio test). No existing test
weakened.

### Follow-up: real-hardware test boundary fix (volume_up at 100%)

The user's first real-hardware run of `audio-capability.real.test.ts`
found the real COM implementation genuinely working (real tool call,
real broker grant, real WASAPI call, `tool_result.ok === true`,
volume genuinely set to 100), but the test itself failed on a machine
already at 100% volume — `volume_up`'s correct ceiling-clamping
(`Math.min(100, current + 10)`) leaves nothing to observe change at
the boundary, and the test's `after !== before` assertion could never
pass in that state. **Root-caused as a real test design bug, not an
implementation bug** — `setVolume`/`volumeUp`/`volumeDown`'s clamping
was re-inspected end to end at the user's request and found correct
at both the 0% and 100% boundaries, and `mute`/`unmute`'s explicit
(non-toggle) boolean semantics were confirmed idempotent at both
states. No production code changed.

Fixed the test: it now establishes and verifies a real, headroom-
guaranteeing baseline (50%) whenever the real starting volume leaves
no room to prove an increase, asserts the post-tool-call volume is
strictly greater than that verified baseline (not merely
`toBeGreaterThanOrEqual`, which would let a real no-op pass), and
restores the user's real original volume in a `finally` block that
runs whether the test passes or fails.

Added `desktop-actions-volume-boundaries.test.ts` (new, always-run, no
real hardware required): closes the gap that this exact clamping logic
had zero deterministic test coverage before this fix — proves
`volumeUp`/`volumeDown` clamp correctly at both boundaries (including
the exact 100%/0% no-op cases) and that `setVolume`/`mute`/`unmute`
are correctly clamped/idempotent.

197 test files / 1131 tests passing (+1 file / +6 tests), 4 files / 9
tests correctly skipped (unchanged). **Phase 13.15 is still not
declared complete** — the corrected test has not yet been re-run on
real hardware, and media controls will not be attempted until
`volume_up` is confirmed passing with this fix.

### Media control: implementation + verification strategy design

With `volume_up` confirmed REAL HARDWARE VERIFIED, this covers media
control. `mediaControl()` was already real (native `keybd_event`,
fixed earlier this phase); this is about how to verify it, since
volume's before/after numeric-read strategy doesn't transfer — Windows
only exposes "now playing" state for an app with an _active_ System
Media Transport Controls session, which requires something to actually
be playing on the test machine, a real-world precondition this repo
cannot manufacture without launching a real media application.

Added `getNowPlayingState()` to `WindowsSystemApi`, implemented for
real via `Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager`
(the same OS-level session registry every app's media transport
controls already read from), using the standard PowerShell
`AsTask`-reflection technique for WinRT async methods. Same honest
risk note as the volume COM interop: this reflection can't be proven
correct by a unit test — only real hardware can confirm it.

`media-control-capability.real.test.ts` (new, opt-in) makes an
explicit two-tier distinction: always-true mechanical proof (real tool
call, real broker grant, `tool_result.ok === true`, real Qwen3 reply)
versus conditionally-true physical proof (observable playback-state/
track-title change), which is only asserted when a real active media
session exists — otherwise the test explicitly logs
`"NOT VERIFIED (<reason>)"` rather than weakening the assertion or
failing spuriously.

Added 3 new `powershell-system-api.test.ts` tests, 4 new
`reference-system-api.test.ts` tests (backed by a real, deterministic
simulated playlist), and 1 new opt-in real test file (2 tests). 197
test files / 1137 tests passing (+6), 5 files / 11 tests correctly
skipped (+1 file/+2 tests). New ADR: `docs/adr/0025`.

**Media control physical verification on real hardware has not yet
been performed.**

### Media control real-hardware run: MECHANICALLY confirmed, physical verification NOT VERIFIED

The user ran `media-control-capability.real.test.ts` on real Windows
11/RTX 4050/Qwen3-8B hardware. All mechanical assertions passed for
all four actions (`media_play`/`media_pause`/`media_next`/
`media_previous`): real Qwen3 tool calls, real `CapabilityBroker`
grants, `tool_result.ok === true`, real Windows action path executed.
**Physical playback verification did not run**, because Windows
reported no active System Media Transport Controls session on the test
machine — exactly the honest "NOT VERIFIED (no active media session)"
outcome the test was designed to report rather than fake. **Media
control is not marked REAL HARDWARE VERIFIED.** No production code
was changed to force a pass. Investigating a real, deterministic
media-session test environment next (see `docs/PROJECT_STATE.md`) —
options considered and a design chosen (a real Edge browser window
using the standard Web `MediaSession` API, which registers a genuine
SMTC session `getNowPlayingState()` already reads for real); the
fixture/harness implementation itself is not yet written.

### Real, deterministic media-session test environment — implemented

Added a real HTML fixture
(`platform/desktop-app/test/fixtures/media-session-fixture.html`)
using the standard Web `MediaSession` API to register a genuine SMTC
session (not a mock, not a simulated session), a real Edge-launching
helper (`platform/desktop-app/test/support/media-session-fixture-launcher.ts`,
using a real `Start-Process`/`Stop-Process` via this repo's existing
`ShellExec` contract), and a new third test in
`media-control-capability.real.test.ts` that establishes this real
session (polled, with a real, bounded 20s timeout) and then asserts
all four physical playback claims hard and unconditionally — with an
honest `"NOT VERIFIED (could not establish...)"` fallback, not a
weakened assertion, if the session can't be established on a given
run. `getNowPlayingState()`/`mediaControl()` themselves were not
modified. Added 3 new always-run unit tests for the launcher's real
PowerShell command construction. New ADR: `docs/adr/0026`.

198 test files / 1140 tests passing (+3), 5 files / 12 tests correctly
skipped. Full cold-state pipeline verified passing.

**Real-hardware confirmation of this new fixture-based test has not
yet been performed.**

### Real-hardware test infrastructure fixes: Edge resolution + fail-fast preflight

A real run surfaced two infrastructure problems, not a RYPER
implementation failure — production media-control code was not
touched. (1) `llmDiagnostics.status` reported `"binary-missing"`
despite correctly-set env vars; investigated and confirmed
`defaultLlamaServerPaths()` is shared, identical code across every
real test file — no separate resolution path existed to fix. Added
`realHardwareLlamaPreflight()`, which logs the exact env var values a
given test process sees and fails in milliseconds, not ~90s, with a
precise reason. (2) The Edge launcher's `Start-Process -FilePath
'msedge.exe'` failed because it wrongly assumed Windows' "App Paths"
registry redirection applies to `Start-Process` — it doesn't
(`Process.Start()` only searches `PATH`; App Paths is a
`ShellExecuteEx`-level mechanism). Fixed with `resolveEdgeExecutable()`:
`RYPER_EDGE_BINARY` -> real registry read -> standard install paths ->
`PATH` fallback -> a clear "test-environment prerequisite, not a RYPER
failure" error if none succeed. No browser substitution (Chrome/
Firefox/Brave) without a separately justified, documented decision —
not attempted here. On the user's specific machine (independently
confirmed: no browser installed at all), the four media-control
physical capabilities remain **NOT VERIFIED** — this fix reports that
honestly rather than manufacturing a result. New ADR: `docs/adr/0027`.

9 new always-run unit tests (5 for the resolver, 4 for the launcher).
198 test files / 1146 tests passing (+6), 5 files / 12 tests correctly
skipped (unchanged). Full cold-state pipeline verified passing.

**Phase 13.15 remains NOT COMPLETE.**

## [Unreleased] — Phase 13.14 — Real notification implementation fix + real tool-result verification

### CONFIRMED on real hardware

The user re-ran `npx vitest run
platform/desktop-app/test/tool-calling.real.test.ts` on real Windows
11 (i5-13450HX, 15.71 GB RAM, RTX 4050 Laptop GPU 4GB VRAM, real
llama-server, real Qwen3-8B-Q4_K_M.gguf) after this phase's fixes: **1
test passed in ~91 seconds.** Real evidence: a real, structurally
valid Qwen3 tool call; a real granted `notifications` capability; a
real native Windows toast notification actually shown; a real,
authoritative `tool_result: {ok: true, content: "Notification shown:
\"Ryper Test\"."}`; and a real, successful final Qwen3 reply. This is
the first genuine, real-hardware confirmation of the complete real
Qwen3 → AIOrchestrator → ToolRegistry → CapabilityBroker → real
Windows action → tool_result → Qwen3 path — for the notifications
capability specifically. See `docs/PROJECT_STATE.md`'s "Phase 13.14
real-hardware verification" section for the scope of what remains
unverified.

### Fixed (real bug, found on real hardware)

- `core/windows-agent/src/powershell-system-api.ts`: `showNotification()`
  called `New-BurntToastNotification` — a cmdlet from the third-party
  BurntToast PowerShell module, which this repo has never installed,
  provisioned, or documented anywhere. On real Windows 11 this is
  exactly the `PowerShell command exited with code 1` failure the user
  hit on real hardware, after real detection, a real capability grant,
  and real `ToolRegistry` invocation had all already succeeded. Now
  uses genuinely Windows-native `Windows.UI.Notifications.
ToastNotificationManager`/`Windows.Data.Xml.Dom.XmlDocument` WinRT
  APIs (no external module), under the AppUserModelID Windows already
  pre-registers for `powershell.exe` — reliable because
  `createNodePowerShellExec()` always launches classic PS 5.1, not
  PS7, whose separate WinRT interop has real gaps BurntToast's
  compiled helper exists to work around. Title/body are now
  XML-escaped before being embedded in the toast payload.

### Fixed (real gap in the test's own success criteria)

- `AIOrchestrator` previously never surfaced a tool's actual `{ok,
content}` result to its own callers — only the model's subsequent
  narration hinted at success/failure. The real Windows run showed
  exactly why this matters: the tool genuinely failed, Qwen3 narrated
  it gracefully, and the old test still reported PASS since it only
  checked for the absence of an unrelated orchestrator `error` event.

### Added

- `StreamEvent` gains a `tool_result` variant, yielded by
  `AIOrchestrator` immediately after `ToolRegistry.invoke()` — the
  real, authoritative result, forwarded to callers (unlike the
  internal-only `tool_call_progress` heartbeat from Phase 13.13).
- `tool-calling.real.test.ts` now asserts directly on
  `toolResultEvent.ok === true`, with a secondary, approximate wording
  check on the final reply retained only as a sanity check on top —
  never a substitute for the authoritative assertion.
- ADR `docs/adr/0023`.

### Tests

- 5 new `powershell-system-api.test.ts` tests: native WinRT command
  construction (explicitly asserting `BurntToast` never appears), the
  pre-registered AUMID, `$ErrorActionPreference`, XML-escaping of
  untrusted content, and real failure propagation.
- 2 new `orchestrator.test.ts` tests: `tool_result` on success, and
  `tool_result{ok:false}` (with no orchestrator `error` event) on a
  caught failure the model narrates gracefully — directly reproducing
  the real failure shape this phase found.

### Certification

Full cold-state pipeline passes clean. 196 test files / 1113 tests
passing (+6 over Phase 13.13), 3 files / 8 tests correctly skipped
(unchanged). No existing test weakened.

## [Unreleased] — Phase 13.13 — Real-hardware tool-calling stall fix (streaming heartbeats + provider-aware timeout)

### Fixed (root cause)

- `core/ai-engine/src/providers/openai-compatible.ts`: `streamChat()`
  accumulated `tool_calls` delta fragments across many SSE chunks but
  never yielded anything for them — only the final chunk (with
  `finish_reason`) ever produced a `StreamEvent`. Since
  `streaming.ts`'s `withTimeout()` is a genuine **inter-event**
  timeout, the entire tool-call generation (prefill + any hidden
  thinking + the full JSON arguments) was invisible to it, appearing
  as one silent gap that real local 8B hardware can exceed even though
  the model and server are both working correctly. This is exactly
  what caused the user's real Windows/Qwen3 run to fail with
  `EngineTimeoutError: no stream event within 30000ms` after real
  detection, real capability registration, and a real granted broker
  decision had already succeeded.
- Also fixed: hidden `reasoning_content` deltas (a thinking model's
  chain-of-thought, on servers that surface it separately) were
  previously ignored entirely — same invisible-gap risk.

### Added

- `StreamEvent` gains a `tool_call_progress` heartbeat variant,
  yielded by `OpenAICompatibleProvider` for every tool-call-argument
  fragment and every `reasoning_content` fragment. Consumed internally
  by `AIOrchestrator` — never forwarded to its own callers, so the
  existing public `StreamEvent` contract is unchanged.
- `AIOrchestratorOptions.localStreamTimeoutMs` — a provider-aware
  timeout used only when the selected provider's `kind === "local"`.
  Defaults to 120s in `ai-orchestrator-bootstrap.ts` (informed by this
  repo's own real 43–49s measurements), configurable via
  `RYPER_LOCAL_LLM_STREAM_TIMEOUT_MS`. Remote/cloud providers keep the
  existing 30s default unchanged — a genuinely hung remote connection
  still fails fast. A secondary safety net, not a substitute for the
  heartbeat fix above.
- `OpenAICompatibleConfig.disableThinkingForToolCalls` — sends
  `chat_template_kwargs: { enable_thinking: false }` only when `tools`
  are present, forwarded through `LlamaCppConfig`, enabled for the
  local llama-cpp provider only (never the explicit-only cloud
  provider).
- ADR `docs/adr/0022`.

### Tests

- Updated the one existing test this broke to reflect the new,
  correct event sequence (not weakened).
- Added a `streaming.ts` regression test proving a long gap survives
  when bridged by progress events but the same total gap with nothing
  yielded still correctly times out.
- Added `orchestrator.test.ts` tests for progress-event containment and
  provider-aware timeout selection.
- Added `openai-compatible.test.ts` tests for the new
  `chat_template_kwargs`/thinking-mode behavior.
- `tool-calling.real.test.ts` now logs explicit evidence for each step
  (real tool call, real broker audit log, real execution, real final
  reply) and documents the `--pool=forks
--poolOptions.forks.singleFork` invocation the user found necessary
  on real Windows.

### Certification

Full cold-state pipeline passes clean. 196 test files / 1107 tests
passing (+6 over Phase 13.12), 3 files / 8 tests correctly skipped
(unchanged). No existing test weakened.

## [Unreleased] — Phase 13.12 — Real structured tool-calling (AIOrchestrator -> ToolRegistry -> CapabilityBroker)

### Added

- `platform/desktop-app/electron/windows-shell-exec.ts`:
  `createNodePowerShellExec()`, a real `child_process.execFile`-backed
  `ShellExec` for `@ryper/windows-agent`'s `PowerShellWindowsSystemApi`
  — closes a gap that had existed since that class was first written
  (nothing ever implemented a real `ShellExec` for it).
- `show_notification` desktop tool (`desktop-tools.ts`/
  `desktop-actions.ts`) — the first tool to set
  `requiredCapability: "notifications"`.
- `platform/desktop-app/test/desktop-tools-capability-broker.test.ts` —
  always-run, no-hardware-needed real coverage proving
  `CapabilityBroker` enforcement genuinely refuses/allows a tool call
  correctly. This enforcement path had zero test coverage before this
  phase.
- `platform/desktop-app/test/tool-calling.real.test.ts` — opt-in, real,
  no-mock integration test: real Qwen3 tool call, real
  `AIOrchestrator`/`ToolRegistry`/`CapabilityBroker`, real
  `powershell.exe`, real round-tripped final reply. Gated on the same
  env vars as `llm-runtime.real.test.ts` plus `process.platform ===
"win32"`.
- ADR `docs/adr/0021`.

### Fixed / Changed (real architecture, not just tests)

- `core-bootstrap.ts`: on `win32`, `createWindowsAdapter()` is now
  given a real `PowerShellWindowsSystemApi` instead of silently
  defaulting to an in-memory fake — **this had been the case even in
  the shipped app on real Windows** until this fix. Also now registers
  `WINDOWS_CAPABILITY_DESCRIPTORS` with `CapabilityManager`, which
  activates real `CapabilityBroker` consent-gating for the
  `notifications`/`filesystem.write`/`automation.execute` domains for
  the first time — **previously, `CapabilityBroker` was never actually
  consulted for any real desktop action, in production or in any
  test.** Because `main.ts`'s real consent prompt always denies (no
  consent UI exists yet), these three domains will now be denied by
  default on real Windows until a consent UI ships — this is the
  architecture's intended fail-closed behavior working correctly for
  the first time, not a regression. Every other domain (audio, app
  control, etc., which have no `requiredCapability`) is unaffected.
- `llm-model-provisioning.ts`: `llama-server` is now launched with
  `--jinja`, required for real Qwen3 tool-call template rendering.

### Known follow-up

A real actor-identity mismatch between `ToolRegistry`'s own broker
check (`"ai-engine"`, since `AIOrchestrator` never overrides it) and
`CapabilityManager`'s self-granting one (`"ai-orchestrator"`) is
documented in `docs/adr/0021` and worked around explicitly (not
silently) in both new tests with a real pre-grant. Not fixed this
phase.

### Certification

Full cold-state pipeline passes clean. 196 test files / 1101 tests
passing (+1 file / +3 tests over Phase 13.11), 3 files / 8 tests
correctly skipped (opt-in real-hardware suites). No existing test
weakened.

## [Unreleased] — Phase 13.11 — Real-hardware integration-test defect fix #2 (cancellation)

### Fixed

- `platform/desktop-app/test/llm-runtime.real.test.ts`: the real
  suite's hand-rolled `httpFetch` (needed because this test talks to a
  real llama-server directly, not through Electron's
  `createNodeHttpFetch()`) forwarded `method`/`headers`/`body` to the
  underlying `fetch()` call but never `init.signal`. The real,
  unmodified `OpenAICompatibleProvider.streamChat()` already passes
  `signal: request.signal` on every request, and the real production
  `createNodeHttpFetch()` adapter already forwards it correctly — only
  the test's separate, duplicate wrapper omitted it. This meant
  `controller.abort()` never reached the real in-flight `fetch()`
  request, so the real cancellation test hung to Vitest's 60-second
  timeout instead of rejecting quickly, caught by the user's real
  Windows/RTX 4050/Qwen3-8B re-run of the suite (with Phase 13.10's
  fix applied). Added the same conditional `signal` spread the
  production adapter already uses. No provider/orchestrator/production
  adapter code changed — this was isolated to the test file.

### Milestone

- The same real-hardware run confirmed, for the first time, that a
  real chat completion round-trips correctly through this repository's
  actual, unmodified provider code (`createLlamaCppProvider()` →
  `createOpenAICompatibleProvider()`) against a real Qwen3-8B model via
  a real llama-server — Phase 13.10's fix was correct. Real
  cancellation itself still needs to be re-confirmed with this
  session's fix in place.

### Verified

- Reproduced the exact hang mechanism in this (still-sandboxed)
  environment: a real local slow-streaming HTTP server, driven by both
  the pre-fix and post-fix wrapper with a real `AbortController` — the
  buggy wrapper was still running 2+s after `abort()`; the fixed
  wrapper aborted in ~200ms.
- Full cold-state pipeline (`npm ci` → `npm run build` → `npm test` →
  `npm run lint` → `npm run format:check`) passes clean. 195 test
  files / 1098 tests passing, 2 files / 7 tests correctly skipped —
  unchanged from Phase 13.9/13.10 (no tests added, none weakened).
- Individually re-ran `llm-runtime.real.test.ts` (3/3 correctly
  skipped here — no real binary/model in this sandbox),
  `openai-compatible.test.ts` (3/3 passing), and `llama-cpp.test.ts`
  (3/3 passing).

## [Unreleased] — Phase 13.10 — Real-hardware integration-test defect fix

### Fixed

- `platform/desktop-app/test/llm-runtime.real.test.ts`: the real
  chat-completion and cancellation tests called
  `createLlamaCppProvider()`'s `streamChat()` with the single-argument
  `AIProvider` call shape (`streamChat(request)`), but that provider
  actually implements the two-argument `LocalRuntimeProvider` contract
  (`streamChat(modelId, request)`) that every real production call
  site (`LocalRuntimeManager.streamChat()`, the Electron bootstrap)
  already used correctly. The mismatch left `request` `undefined` by
  the time it reached `OpenAICompatibleProvider.streamChat()`, which
  then threw `TypeError: Cannot read properties of undefined (reading
'messages')` — caught by the user's first real run of this suite on
  real Windows/RTX 4050 hardware against a real Qwen3-8B GGUF model.
  Both call sites now pass the same `"llama-cpp-local"` runtime-model-
  id literal the real bootstrap uses. No production/provider/
  orchestrator code changed — this was isolated to the test file. See
  `docs/PROJECT_STATE.md`'s "Phase 13.10" section for the full root
  cause and call-site audit.

### Verified

- Re-ran the corrected call path in this (still-sandboxed) environment
  against a local fake OpenAI-compatible SSE server — confirms
  `request.messages` now reaches the real, unmodified provider code
  correctly. Real re-verification against the user's actual Qwen3/
  llama-server setup is the explicit next step (see PROJECT_STATE.md).
- Full cold-state pipeline (`npm ci` → `npm run build` → `npm test` →
  `npm run lint` → `npm run format:check`) passes clean. 195 test
  files / 1098 tests passing, 2 files / 7 tests correctly skipped —
  unchanged from Phase 13.9 (no tests added, none weakened).

## [Unreleased] — Phase 13.9 — Real LLM + Production Tool Calling

### Added

- Real, locally-managed local LLM runtime: `platform/desktop-app/electron/llm-model-provisioning.ts`
  does real, on-disk detection of an externally-installed `llama-server`
  binary + GGUF model and manages its real process lifecycle (start,
  real `/health`-endpoint polling for readiness, stop), wiring the
  existing `@ryper/local-runtime` `createLlamaCppProvider()` to it.
- `core/local-runtime/src/runtime-providers/ai-provider-adapter.ts` —
  `createLocalRuntimeAIProvider()`, wrapping the existing
  `LocalRuntimeManager.streamChat()` (with its existing local-first/
  explicit-cloud-fallback logic) as an `@ryper/ai-engine` `AIProvider`.
- `core/ai-engine/src/providers/node-fetch.ts` — the first real,
  `fetch()`-backed `HttpFetch` implementation any AI provider in this
  repository has been given.
- Explicit-only, optional cloud LLM configuration
  (`RYPER_CLOUD_LLM_PROVIDER`/`_API_KEY`/`_MODEL`/`_BASE_URL`), reusing
  the existing, unmodified OpenAI-/Anthropic-/Google-compatible
  providers. Never active unless all three required values are set.
- Real, structural tool-argument schema validation
  (`core/ai-engine/src/tool-calling/validation.ts`), wired into
  `ToolRegistry.invoke()` before the existing `CapabilityBroker`
  check — closes this phase's own named example, `set_volume(500)`.
- `@ryper/security` gained `CapabilitySensitivity`/`CAPABILITY_SENSITIVITY`
  — capability classification prep for the future Android
  locked-device work (not lock-state enforcement, which doesn't exist).
- `scripts/verify-llm-runtime.mjs` — reusable real-LLM verification
  script (companion to Phase 13.8's `verify-voice-runtime.mjs`).
- `platform/desktop-app/test/llm-runtime.real.test.ts` — real, opt-in
  integration tests (skipped by default), genuinely run this session
  against a real, built-from-source `llama-server`.
- 61 new/changed tests — 1098/1098 unconditional repo-wide passing.

### Fixed

- `HeuristicToolCallingProvider`'s regex-captured slot values (always
  strings) now coerce numeric-looking values before emitting a tool
  call — the new strict schema validator correctly rejected the
  previously-unnoticed string/number mismatch.

### Changed

- `bootstrapAIOrchestrator()` is now `async` and accepts two new
  optional parameters (`paths`, `fileSystem`) for real local-LLM
  detection. All in-repo call sites updated.
- `ToolParameterSchema.properties` is now typed as
  `Record<string, ToolParameterPropertySchema>` (previously
  `Record<string, unknown>`) — the schema shape the new validator
  relies on. One in-repo call site updated to match (it already
  produced conforming values).

### Explicitly not changed / not verified (see `docs/PROJECT_STATE.md`'s Phase 13.9 section for the full accounting)

**NOT VERIFIED — no real LLM chat completion has ever been produced.**
`llama-server` was built from real source and run for real in this
session — including a real, honest failure when pointed at a real but
non-inference-capable GGUF file — but no real, inference-capable GGUF
chat model could be obtained (Hugging Face and every plausible
alternative are outside this environment's network allowlist,
confirmed with real requests). No cloud provider call was made either
— no real API key was available in this environment.
`HeuristicToolCallingProvider` therefore remains the provider actually
exercised by every default automated test in this repository.

## [Phase 13.8] — Real Model + Real Hardware Voice Verification

### Added

- `scripts/verify-voice-runtime.mjs` — a reusable script that imports
  the actual compiled `@ryper/local-runtime` provider code (not test
  fakes) and runs it against a real, externally-installed whisper.cpp/
  Piper install, producing a JSON report.
- `core/local-runtime/test/runtime-providers/voice-runtime.real.test.ts`
  — a real, opt-in integration test suite (skipped by default via
  `describe.skipIf`, CI-safe), genuinely run this session: passed for
  Piper, honestly failed with `WhisperModelMissingError` for Whisper.
- Real AEC/noise suppression/AGC requests: `src/audio/capture-client.ts`
  now explicitly requests Chromium's built-in `echoCancellation`/
  `noiseSuppression`/`autoGainControl` via `getUserMedia()` constraints,
  and exposes the real, actually-granted settings via
  `CaptureHandle.getAppliedAudioSettings()`. No custom DSP was written.
- `docs/adr/0019` — real findings from actually building whisper.cpp
  from source and running a real Piper install in this session.

### Verified this phase (real, not simulated)

- Real Piper synthesis through the actual repository provider code:
  non-silent, correctly-headed WAV audio, directly inspected.
- Real, correctly-thrown `WhisperModelMissingError` from the actual
  repository provider code against a real (model-less) whisper.cpp
  install.
- Real performance data: 5 real Piper calls, MIN 291ms/MAX 568ms/AVG
  417.4ms; real cancellation killed a real process in 11ms.

### Explicitly NOT verified / NOT available this phase

**No real Whisper model could be obtained** — confirmed structurally:
Hugging Face and whisper.cpp's original model host both return real
`host_not_allowed` denials from this build environment's network
egress policy; ten whisper.cpp GitHub release tags were checked and
none has ever hosted a ggml model as a release asset. **No physical
audio hardware, Bluetooth, USB device, or Windows machine exists in
this build environment** — every hardware-dependent test in the
brief (built-in mic/speaker, USB, Bluetooth, device disconnect/
reconnect, live end-to-end voice, barge-in on real hardware) is
`NOT AVAILABLE`, not `PASS`. See `docs/PROJECT_STATE.md`'s Phase 13.8
section for the complete real-world certification matrix.

## [Phase 13.7] — Real Local STT + TTS

### Added

- Real local STT/TTS provider architecture: `createWhisperCppRuntimeProvider()`
  and `createPiperRuntimeProvider()` (`core/local-runtime/src/runtime-providers/`)
  invoke real, external whisper.cpp/Piper CLI binaries via a new
  injectable `ProcessRunner` abstraction (real `node:child_process`).
  Real WAV construction for Whisper input, real WAV parsing of Piper
  output, real missing-binary/missing-model/timeout/cancellation
  handling. See `docs/adr/0018`.
- Real, on-disk model detection and registration
  (`platform/desktop-app/electron/voice-model-provisioning.ts`):
  `detectVoiceModelStatus()` reports `"installed"` / `"binary-missing"` /
  `"model-missing"`; `registerVoiceModels()` registers whichever is real
  into `@ryper/local-runtime`'s existing `ModelRegistry`, ordered ahead
  of an always-available honest reference fallback.
- **Bugfix**: `voice-bootstrap.ts` never registered any model into
  `ModelRegistry`, so every STT/TTS call threw `MissingModelError`
  before `ReferenceVoiceRuntimeProvider` was ever reached — a
  pre-existing gap since Phase 13.5, fixed this phase.
- Real sentence-level TTS chunking (`core/voice-engine/src/tts/sentence-splitter.ts`;
  `LocalSpeechSynthesisProvider.synthesizeStream()` now yields one
  `TtsAudioChunk` per sentence instead of the whole response as one
  blocking call) — real pipelined playback via Phase 13.6's existing
  streaming playback path, unchanged. Not token-level AI streaming.
- Real, automatic barge-in: `VoicePipeline.speak()`
  (`platform/desktop-app/electron/voice-pipeline.ts`) runs a concurrent
  VAD monitor during playback (reusing existing `endpointedFrames()`
  logic) and calls `interrupt()` the instant speech is detected —
  before waiting for the rest of the utterance. `runTurn()` gained an
  optional `presetTranscript` parameter and its result gained an
  optional `bargeIn` field; `main.ts` automatically continues the
  conversation with an interrupting utterance (bounded to 3
  continuations).
- `ASRRequest`/`TTSRequest` gained optional `language`/`signal` fields
  (additive); `LocalRuntimeManager.transcribe()`/`synthesizeSpeech()`
  now forward `InferenceContext.signal` into them so a provider that
  can cancel a real in-flight process (both new providers can) receives
  it directly.
- 47 new tests across 6 new test files, plus updates to 2 existing
  ones — 1063/1063 repo-wide passing. Includes a real (non-fake)
  process-runner test that spawns genuine OS processes.

### Changed

- `bootstrapVoice()` is now `async` (previously synchronous) — every
  call site in this repository updated accordingly.

### Explicitly not changed / not verified (see `docs/PROJECT_STATE.md`'s Phase 13.7 section for the full accounting)

**NOT VERIFIED — no real model execution.** Whisper's ggml models and
Piper's voice `.onnx` files are hosted on Hugging Face, outside this
build environment's network allowlist. Every provider is real, tested
integration code; no real transcription or synthesis has actually run
here. AEC and real noise suppression are **UNAVAILABLE** — no real DSP
library is integrated (`EnergyVoiceActivityDetector` is a simple
energy-based VAD, not an echo canceller). Device-failure automatic
fallback and a Settings UI panel for voice-model diagnostics were not
implemented this phase. `HeuristicToolCallingProvider` (not a language
model) is unchanged.

## [Phase 13.6] — Real Desktop Audio Bridge

### Added

- `RendererAudioBridge` (`electron/audio-bridge.ts`) — a real
  `AudioDeviceSource`/`AudioCaptureSource`/`AudioPlaybackSink`
  implementation, replacing `UnavailableAudioBridge` as the production
  path. Bridges to real `navigator.mediaDevices`/`AudioContext` code
  running in the Electron renderer (`src/audio/{capture-client,
playback-client,device-client,index}.ts`) over a new typed IPC
  contract (`electron/audio-ipc-contract.ts`). See `docs/adr/0017`.
- Real device enumeration, default-device detection, and user-driven
  selection, surfaced through a new Settings UI "Audio Devices" panel
  and new IPC channels (`listAudioDevices`, `selectAudioDevice`,
  `getAudioStatus`, `requestAudioPermission`).
- Real permission handling, including a previously-missing Electron
  `session.setPermissionRequestHandler`/`setPermissionCheckHandler`
  configuration (`electron/windows.ts`) — Electron denies every
  permission request, including `getUserMedia()`, by default; without
  this the real bridge could never actually succeed.
- Real microphone capture (`src/audio/capture-client.ts`): real
  `getUserMedia()`, a `ScriptProcessorNode` PCM tap, and real linear-
  interpolation resampling (`src/audio/resample.ts`) to the STT
  provider's expected sample rate. Handles denial, unavailability, and
  device disconnect with specific, honest error messages.
- Real speaker playback (`src/audio/playback-client.ts`): real
  `AudioContext.decodeAudioData()` + `AudioBufferSourceNode` scheduling,
  real `GainNode`-backed volume, and real immediate-stop barge-in —
  `SpeakerManager.interrupt()`'s `AbortSignal` firing sends a real
  stop-playback IPC message that actually stops the real, currently-
  playing audio node, not merely an internal enum.
- 30 new/changed tests — 1018/1018 repo-wide passing
  (`test/audio-bridge.test.ts`, `test/resample.test.ts`, two new
  `voice-bootstrap.test.ts` cases).

### Explicitly not changed / not verified (see `docs/PROJECT_STATE.md`'s Phase 13.6 section for the full accounting)

**NOT VERIFIED — physical hardware unavailable.** No display server, no
physical or virtual microphone/speaker exists in this build environment
(same pre-existing limitation as the Electron GUI itself since Phase
12). Every new file calls real browser APIs and bundles cleanly via a
real `vite build`, but has not been exercised against actual hardware.
Speaker output-device routing is selectable in the UI but not
functionally wired (no browser exposes `AudioContext.setSinkId()`).
`ReferenceVoiceRuntimeProvider` and `HeuristicToolCallingProvider` are
unchanged — out of this phase's explicit scope.

## [Phase 13.5] — Ryper Voice Pipeline Completion

### Added

- A real `@ryper/ai-engine` `AIOrchestrator` now drives the voice
  pipeline's conversational/task fallback (`ai-orchestrator-bootstrap.ts`),
  replacing `ConversationEngine`. All six sub-components
  (`ProviderRegistry`, `ModelSelectionEngine`, `PromptBuilder`,
  `TokenBudgetManager`, `SessionManager`, `ToolRegistry`) are real. See
  `docs/adr/0016`, which amends `docs/adr/0015`.
- Real `@ryper/ai-engine` `ToolDefinition`s (`desktop-tools.ts`) execute
  through the same `CapabilityManager`/`WindowsAdapter` path
  `VoiceCommandRouter` already used — refactored into one shared
  implementation (`desktop-actions.ts`) so neither surface duplicates
  the other.
- `HeuristicToolCallingProvider` — explicitly, repeatedly documented as
  **not a language model** — is the real, working, pattern-matching
  harness `AIOrchestrator`'s multi-round tool-calling loop runs against
  until a genuine LLM-backed provider is available.
- Verified real, multi-step, sequenced tool execution: a 3-step
  utterance really opens an application, really sets volume, really
  mutes — each step's result observed before the next runs.
- Fixed a real cancellation gap: `AbortSignal` was threaded through
  `AIOrchestrator` but nothing checked it. `HeuristicToolCallingProvider`
  now does, at the seam a real network-backed provider would (before
  `fetch()`).

### Fixed

- Two Phase 13 tests asserted an application "is running" using
  `notepad`, which `@ryper/windows-agent`'s `InMemoryWindowsSystemApi`
  pre-seeds as already running by default — the assertions passed
  trivially regardless of whether the code under test worked. Switched
  to `calculator` (not pre-seeded) for genuine verification.

### Explicitly not changed (see `docs/PROJECT_STATE.md`'s Phase 13.5 section for the full, item-by-item accounting against the brief)

Wake-word detection remains the real, offline, non-acoustic
`EnergyWakeWordProvider` (Phase 13) — no neural keyword-spotting model
is bundled in this repository. STT/TTS remain non-streaming
(`ReferenceVoiceRuntimeProvider` has no real acoustic model to stream
partial results from — synthesizing fake partials was considered and
rejected as exactly the fakery the brief prohibits). No real
microphone/speaker hardware bridge exists (`UnavailableAudioBridge`).
No hardware tests were performed (no audio device or display server in
this build environment).

## [Phase 13] — Ryper Offline Voice Assistant

### Added

- The entire, previously-unintegrated Phase 6 `@ryper/voice-engine`
  stack is wired into `platform/desktop-app` for the first time: real
  session management, VAD-based endpointing, STT/TTS provider
  selection, intent detection, command routing, and memory context.
- `EnergyWakeWordProvider` (`core/voice-engine`) — the first concrete
  `WakeWordProvider` implementation; only the interface + orchestration
  engine existed before. `DEFAULT_INTENT_PATTERNS` exported so shells
  can compose additional patterns rather than duplicating them.
- Real voice command handlers routed through the real
  `CapabilityManager`/`WindowsAdapter` (open/close app, volume,
  mute, media transport) — verified against a real Windows Platform
  Agent in tests.
- The first production `@ryper/memory-system` `MemoryManager` assembly
  in any shell, feeding `VoiceContextManager` for real.
- `docs/adr/0015` documents why `AudioPipelineManager`/`AIOrchestrator`
  were not used this phase (superseded by Phase 13.5, see above).

### Known limitations introduced this phase (see `docs/PROJECT_STATE.md`)

`UnavailableAudioBridge` (no real microphone/speaker hardware bridge)
and `ReferenceVoiceRuntimeProvider` (no production STT/TTS model exists
anywhere in `@ryper/local-runtime`, a gap since Phase 4).

## [RC2] — Phase 12 certification — Desktop Shell & User Experience

### Added

- **`platform/desktop-app`** (`@ryper/desktop-app`) — the first usable
  desktop application: a real Electron app (main process + preload +
  React/Vite renderer) hosting Core in-process. Real chat window
  (streaming-perceived conversation turns, GFM markdown + syntax
  highlighting + XSS-sanitized rendering, copy/delete/regenerate,
  conversation list with create/rename/archive/delete/search, real
  JSON-file persistence), a real animated Voice Orb (idle/listening/
  thinking/speaking state machine), a real system tray with working
  quick actions, a real Settings window (theme/voice/launch-at-login,
  live diagnostics), and a real startup pipeline with live diagnostics
  reporting. 44 new tests.
- `docs/adr/0014` — documents the deliberate deviation from
  `docs/ARCHITECTURE.md`'s original native-shells-over-Electron/
  Rust-Core plan, since Core is actually TypeScript and the native
  shell scaffolds were never integrated with anything.
- `CHANGELOG.md` (this file) and `RELEASE_NOTES.md`.

### Changed

- Root `README.md` rewritten to reflect the actual current state
  (previously described the repository as a "Phase 2 foundation";
  updated through Phase 12).
- `eslint.config.js` — added a browser/JSX-aware rule block for the
  desktop app's renderer; disabled the core `no-undef` rule for
  TypeScript files (false-positives on ambient type-only namespaces
  like `Electron.*`/`NodeJS.*`/`JSX.Element` — TypeScript's own compiler
  already catches every real case, with full type information the
  non-type-aware rule lacks).
- `vitest.config.ts` — added `esbuild.jsx: "automatic"` (matches the
  renderer's `tsconfig.renderer.json` and `vite.config.ts`'s
  `@vitejs/plugin-react`) and extended test/coverage globs to cover
  `platform/desktop-app`.
- `tsconfig.json`, `tsconfig.eslint.json`, `package.json` (workspaces),
  `.prettierignore` — registered the new package into every relevant
  build/lint/format/workspace graph.

### Known limitations (see `docs/PROJECT_STATE.md` for the full list)

- Nine windows were requested in the original Phase 12 brief; six
  (Memory Viewer, Plugin Manager, Model Manager, Automation, Document
  Center, a standalone Diagnostics window) are not built — shown as
  honestly-labeled disabled "coming soon" nav entries, not fake
  populated screens.
- The Voice Orb is a real, animated CSS/spring-eased component, not a
  physics-based/WebGL fluid simulation.
- Real microphone capture / TTS playback is not wired up; push-to-talk
  currently only toggles the orb's visual state.
- True token-level network streaming from the model provider is not
  wired through to the desktop UI (`ConversationEngine.sendMessage()`
  returns a complete reply; the UI renders that real, complete reply).
- The Electron GUI's actual native launch cannot be verified in this
  build sandbox (no display server) — main-process and renderer logic
  are verified via real `tsc --build`, `vite build`, and Vitest
  (including jsdom + React Testing Library) instead.

## [RC1] — Release Candidate 1 — Production Readiness, Monorepo Finalization & Repository Certification

### Added

- Explicit, production-quality `exports` maps on all 27 workspace
  packages (`"." -> { types, import }` + `"./package.json"`),
  replacing reliance on implicit `main`/`types`-only resolution.
  `main`/`types` kept as a fallback. `docs/adr/0013`.

### Verified

- Full certification pipeline (`npm ci` → `npm run build` → `npm test`
  → `npm run lint` → `npm run format:check`) passing with zero failures
  from a completely cold state. Repository certified production-ready
  and approved for Phase 12.

## [Phase 11.7] — Monorepo Stabilization, Package Resolution & Complete Test Recovery

### Fixed

- Vitest could not resolve any `@ryper/*` workspace package whenever
  that package's `dist/` hadn't been built yet (`Failed to resolve
entry for package`), because Vite's module resolution reads `main`
  directly off the filesystem with no awareness of `tsc --build`'s
  project-reference graph or ordering. Fixed via a generated
  `resolve.alias` in `vitest.config.ts` mapping every `@ryper/<name>`
  to its `src/index.ts`, decoupling test execution from build order
  entirely. `docs/adr/0012`.

## [Phase 11.6] — Workspace Resolution, Monorepo Linking & Test Infrastructure Stabilization

Re-verification pass; no defects found. Confirmed `npm ci` → build →
test → lint → format all pass from a cold state, plus dependency
version-conflict, `"type"` field, and `peerDependencies` audits (all
clean). No code changes.

## [Phase 11.5] — Monorepo Integration, Validation & Stabilization

### Fixed

- `core/planner`'s `PlannerScheduler` test suite had a timezone-
  dependent assertion that only passed when the host machine's local
  timezone happened to be UTC. Root-caused and fixed as a test-only
  change — the scheduler's local-time semantics were correct all along.
  `docs/adr/0011`.

### Verified

- Full repository-wide integration audit (dependency graph, circular-
  dependency check, `tsconfig`/project-reference consistency,
  `package.json` field/script consistency, workspace-symlink
  resolution, Vitest glob coverage, `main`/`types` output-path
  validation) — sound, with the one fix above.

## [Phase 11] — Windows Platform Agent

### Added

- **`core/windows-agent`** (`@ryper/windows-agent`) — the first
  production implementation of the Platform Capability Layer's
  `PlatformAdapter` contract. Sixteen manager classes (Process, Window,
  Application, File, Clipboard, Notification, Audio, Display, Device,
  Permission, Registry, Service managers, Event Monitor, Performance
  Monitor, Diagnostics Manager, Windows Version Detector), a single
  injectable `WindowsSystemApi` seam with a real in-memory reference
  implementation and a real PowerShell/WMI-command-building production
  implementation, Windows 10/11 detection with graceful degradation, a
  deny-by-default destructive-action confirmation gate and UAC-
  elevation gate, and a plugin capability-extension registry.
  `docs/adr/0009`, `docs/adr/0010`.

## [Phase 10] — Platform Capability Layer

### Added

- **`core/platform-capability`** — the common capability layer every
  higher-level package (Planner, Tool Framework, Plugins) goes through
  instead of ever calling an OS API directly. An open, extensible
  `CapabilityDomain` set, a stable `PlatformAdapter` contract across six
  platforms, dynamic capability resolution with fallback suggestions, a
  full discovery report, permission integration, bounded diagnostics,
  and Planner/Tool-Framework/Plugin integration bridges behind a
  `CapabilityManager` facade. `docs/adr/0006`–`0008`.

## [Phases 1–9]

Architecture (Phase 1), Project Foundation (Phase 2), Core AI Engine
(Phase 3), Local AI Runtime & Model Management (Phase 4), Memory System
(Phase 5), Voice Engine & Audio Platform (Phase 6), Agent Planner & Task
Orchestration Engine (Phase 7), Universal Tool Calling Framework
(Phase 8), Plugin SDK & Extension Platform (Phase 9). See
`docs/PROJECT_STATE.md`'s "Completed phases" table for full detail on
each — condensed here for brevity since this changelog's detailed
entries begin where the currently-active development thread (Phase 10
onward) does.
