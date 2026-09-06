# ADR 0022: Tool-call streaming heartbeats, provider-aware stream timeout, and Qwen3 thinking-mode control

**Status:** Accepted (Phase 13.12, second stage)

## Context

The user's first real-hardware run of `tool-calling.real.test.ts`
(Phase 13.12) reached real detection, real capability registration,
and a real, granted `notifications` capability decision, then failed
after ~49 seconds with:

```
EngineTimeoutError: no stream event within 30000ms
  at core/ai-engine/src/streaming.ts:18
```

Phase 13.10/13.11 had already independently confirmed real Qwen3
chat completion (~43–49s total, no timeout) and real cancellation both
work correctly through this repo's real provider code on this exact
hardware — so this was not a sign that Qwen3, llama-server, or the
hardware were broken. The task was to find why _tool-call_ generation
specifically produced a stall the timeout logic couldn't see through,
without weakening the test or blindly raising the timeout.

## Root cause

`OpenAICompatibleProvider.streamChat()`
(`core/ai-engine/src/providers/openai-compatible.ts`) parses each SSE
chunk's `delta.tool_calls` fragments and accumulates them into a
`pendingToolCalls` map — but **never yields anything while doing so**.
The only place a tool call is ever turned into a `StreamEvent` is once
`choice.finish_reason` is present, at the very end of the stream.

For plain chat (Phase 13.10/13.11) this was never a problem: every
`content` delta is yielded the moment it arrives, so
`streaming.ts`'s `withTimeout()` — a genuine **inter-event** timeout,
confirmed by reading its implementation: it races `iterator.next()`
against the timeout and resets the race on every loop iteration, not a
total-duration timeout — sees continuous activity throughout a long
response.

For tool calls, every intermediate chunk containing a `tool_calls`
fragment produces **zero yields**. From `withTimeout()`'s perspective,
the entire tool-call generation — prompt prefill, any hidden
"thinking" content, and the full multi-chunk JSON arguments — has to
complete inside a single `iterator.next()` call. On real local 8B
hardware (a consumer laptop GPU, not a dedicated cloud cluster) that
single gap can genuinely exceed 30 seconds, even though the model and
llama-server are both working correctly and the HTTP stream is, in
fact, continuously active the whole time. This is a real streaming
architecture bug, not a case for a larger arbitrary timeout: the
correct fix is to make genuine wire activity visible to the timeout
logic, the way it already is for plain text.

Two adjacent findings, directly requested to be investigated:

- If a real OpenAI-compatible server (vLLM/SGLang/recent llama.cpp) surfaces a
  "thinking" model's hidden chain-of-thought under a separate
  `delta.reasoning_content` field, the old code ignored it entirely —
  same invisible-gap problem, worse if thinking mode is left enabled.
- Nothing in this repository ever told llama-server to disable Qwen3's
  thinking mode for tool calls, which Qwen3's own documentation
  recommends for more deterministic tool-call generation. Its
  mechanism (`chat_template_kwargs: { enable_thinking: false }` in the
  request body) is llama.cpp/vLLM-specific, not something to send
  unconditionally to a real OpenAI/other cloud endpoint that also uses
  `OpenAICompatibleProvider`.

## Decision

1. **`StreamEvent` gains a `tool_call_progress` variant**
   (`core/ai-engine/src/types.ts`) — an empty heartbeat event with no
   payload, carrying no information beyond "real wire activity just
   happened." `OpenAICompatibleProvider` now yields one for every
   `tool_calls` delta fragment (bridging the exact gap that caused the
   real failure) and for every `reasoning_content` fragment (closing
   the adjacent hidden-thinking gap). A partial tool-call argument
   fragment is genuinely not valid JSON yet, and reasoning content
   should not be shown to the user as if it were the assistant's
   reply — a heartbeat is the honest signal here, not a premature
   `tool_call` or `text_delta` event.

2. **`AIOrchestrator` explicitly consumes `tool_call_progress`
   internally** (`core/ai-engine/src/orchestrator.ts`) — never
   forwarded to `sendMessage()`'s own callers (so the existing public
   `StreamEvent` contract UI code and `voice-pipeline.ts` already
   depend on is unchanged), and handled in its own branch rather than
   falling into the previous catch-all `else` (which would have
   silently, incorrectly treated it as a `done` event — a latent bug
   this also closes, even though it was never reachable before this
   phase since nothing previously yielded an unrecognized event type).

3. **Provider-aware stream timeout.** `AIOrchestratorOptions` gains
   `localStreamTimeoutMs` (default: same as `streamTimeoutMs`, i.e. no
   behavior change unless configured), used instead of
   `streamTimeoutMs` specifically when the selected provider's
   `kind === "local"`. `ai-orchestrator-bootstrap.ts` sets this to
   120,000 ms by default — a real, still-bounded budget informed by
   this repo's own real-hardware measurements (43–49s for a full real
   response) — configurable via `RYPER_LOCAL_LLM_STREAM_TIMEOUT_MS`
   without a code change. Remote/cloud providers keep the existing
   30-second default untouched: a genuinely hung remote connection
   must still fail fast. This is deliberately _not_ a blanket timeout
   increase — it is scoped to `kind === "local"` only, and is a
   secondary safety net on top of fix #1/#2 above, not a substitute for
   them.

4. **Qwen3 thinking-mode control.** `OpenAICompatibleConfig` gains
   `disableThinkingForToolCalls?: boolean` (default `false`/unset).
   When set and the request includes `tools`, the outgoing JSON body
   includes `chat_template_kwargs: { enable_thinking: false }`.
   `LlamaCppConfig` forwards this same flag through to the
   `OpenAICompatibleProvider` it delegates to.
   `ai-orchestrator-bootstrap.ts` sets `disableThinkingForToolCalls:
true` for the local llama-cpp provider specifically — never for the
   explicit-only cloud `OpenAICompatibleProvider` instance, where this
   field is meaningless (and a stricter validator could reject it).

## Consequences

- The real root cause (silent buffering during tool-call streaming) is
  fixed architecturally: any provider that streams tool-call fragments
  through `OpenAICompatibleProvider` now produces genuine timeout-timer
  activity for the whole duration of generation, not just for plain
  text.
- The 30-second default is preserved everywhere it matters (remote/
  cloud providers, and as the fallback default if
  `localStreamTimeoutMs` is never configured) — this phase does not
  weaken failure detection for a genuinely stalled connection.
- `tool_call_progress` is additive to the `StreamEvent` union;
  audited every non-core consumer (`voice-pipeline.ts`, UI code, other
  providers) and confirmed none of them exhaustively switches over
  `StreamEvent.type` in a way a new variant could break, and none of
  them can ever observe this event at all, since `AIOrchestrator`
  never forwards it.
- Real re-verification of this fix (does the real Windows run now
  complete without timing out, does the model-produced tool call still
  parse correctly with `--jinja` and thinking disabled) is the explicit
  next step — not yet performed as of this document. This phase fixes
  the mechanism with high confidence given how precisely it explains
  every reported symptom, and adds first-class test coverage for the
  mechanism itself (`streaming.test.ts`, `orchestrator.test.ts`,
  `openai-compatible.test.ts`), but does not claim the real hardware
  round-trip is confirmed until the user reports it.
