# ADR 0016: A real `AIOrchestrator` now drives arbitrary voice requests, via a heuristic tool-calling provider — amending ADR 0015

**Status:** Accepted (Phase 13.5)

## Context

ADR 0015 (Phase 13) deliberately did not construct `@ryper/ai-engine`'s
`AIOrchestrator` — nothing in this repository ever had, and assembling
its six sub-components (`ProviderRegistry`, `ModelSelectionEngine`,
`PromptBuilder`, `TokenBudgetManager`, `ToolRegistry`, `SessionManager`)
for the first time was judged out of scope for that phase's time budget.
The voice pipeline instead called `@ryper/conversation`'s
`ConversationEngine`, which has no multi-round tool-calling loop.

Phase 13.5's brief names this the single most important gap to close:
"the voice pipeline must be properly connected to the existing AI
orchestration/planning/tool execution architecture... reuse the
existing AI Orchestrator... do not create a second independent
orchestration system."

Investigating the actual construction requirements (this phase) found
it more tractable than ADR 0015 anticipated: `@ryper/ai-engine`'s own
`ToolRegistry` (distinct from `@ryper/tool-framework`'s, as ADR 0015
noted) takes an **optional `@ryper/security` `CapabilityBroker` directly**
in its constructor, and its `ToolDefinition.execute()` is a plain
function — no bridge to `@ryper/tool-framework`'s `ToolManager` is
required at all. A `ToolDefinition` whose `execute()` calls
`CapabilityManager.invoke()` (the exact pattern `voice-commands.ts`
already established for `VoiceCommandRouter`) is sufficient. The module's
own doc comment anticipated this: "Actual tool implementations... land
in later phases."

The remaining real gap: `AIOrchestrator` needs an `AIProvider` (the
actual "model" that decides text vs. tool-call) — no `AIProvider`
implementation exists anywhere in this repository, honest per ADR 0015
(no LLM/model backend of any kind is bundled here, the same class of gap
as `@ryper/local-runtime`'s missing production provider).

## Decision

1. **A real `AIOrchestrator` is now constructed** in
   `platform/desktop-app/electron/ai-orchestrator-bootstrap.ts`, with
   real `ProviderRegistry`, `ModelSelectionEngine`, `PromptBuilder`,
   `TokenBudgetManager`, `SessionManager` (backed by the same
   `LongTermMemory`/`VectorStore` `@ryper/web-shell` already
   constructs), and a real `ToolRegistry` populated with real
   `ToolDefinition`s (`desktop-tools.ts`) whose `execute()` calls
   `CapabilityManager.invoke()` — the same real permission-checked path
   `voice-commands.ts` uses, not a duplicate.
2. **`HeuristicToolCallingProvider`** (`heuristic-ai-provider.ts`) is the
   `AIProvider` registered as the `"local"`-kind provider. It is
   explicitly, repeatedly documented as **not a language model** — it
   decides between a tool call and a text reply using deterministic
   pattern matching (literally reusing `@ryper/voice-engine`'s
   `IntentDetector`/`DEFAULT_INTENT_PATTERNS`/`DESKTOP_INTENT_PATTERNS`,
   the same patterns `VoiceCommandRouter` already matches against — no
   second, divergent pattern set). It exists specifically so
   `AIOrchestrator`'s real multi-round tool-calling loop, real
   `ToolRegistry.invoke()` calls, real observation-of-results, and real
   session/context management can all run and be tested end-to-end
   _today_, against real (if not natural-language-driven) plans — and
   so that swapping in a genuine LLM-backed `AIProvider` later requires
   registering one more provider, with zero change to
   `AIOrchestrator`, `ToolRegistry`, or any tool definition.
3. **`VoicePipeline` now calls `AIOrchestrator.sendMessage()`** for its
   conversational/task fallback, replacing the `ConversationEngine` call
   ADR 0015 chose. `ConversationEngine` remains exactly as it was and
   remains what the desktop app's **text chat window** uses (Phase 12) —
   this ADR does not touch that path. Voice and text chat now use
   different backends; a future phase could unify them once a real
   `AIProvider` exists, at which point `ConversationEngine`'s
   simplicity may or may not still be preferred for text chat.

## What this closes and what it honestly does not

**Closes for real:** multi-round tool execution with observation
(`AIOrchestrator`'s loop really runs, really calls `ToolRegistry.invoke()`,
really receives a `ToolResult`, really can issue a second/third tool call
based on it — verified in tests with real multi-step utterances executing
real, sequenced `CapabilityManager` calls); permission integration (every
tool call still goes through the real `CapabilityManager.invoke()`
pipeline — broker consent, capability resolution, adapter dispatch — no
tool bypasses it); a single orchestration system (no parallel/competing
planning logic was created — `AIOrchestrator` is the one used).

**Does not close, honestly:** genuine natural-language understanding of
_arbitrary_ phrasing. `HeuristicToolCallingProvider` matches the same
finite pattern set `VoiceCommandRouter` already had — it does not
understand a request its patterns don't cover, and does not compose
novel plans beyond splitting an utterance on connective words ("then",
"and", ",") into a sequence of pattern-matched steps. A genuinely
open-ended "arbitrary multi-step voice request," as the brief's example
implies, requires a real LLM — this ADR builds the real, working
harness a real LLM plugs into, not a substitute for one. This is stated
here as plainly as ADR 0015 stated its own scope, per the brief's
explicit "do not fake capabilities" requirement.

## Alternatives Considered

- **Bridge `@ryper/tool-framework`'s `ToolManager`/`ToolDefinition`
  into ai-engine's `ToolRegistry`.** Rejected once investigation showed
  it's unnecessary: ai-engine's `ToolRegistry` already accepts a
  `CapabilityBroker` directly, and its own `ToolDefinition` shape is
  simple enough to implement directly against `CapabilityManager`
  without any adapter layer. Introducing one would have been extra
  indirection for no benefit.
- **Wait for a real LLM/local-runtime provider before wiring
  `AIOrchestrator` at all.** Rejected: the brief is explicit that
  closing this integration gap is the priority, and the harness
  (orchestrator, tool registry, real tool definitions, session/context
  management) is valuable and testable today independent of what
  `AIProvider` sits behind it — exactly analogous to why
  `ReferenceVoiceRuntimeProvider` (ADR from Phase 13) was worth building
  despite having no real model behind it either.
- **Have the heuristic provider call an actual small local model (e.g.
  a tiny local classifier) instead of hand-written patterns.** Rejected
  for this phase: no such model is bundled in this repository, and
  training/bundling one is out of scope; pattern matching is the
  honest, available option, and it reuses patterns that already exist
  rather than inventing new ones.

## Tradeoffs

- Voice and text chat conversations now use different context/session
  backends (`AIOrchestrator`'s `SessionManager`+`ContextManager` for
  voice, `ConversationEngine`'s simpler short-term memory for text) —
  a real, acknowledged inconsistency, not hidden.
- `HeuristicToolCallingProvider`'s multi-step decomposition (splitting
  on connective words) is naive compared to real LLM planning and will
  mis-segment many real utterances. It is good enough to exercise and
  test the real multi-round tool-execution architecture, not to ship as
  the final natural-language experience.

## Migration Impact

None for any existing package's public API. `@ryper/ai-engine`,
`@ryper/tool-framework`, `@ryper/planner`, and `@ryper/conversation` are
all unmodified. `platform/desktop-app`'s `VoicePipeline` constructor
signature changed (now takes an `AIOrchestrator` + `sessionId` context
instead of a `ConversationEngine`) — an internal desktop-app change, not
a public Core API break.
