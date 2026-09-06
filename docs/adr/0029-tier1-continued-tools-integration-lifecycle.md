# ADR 0029: Tier 1 completion pass, continued — retry parity, Windows/filesystem tool surface, cross-subsystem integration tests, STT/TTS lifecycle fixes

**Status:** Accepted (Tier 1 completion pass, continued)

## Context

Following ADR 0028 (the expanded voice state machine), the Tier 1
completion mission's remaining named gaps were: (1) the
`VoicePipeline`/`AudioPipelineManager` retry asymmetry ADR 0028 itself
surfaced, (2) zero AI tool surface for window management and
file/folder operations despite real, complete `@ryper/windows-agent`
APIs underneath, (3) no cross-subsystem integration tests wiring
voice → STT → AIOrchestrator → tools → TTS end-to-end, and (4) an
unaudited set of STT/TTS lifecycle edge cases. All four were picked up
in priority order this session.

## Decision

### 1. Retry asymmetry closed

`platform/desktop-app/electron/voice-pipeline.ts`'s `askAIOrchestrator`
now uses the same `retryWithBackoff` + `recovering`-state wiring as
`@ryper/voice-engine`'s `AudioPipelineManager.askAiEngine`. Verified
with two new tests (`voice-pipeline-retry.test.ts`) asserting the real
transition sequence for both a successful retry and an exhausted-retry
failure.

### 2. Windows/filesystem AI tool surface

Added real action functions (`desktop-actions.ts`), `ToolDefinition`s
(`desktop-tools.ts`), and voice-command intent patterns/handlers
(`voice-commands.ts`) for:

- **Window management** (8 tools): `list_windows`, `get_active_window`,
  `focus_window`, `minimize_window`, `maximize_window`,
  `restore_window`, `snap_window`, `switch_window` — all real, backed
  by `@ryper/windows-agent`'s `WindowManager` via the already-real
  `window_management` capability domain, which had zero AI tool
  surface before this. A shared `resolveWindow()` helper matches
  free-text queries ("the Chrome window") against real open windows'
  titles/`appId`s, since voice/text requests never supply a raw window
  handle.
- **Filesystem** (10 tools): `list_files`, `read_file`, `search_files`,
  `get_folder_path`, `list_recent_files`, `create_folder`, `copy_file`,
  `move_file`, `rename_file`, `delete_file` — backed by
  `@ryper/windows-agent`'s `FileManager`. `delete_file` is deliberately
  routed through the real, deny-by-default `DestructiveActionGate`
  (`confirmation.ts`), not bypassed or duplicated.

**A real design mistake found and corrected before shipping**: the
filesystem tools were initially given `requiredCapability:
"filesystem.write"` directly on their `ToolDefinition`s, in addition
to the domain-level requirement already declared in
`WINDOWS_CAPABILITY_DESCRIPTORS`. That stacks two different
authorization models — `ToolRegistry`'s own pre-execute broker check
(which requires a _pre-existing_ grant, the stricter
`show_notification`-style gate) on top of
`CapabilityManager.invoke()`'s own self-granting consent-flow gate
(the one every other desktop tool, including `audio`, already relies
on) — for no real benefit, and it broke the tests written against the
intended (self-granting) behavior. Removed `requiredCapability` from
the filesystem `ToolDefinition`s; the domain-level gate remains the
single, real authorization mechanism, consistent with every other
desktop tool.

Verified with 17 new tests
(`desktop-tools-windows-filesystem.test.ts`) against the real, in-memory
reference `WindowsSystemApi` — including real evidence a tool call
actually mutated adapter-visible state (a window's focus/position, the
filesystem), not just that it returned a friendly string, and real
proof `delete_file` is denied by default and only succeeds once a real
confirmer approves it.

### 3. Cross-subsystem integration tests

Added `voice-to-tools-integration.test.ts`, using this repo's actual
production wiring end to end (`bootstrapAIOrchestrator()`, real
`ToolRegistry`, real `HeuristicToolCallingProvider` — the genuine
no-LLM-configured fallback, not a test double — talking to a real
`CapabilityManager` + in-memory `WindowsAdapter`, and a real
`VoicePipeline`). The only faked seam is the OS audio hardware
boundary itself, matching every other test in this repo.

