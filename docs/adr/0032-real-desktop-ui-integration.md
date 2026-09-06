# ADR 0032: Real desktop UI integration — text chat, confirmation dialogs, shared session state

**Status:** Accepted (Tier 1 implementation-only pass — testing/certification intentionally deferred, per this pass's own scope)

## Context

This pass's brief was to inspect the repository for every remaining
Tier 1 implementation gap and, specifically, to integrate the actual
Electron desktop UI with the real backend rather than leaving it as a
standalone prototype. Inspection surfaced one severe,
previously-undiscovered gap and one long-repeated, now-closeable one.

## Decision

### 1. The desktop app's text chat was completely disconnected from the real AI backend

`platform/desktop-app/electron/ipc-handlers.ts`'s `sendTurn`/
`regenerateMessage` — the handlers behind every message typed into the
chat UI — called `core.webShell.conversation.sendMessage(...)`, i.e.
`@ryper/web-shell`'s `ConversationEngine`. `core-bootstrap.ts` called
`createWebShell()` with **zero arguments**, and `createWebShell()`'s
own default model providers are literal placeholders:

```ts
const defaultLocalModel: ModelProvider = {
  id: "local-placeholder",
  target: "local",
  generate: async (prompt) => `[local model] ${prompt}`,
};
```

**Every message typed into the desktop app's chat window received this
literal echo string back**, regardless of what was actually typed, and
had no access to any real tool, capability, or model — completely
bypassing all of the real `AIOrchestrator`/`ToolRegistry`/
`buildDesktopToolDefinitions()` work built up over the entire Tier 1
effort. Voice was never affected — `VoicePipeline` already called the
real orchestrator directly — but text, arguably the primary way a
desktop chat app's own UI is used, was never wired to it at all.

**Fix**: `VoiceBundle` (`voice-bootstrap.ts`) now exposes the real,
already-constructed `AIOrchestrator` instance (`orchestrator`), the
real `PowerConfirmationManager` and `ContextReferenceTracker`
(`powerConfirmation`, `contextTracker`), and the AI Engine's own
`SessionManager` (`aiSessionManager`) — the same instances voice
already uses. A new `runTextTurn()` (`text-chat.ts`) routes a text
message through that shared orchestrator (`conversationId` doubles as
the orchestrator's own session id), consuming its `StreamEvent`s the
same way `VoicePipeline.askAIOrchestrator` already does. `sendTurn`/
`regenerateMessage` now call this instead of `ConversationEngine`.

**A necessary consequence, fixed alongside it**: text and voice now
share the same real tool-calling and the same real power-action
confirmation state. Without a matching fix, a _typed_ "shut down my
pc" would correctly register a pending confirmation and ask, but a
_typed_ "yes" reply would have no way to resolve it — the
confirmation-interception logic previously lived only inside
`VoicePipeline.runTurn()`. Extracted into a shared, exported
`tryResolvePowerConfirmation()` (`power-confirmation.ts`), now called
from both `VoicePipeline.runTurn()` (as a thin wrapper, unchanged
behavior) and `runTextTurn()`.

**A secondary, honestly-disclosed side effect**: `ipc-handlers.ts`'s
`searchMemory` previously read `ConversationEngine`'s own short-term
memory buffer — which nothing populates anymore, since real chat no
longer flows through it. Rewired to search the real AI Engine
`SessionManager`'s per-session short-term history instead (exposed via
the new `aiSessionManager` field), preserving the original feature's
actual behavior (a conversation-agnostic recent-turns search, which is
what the original implementation did too, since `ConversationEngine`
only ever had one shared buffer regardless of conversation id).

`createWebShell()`/`ConversationEngine` were not deleted — `webShell`'s
`eventBus` and `getDeviceState()` are real and still used; only the
`.conversation` field is now unused by any real code path in this app.

### 2. No real, UI-backed confirmation existed for `CapabilityBroker` or `DestructiveActionGate`

`main.ts` passed a literal `async () => false` as `consentPrompt`, and
`createWindowsAdapter()` was never given a `destructiveActionConfirmer`
at all — both defaulted to deny-everything, a gap named honestly and
repeatedly across ADRs 0021, 0030, and 0031, but never closed because
no real Electron renderer UI existed to ask through.

**Fix**: a new main<->renderer round trip (`confirmation-bridge.ts` +
new `confirmationRequested`/`respondToConfirmation` IPC channels)
pushes a real request to the renderer and awaits the person's actual
decision, denying safely if no renderer is available or if there's no
response within 60 seconds — it never hangs forever and never defaults
to approved. A new `ConfirmationDialog` component (mounted once in
`App.tsx`) renders a real modal and sends the decision back. `main.ts`
now wires this same bridge as both the real `consentPrompt`
(`CapabilityBroker`) and the real `destructiveActionConfirmer`
(`WindowsAdapter`'s `DestructiveActionGate`) — one real mechanism
backing both, not two.

**This does not replace or weaken any existing gate.** Both
`CapabilityBroker.requestCapability()` and `DestructiveActionGate.require()`
are entirely unchanged — they still deny by default, still audit every
decision, still cannot be bypassed. The only change is that the
function they call to ask a human is now a real dialog instead of a
hardcoded `false`.

## Consequences

- Text chat and voice now share one real orchestrator, one real
  power-confirmation state, and one real contextual-reference tracker
  — a tool call or an "open this" reference made via either surface is
  visible to the other, matching how a single-user desktop app should
  behave.
- Every capability grant and every destructive action (file deletion,
  shutdown/restart/sleep, and any future one) now has a real path to
  genuine user approval, closing the single most-repeated honest
  limitation in this project's history.
- `searchMemory`'s behavior changed from reading a dead buffer to
  reading real history, restoring the feature rather than leaving it
  silently broken as a side effect of the text-chat fix.

## What this does not do (honest scope)

- `ConversationEngine`/`@ryper/web-shell`'s conversation field is not
  deleted, only unused by any real call path in this app — removing
  the package/type entirely was judged out of scope for this pass
  (broader blast radius, not requested).
- The confirmation dialog is a single, generic approve/deny modal — it
  does not yet have per-capability-type visual treatment (e.g. a
  distinct look for "delete a file" vs. "use the microphone").
- `searchMemory`'s new implementation calls `ContextManager.gather("")`
  per session, which also (harmlessly, but unnecessarily) exercises the
  vector-store/long-term-memory search paths with an empty query since
  `gather()` has no lighter-weight "just the short-term turns" method;
  a real inefficiency, not a correctness bug.
- No macOS/Linux `PlatformAdapter` exists — unchanged, pre-existing,
  out-of-scope-for-Windows-Tier-1 limitation.
- `BrowserResolver`'s discovery tiers, and the real confirmation
  dialog/bridge built in this pass, remain unverified against actual
  Windows/Electron hardware — nothing in this sandboxed environment can
  run a real Electron window or real Windows APIs.

## Testing

Testing intentionally deferred to the next phase, per this pass's own
explicit scope. A targeted `tsc --build` compile check (not a full
lint/test/format/certification pass) was run after each implementation
batch as a development aid, and confirmed clean throughout. No
real-hardware or Electron-runtime verification was performed.
