# ADR 0031: Power-action confirmation flow, contextual "open this", and a real cancellation gap closed

**Status:** Accepted (Tier 1 implementation-only pass — testing/certification intentionally deferred, per this pass's own scope)

## Context

Following ADR 0030, the remaining named Tier 1 work was: (1) a real
confirmation UX for power actions (ADR 0030 shipped the capability and
its `DestructiveActionGate` boundary, but not the two-turn "are you
sure?" conversational flow), (2) closing two small real gaps in the
already-shipped universal-open/browser work, (3) a contextual
"open this"/"play this" reference mechanism, and (4) a further
STT/TTS/cancellation lifecycle audit. This ADR covers all four.

## Decision

### 1. Real, two-phase power-action confirmation

New `platform/desktop-app/electron/power-confirmation.ts`:

- `PowerConfirmationManager` — tracks at most one pending confirmation
  at a time, each with a unique id and a 30-second TTL. `request()`
  replaces any previous pending confirmation (only the newest is ever
  live — no duplicate/stale confirmations can coexist). `resolve()`
  always clears the record and distinguishes `confirmed`/`denied`/
  `cancelled`/`expired`/`not_pending` — the exact five outcomes named
  in the brief.
- `matchConfirmationResponse()` — deliberately narrow, anchored regex
  matching for yes/no/cancel responses. An utterance that doesn't
  clearly match one of these is never treated as confirmation (the
  brief's explicit "do not silently interpret ambiguous language as
  confirmation").

`desktopActions.shutdown`/`restart`/`sleep` no longer touch the
capability layer on their first call at all — they register a pending
confirmation and return the spoken prompt. The _only_ path that
actually reaches `power_management` is a new
`executeConfirmedPowerAction`, called exclusively from a new
interception block in `VoicePipeline.runTurn()` that checks for a
pending confirmation and tries to match the transcript against
yes/no/cancel _before_ normal intent detection/command routing/AI
orchestration — so a bare "yes" can never accidentally match some
unrelated intent instead of answering the pending question.

**This is an additional, independent gate, not a replacement for
`DestructiveActionGate`** (ADR 0030): saying "yes" here is what makes a
_second_, real call into the capability layer happen at all — that
call still goes through the entire existing, unchanged authorization
chain, deny-by-default absent a real UI-backed confirmer.

**A real design problem found while wiring this**: `VoiceSessionManager`
issues a _new_ `sessionId` every time a turn returns to `idle` — using
it as the confirmation-tracking key would mean the "shutdown" request
and the "yes" response, in two separate turns, could never actually
match. Fixed by tracking confirmations (and, see below, the contextual
reference) under one fixed key (`POWER_CONFIRMATION_SESSION_KEY`),
reflecting that this is a single-user desktop app — there is one real
person on the other end of the microphone, regardless of which
internal code path (voice command vs. AI tool call, which use
different `actorId`s for capability-auditing purposes) happened to
register the request.

### 2. Universal-open closure

`list_browsers` and `launch_browser` were implemented at the
`WindowsAdapter`/`ApplicationManager` layer in ADR 0030 but never
actually exposed as AI tools, despite being named explicitly in this
phase's own tool-schema review list (PART 17). Added both.

### 3. Contextual "open this"

New `platform/desktop-app/electron/context-reference.ts`:
`ContextReferenceTracker` — a small, focused, single-mutable-slot
abstraction (10-minute TTL), deliberately _not_ built on the existing
`VoiceContextManager`, which is a bridge into `@ryper/memory-system`'s
long-term semantic memory and not a fit for "the one specific thing
being referred to right now."

**How it's populated, honestly**: this pipeline has no UI-level
"attachment" or "currently displayed item" concept — there's no screen
the user is pointing at. The one real, non-fabricated signal available
is the pipeline's own successful actions: whenever `open_file`/
`open_folder`/`open_url`/`smart_open` genuinely succeeds, that real
target becomes the new current reference. Nothing is ever set from raw
conversation text.

A new `open_this` tool/handler reads it and dispatches to the matching
real action, and returns the brief's exact specified failure message
when nothing is set: _"I don't have a file, folder, or link to open
right now."_ "Open this"/"open this folder"/"open that PDF" all start
with "open " and are therefore caught by `openApplication`'s own
fallback chain (the same architectural constraint ADR 0030 already
documented for "open YouTube"/"open my Downloads folder" — a dedicated
pattern starting with "open" can never be reached, since
`open_application`'s pattern matches any "open ..." phrase first).
"Play this video" and "show me this" don't start with "open " and got
real, dedicated voice patterns instead.

### 4. A real, serious cancellation gap found and closed

`ToolRegistry.invoke()` already received `context.signal` — threaded
all the way from `AIOrchestrator.sendMessage()`'s own caller — but
never actually checked it before calling `tool.execute()`. **A turn
cancelled after the model decided to call a tool but before that tool
actually ran would still execute it in full.** For an ordinary tool
this is merely wasted work; for a destructive/system-impacting one
(`shutdown`, `delete_file`, any power action), it's a real correctness
problem — the user cancelled, and the real action happened anyway.
Fixed with one structural check before every `execute()` call, using
the signal that was already there; no second cancellation mechanism
was introduced.

Also fixed a related, smaller real gap: `buildToolResult()` could
produce a `content` value of the literal JavaScript `undefined` (via
`JSON.stringify(undefined)`, which returns `undefined`, not the string
`"undefined"`) whenever any tool's `execute()` had no explicit return
value — silently violating `ToolResult.content`'s own `string` type at
runtime, and risking that `undefined` reaching `AIOrchestrator`'s
message history. `buildToolResult()` now explicitly maps
`undefined`/`null` to an empty string.

## Security review (PART 19)

Reviewed every new path introduced by this pass:

- No new shell/PowerShell/generic-execution tool was added.
- `PowerManager`'s real PowerShell commands (from ADR 0030, unchanged)
  remain fixed literals with zero interpolation.
- Browser/URL launches still pass the URL as a separate `startProcess`
  argument (PowerShell's `-ArgumentList`, each element `psQuote`'d
  individually) — never concatenated into a shell string, so no
  argument-injection surface from a crafted URL.
- The new `ToolRegistry` cancellation check runs _after_ the existing
  `assertGranted` capability check, not before — purely additive, no
  bypass of the existing authorization order.
- Path handling (`PathResolver`, unchanged from ADR 0030) still only
  expands the one narrow, hardcoded `%USERPROFILE%` case; anything else
  reports a clear error rather than guessing.
- `ContextReferenceTracker` and `PowerConfirmationManager` are both
  single-slot, single-user stores by deliberate design (this is a
  single-user desktop app) — not a multi-tenant data structure, so
  there is no cross-user leakage to guard against in this deployment
  model.

## Consequences

- Power actions now have the real, two-turn conversational safety flow
  the brief specified, layered on top of (not instead of) the existing
  capability/confirmation architecture.
- The `ToolRegistry` cancellation fix applies to _every_ tool call in
  this codebase, not just the ones this pass added — a real
  reliability improvement with broader reach than its immediate
  motivation.

## What this does not do (honest scope)

- No confirmation UI still exists for `DestructiveActionGate` itself
  (unchanged honest limitation from ADR 0030) — the new voice
  confirmation flow is a real, independent, user-facing gate, but the
  underlying capability-layer gate still denies by default absent a
  real UI-backed confirmer.
- `ContextReferenceTracker` only tracks the single most recent
  reference — it does not maintain a history, and does not attempt to
  resolve genuinely ambiguous cases ("open the other one").
- The STT/TTS/cancellation audit in this pass found and fixed one
  serious bug (the `ToolRegistry` signal check); it re-verified, but
  did not need to change, the device-failure/recovery paths already
  hardened in ADR 0030.

## Testing

Testing intentionally deferred to the next phase, per this pass's own
explicit scope. A targeted `tsc --build` compile check (not a full
lint/test/format/certification pass) was run after each implementation
batch purely as a development aid.