**A real, previously-undocumented architectural fact surfaced while
writing this**: `VoicePipeline.runTurn()` checks
`intentDetector.detect(transcript)` against the whole transcript
_before_ ever calling `askAIOrchestrator()`, routing any match
straight to `VoiceCommandRouter` — never touching
`AIOrchestrator`/`ToolRegistry` at all. Since `HeuristicToolCallingProvider`
matches single commands against the _identical_ pattern set, any
single-command transcript that would produce a real tool call inside
`AIOrchestrator` has _already_ been caught by the pipeline's own fast
path first. In today's real wiring, `AIOrchestrator`'s tool-calling
loop is only reachable via (a) a transcript matching no single pattern
at all (genuine conversational fallback), or (b) a compound,
multi-step transcript ("do X then do Y") that `IntentPattern`s (each
anchored `^...$`) cannot match as a whole but
`HeuristicToolCallingProvider.splitSteps()` does, segment by segment.
One further wrinkle: `open_application`'s
`/^open (?<app>.+)$/i` is unboundedly greedy, so "open X then Y" is
swallowed whole as a single `open_application` match — a valid
compound-command test needs the _first_ segment's pattern to have a
literal, non-greedy tail (e.g. `list_windows`'s `windows$`). Both real
paths are covered, honestly labeled for which one each test transcript
actually exercises.

### 4. STT/TTS lifecycle edge-case audit

Three real gaps found and fixed (in both `AudioPipelineManager` and
`VoicePipeline`, which duplicate this logic):

- An STT provider emitting a `final` event with empty/whitespace-only
  text (e.g. background noise crossing VAD's endpoint threshold with
  no recognizable words) previously proceeded all the way to the AI
  Engine as a real request. Now treated the same as "no result at
  all" (`captureAndRecognize` throws), matching the existing handling
  for a provider that produces no `final` event whatsoever.
- `commandResult.spokenResponse ?? "Done."` only falls back on
  `null`/`undefined`, not on an empty string — a command handler
  returning `spokenResponse: ""` reached `speak()` with nothing to
  say. `chunkForSpeech("")` legitimately yields zero chunks, so the
  turn silently "completed" having spoken nothing audible at all, no
  error, no fallback. Changed to `?.trim() || "Done."`, which also
  catches a whitespace-only response.
- The AI Engine's own empty-response guard checked `text.length === 0`
  (`AudioPipelineManager`) rather than `.trim().length === 0`
  (`VoicePipeline` already did this correctly) — a whitespace-only AI
  response passed the guard and hit the identical silent-TTS gap.
  Aligned both pipelines to `.trim()`.

Verified with 4 new tests in
`audio-pipeline-manager-expanded-states.test.ts`, including one that
incidentally confirms the fix interacts correctly with the existing
`recovering`-state retry logic (a whitespace-only response is treated
as retryable, retried once, then genuinely fails).

## Consequences

- 18 new real AI tools now exist for window/file management, closing a
  gap the mission named explicitly ("real Win32 APIs available but
  zero AI tool surface").
- The compound-command architectural finding means any future work
  wiring a _real_ LLM into `AIOrchestrator` will genuinely add
  conversational flexibility beyond today's fast-path pattern matching
  — this wasn't previously demonstrated by any test.
- The three lifecycle fixes are all silent-failure-mode fixes: none of
  them changed a previously-working turn's outcome, only ones that
  were previously producing confusing "succeeded but said nothing" or
  "answered a request the user didn't actually make" results.

## Verification

Full cold-state certification (`npm ci` → `build` → `test` → `lint` →
`format:check`) passes clean after all four items:
**202 test files / 1184 tests passing, 5 files / 12 tests correctly
skipped** as opt-in real-Windows-hardware tests (up from 199/1156 at
the end of ADR 0028's pass).

## What this does not do (honest scope)

Not done: OS power-state voice commands (shutdown/restart/sleep — no
`@ryper/windows-agent` domain exists for this yet, honestly stubbed as
"not yet implemented," unchanged this pass); a real LLM wired into
`AIOrchestrator` for the desktop app (still `HeuristicToolCallingProvider`
in the absence of one); further STT/TTS lifecycle edge cases beyond
the three found (device disconnects mid-capture, provider-specific
rate limiting, and similar were not exhaustively enumerated — this was
a real but not claimed-exhaustive audit).
