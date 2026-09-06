# ADR 0028: Expanded (10-state) Voice Session state machine

**Status:** Accepted (Tier 1 completion pass, continued)

## Context

The Tier 1 completion mission (see `docs/PROJECT_STATE.md`'s "Tier 1
completion pass" section) named a real, previously-identified gap: the
Voice Engine's `VoiceSessionState` was a real but simple 6-state model
(`idle|listening|processing|speaking|cancelled|error`) that couldn't
distinguish several conversationally-distinct real events a UI or
diagnostics consumer genuinely needs to tell apart:

- The gap between the microphone closing and STT actually finishing
  (previously both reported as `listening`, which left a "mic is
  live" indicator lit after the user had stopped talking).
- A tool call in progress vs. the model composing a text reply
  (previously both `processing`).
- The user barging in on RYPER mid-sentence vs. an explicit,
  external stop request (previously both `cancelled`).
- An automatic retry after a transient provider failure vs. a hard
  failure (previously indistinguishable — a retry was invisible,
  reported as still `processing`/`speaking` until it either
  recovered silently or surfaced as `error`).

## Decision

Replace the 6-state model with a 10-state model:

`idle | listening | transcribing | thinking | tool_execution |
speaking | interrupted | recovering | cancelled | error`

Full semantics for each state are documented on `VoiceSessionState`
itself in `core/voice-engine/src/types.ts`. In summary:

- `processing` is renamed `thinking` (clearer against the new,
  more specific states below).
- `transcribing` is new: entered the instant VAD-endpointing decides
  capture is done (`AudioPipelineManager`/`VoicePipeline`'s new
  `markCaptureEnded()`), before the STT provider's final result has
  necessarily arrived.
- `tool_execution` is new: a sub-state of `thinking`, entered
  specifically while `AIOrchestrator.sendMessage()`'s stream yields a
  `tool_call` event, and left the moment the corresponding
  `tool_result` event arrives. This is _not_ synthetic — it reflects
  the orchestrator's own real, already-existing tool-calling stream
  events (see `core/ai-engine/src/orchestrator.ts`), just not
  previously surfaced to the Voice Engine's own session state.
- `interrupted` is new: the real, automatic barge-in path
  (`VoicePipeline.monitorForBargeIn()`) now lands here instead of
  `cancelled`. `@ryper/voice-engine`'s own `AudioPipelineManager` has
  no automatic barge-in detection of its own (that's an
  electron/`VoicePipeline`-specific real hardware feature — see ADR
  0018), so its generic `interrupt()` is unaffected and still lands on
  `cancelled`.
- `recovering` is new: entered via a new, optional `onRetry` hook on
  `@ryper/ai-engine`'s `retryWithBackoff` (additive, backward
  compatible — every existing caller is unaffected), fired
  immediately before the backoff sleep on a real retryable failure.

### Real bug found and fixed along the way

While reworking the failure-path transition in both
`AudioPipelineManager.runTurn()` and `VoicePipeline.runTurn()`, found
that the `catch` block's recovery transition
(`sessionManager.transition(signal?.aborted ? "cancelled" : "error")`)
was gated on `session.state !== "idle"`, where `session` was a local
binding captured from `sessionManager.getSnapshot()` _before_ the
turn's own `transition("listening")` call. Because
`VoiceSessionSnapshot` is an immutable object replaced (not mutated)
on every transition, that local binding never reflected any
transition made during the turn — `session.state` was always `"idle"`
at the point of the check, since every turn starts from idle. This
silently made the entire recovery transition dead code: a genuinely
failed turn never actually reset the session to `cancelled`/`error`;
it stayed wherever it was mid-turn indefinitely. Fixed by reading
`sessionManager.getSnapshot().state` live in the `catch` block
instead. No test previously asserted the post-failure session state
closely enough to have caught this — the existing
"propagates cancellation... and leaves the session cancelled" test's
name described the intended behavior but never actually checked
`getSnapshot().state`.

## Consequences

- `VALID_TRANSITIONS` in `voice-session-manager.ts` grew accordingly.
  `cancelled` and `error` remain reachable from every "busy" state, so
  an external hard-stop (`cancel()`) or an unexpected failure can
  always be recorded regardless of which stage a turn was in.
- `platform/desktop-app/electron/voice-pipeline.ts`'s `askAIOrchestrator`
  does not itself retry (no `retryWithBackoff` call there — only
  `@ryper/voice-engine`'s `AudioPipelineManager` does), so `recovering`
  is a real, valid, but currently unreached state in that specific
  pipeline. This asymmetry between the two pipelines is real and
  intentionally left as-is; adding retry to the electron pipeline's
  own AI Engine call was out of scope for this pass.
- Consumers that pattern-matched on the literal string `"processing"`
  (there were none outside this repository's own tests) would need to
  update to `"thinking"`. Within this repository, the only such
  references were the two pipeline implementations and their tests,
  all updated here.

## Verification

New/updated tests: `core/voice-engine/test/voice-session-manager.test.ts`
(rewritten for the 10-state graph), a new
`core/voice-engine/test/audio-pipeline-manager-expanded-states.test.ts`
exercising the _real_ pipeline wiring (not just the bare state
machine) for `transcribing`, `tool_execution`, `recovering`, and the
core package's `cancelled`-only `interrupt()`, and an extended
assertion in `platform/desktop-app/test/voice-pipeline-bargein.test.ts`
confirming the real automatic barge-in path lands on `interrupted`,
never `cancelled`. All new tests observe the actual
`voice_engine.session_transition` event sequence a real turn produces
via a shared `EventBus`, not just the final state.

## What this does not do (honest scope)

This pass did not touch: the Windows Platform Agent's tool surface,
cross-subsystem voice→STT→AIOrchestrator→tools→TTS integration tests,
or exhaustive STT/TTS lifecycle edge-case auditing. These remain real,
unimplemented Tier 1 items — see `docs/PROJECT_STATE.md`.
