# ADR 0015: The desktop voice pipeline reuses real voice-engine primitives directly and `@ryper/conversation`'s `ConversationEngine`, not `AudioPipelineManager`/`AIOrchestrator`

**Status:** Accepted (Phase 13)

## Context

`core/voice-engine`'s `AudioPipelineManager` (built in Phase 6) is a
complete, real orchestrator tying together every voice-engine
component — session management, VAD-based endpointing, STT, intent
detection, command routing, TTS, diagnostics, analytics — into one
`runTurn()` call. It is exactly the class Phase 13's brief describes.

Its conversational fallback (when no command intent matches) calls
`@ryper/ai-engine`'s `AIOrchestrator.sendMessage()` — a different,
separate orchestrator from `@ryper/conversation`'s `ConversationEngine`,
which is what `@ryper/web-shell` (and therefore
`platform/desktop-app`'s existing text chat) actually uses. `AIOrchestrator`
requires six further sub-components to construct (`ProviderRegistry`,
`ModelSelectionEngine`, `PromptBuilder`, `TokenBudgetManager`, its own
`ToolRegistry` — a separate concept from `@ryper/tool-framework`'s
`ToolManager`/`ToolRegistry`, with no bridge between the two anywhere in
this repository — and a `SessionManager`). A repository-wide search
found **no production code anywhere constructs an `AIOrchestrator`** —
only its own test file does. Wiring it up for the first time, from
scratch, is a substantial undertaking of its own, separate from "voice
assistant."

`AudioPipelineManager`'s constructor requires a concrete `AIOrchestrator`
instance (not an interface), and because `AIOrchestrator` has private
fields, TypeScript's structural typing cannot accept a duck-typed
substitute with a matching `sendMessage()` shape — only a real
`AIOrchestrator` (or subclass) satisfies the type.

## Decision

The desktop app's voice pipeline (`platform/desktop-app/electron/
voice-bootstrap.ts`) does **not** construct or use `AudioPipelineManager`
or `AIOrchestrator`. Instead, it directly assembles and orchestrates the
same real voice-engine primitives `AudioPipelineManager` would (`VoiceSessionManager`,
`EnergyVoiceActivityDetector`, `WakeWordEngine`, `SpeechRecognitionRegistry`,
`SpeechSynthesisRegistry`, `IntentDetector`, `VoiceCommandRouter`,
`VoiceContextManager`, `VoiceDiagnostics`, `VoiceAnalytics`, `VoiceSettingsManager`)
in a new `VoicePipeline` class that mirrors `AudioPipelineManager`'s
`runTurn()`/`interrupt()` contract and stage-timing behavior, but calls
`@ryper/conversation`'s already-wired, already-tested `ConversationEngine.sendMessage()`
for the conversational fallback instead of `AIOrchestrator.sendMessage()`.

This reuses every real voice-engine component (nothing in
`core/voice-engine` is duplicated or reimplemented) and every real
Core-conversation component already proven working in this codebase
(`ConversationEngine`, `@ryper/web-shell`'s wiring pattern) — it avoids
duplicating exactly one class's internals (`AudioPipelineManager`'s
turn-orchestration logic, reimplemented against a different
conversational backend) in exchange for not taking on constructing a
never-before-used six-component subsystem as a prerequisite.

## Alternatives Considered

- **Construct a real `AIOrchestrator` and use `AudioPipelineManager`
  as-is.** The architecturally "purest" option, and closest to
  `AudioPipelineManager`'s original design intent. Rejected for this
  phase on scope grounds: wiring `AIOrchestrator` for the first time
  anywhere in the repository — including bridging its separate
  `ToolRegistry` concept to `@ryper/tool-framework`'s, which is its own
  undocumented pre-existing gap — is substantially larger than "add
  voice assistant capability to the desktop app" and risks either not
  finishing or shipping an unverified, never-tested assembly of six new
  subsystems together for the first time under this phase's time
  budget. Flagged as real, valuable future work in
  `docs/PROJECT_STATE.md`'s known gaps, not silently dropped.
- **Extend `AudioPipelineManager` to accept `ConversationEngine` as an
  alternative to `AIOrchestrator`** (e.g. a union type or a shared
  interface both classes could implement). Rejected: this would mean
  editing `core/voice-engine`'s public API/constructor contract for a
  desktop-app-specific need, and neither `AIOrchestrator` nor
  `ConversationEngine` currently implements a common interface — adding
  one is itself a Core architecture change this phase's "do not rewrite
  architecture" instruction cautions against making lightly. A future
  phase that does invest in a shared conversational-backend interface
  across `@ryper/ai-engine` and `@ryper/conversation` could revisit
  this and let the desktop app use `AudioPipelineManager` directly.

## Tradeoffs

- The desktop app's `VoicePipeline` duplicates `AudioPipelineManager`'s
  _orchestration logic_ (stage sequencing, timing, endpointing) at the
  call-site level, even though it duplicates none of voice-engine's
  actual component _implementations_. If `AudioPipelineManager`'s
  sequencing logic changes in a future phase, `VoicePipeline` needs a
  matching update — a real, acknowledged coupling cost.
- Voice conversations and text conversations sharing `ConversationEngine`
  means voice turns get the exact same context-retrieval/routing
  behavior as text turns (arguably a feature, not just a workaround —
  a user's voice and text conversations in the same session see
  consistent behavior).
- The `AIOrchestrator`/multi-round-tool-calling path (relevant to the
  brief's complex multi-step command examples, e.g. "open YouTube,
  search relaxing music, play first result, lower volume, then read
  today's calendar") is **not** exercised by this phase's voice
  pipeline. `ConversationEngine` does not do LLM-driven multi-round tool
  calling the way `AIOrchestrator` is designed to. Genuinely complex,
  multi-step voice commands are handled only to the extent
  `VoiceCommandRouter`'s registered handlers (this phase's real,
  concrete desktop command handlers — see `voice-commands.ts`) cover
  them; anything else falls through to a conversational
  `ConversationEngine` reply, not real multi-step tool execution. This
  is recorded plainly in `docs/PROJECT_STATE.md`'s known gaps, not
  hidden behind an impressive-sounding pipeline diagram.

## Migration Impact

None. `core/voice-engine` and `core/ai-engine` are both unmodified by
this decision — `AudioPipelineManager` and `AIOrchestrator` remain
exactly as they were, available for a future phase to wire up fully.
