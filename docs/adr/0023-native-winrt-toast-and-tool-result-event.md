# ADR 0023: Native WinRT toast notifications, and a real `tool_result` event so tool success is never inferred from narration

**Status:** Accepted (Phase 13.14)

## Context

Phase 13.13's real Windows/RTX 4050/Qwen3 run got further than any
prior real-hardware run of the tool-calling path: real detection, real
capability grant, real `ToolRegistry` invocation, real execution
reaching the real Windows Platform Agent. It then failed with:

```
windows-agent:diagnostics-manager: capability invocation failed
  domain: notifications, operation: show, ok: false
  errorMessage: "PowerShell command exited with code 1"

ai-engine:tool-calling: tool execution threw
  tool: show_notification
  error: "I couldn't do that: PowerShell command exited with code 1"
```

Qwen3 received this failure and, correctly, narrated it gracefully:
_"It seems there was an issue with showing the notification..."_ The
test still reported PASS, because its only relevant assertion was
`events.some(e => e.type === "error") === false` — and a caught
`execute()` failure never produces an orchestrator-level `error`
event; it becomes a normal `{ok: false}` tool result, silently fed
into the next round's message history. Two separate real problems,
investigated and fixed together.

## Problem 1: the notification implementation depended on a module that was never installed

`PowerShellWindowsSystemApi.showNotification()`
(`core/windows-agent/src/powershell-system-api.ts`) built:

```powershell
New-BurntToastNotification -Text '...','...'
```

`New-BurntToastNotification` is a cmdlet from the third-party
**BurntToast** PowerShell module (PowerShell Gallery), which requires
an explicit `Install-Module BurntToast` — something this repository
has never provisioned, documented, or even mentioned anywhere. On a
stock Windows 11 machine, invoking an unrecognized cmdlet is exactly a
`powershell.exe` exit code 1 — precisely the failure reported. Per the
user's explicit instruction, installing a third-party module just to
make the test pass, without it being an architecture decision the
project explicitly supports and documents, was rejected as an option.

### Investigation

- The exact PowerShell command generated: confirmed above, calling a
  cmdlet from an uninstalled module.
- Windows Runtime / WinRT: not previously used at all for this call.
- PowerShell 5.1 vs 7: `createNodePowerShellExec()`
  (`platform/desktop-app/electron/windows-shell-exec.ts`) always
  invokes `powershell.exe` — classic Windows PowerShell 5.1, not
  `pwsh.exe`/PowerShell 7. This matters for the fix below: PowerShell
  7's separate .NET (Core) WinRT interop has real, documented gaps
  with directly instantiating WinRT toast types that don't affect
  Windows PowerShell 5.1 — which is, notably, the actual underlying
  reason the BurntToast module exists at all (it ships a compiled
  helper assembly specifically to paper over that PS7 gap). Since this
  repo only ever shells out to `powershell.exe`, that gap is not a
  concern here.
- AppUserModelID/Start Menu registration: WinRT toast notifications
  require an AUMID. Rather than requiring this repo's desktop app to
  register a custom AUMID (real, but out of scope for this fix), the
  well-established technique of using the AUMID Windows itself already
  pre-registers for `powershell.exe`
  (`{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe`)
  avoids needing any additional registration.

### Fix

`showNotification()` now builds a genuinely Windows-native command
using `Windows.UI.Notifications.ToastNotificationManager` and
`Windows.Data.Xml.Dom.XmlDocument`, loaded by fully-qualified WinRT
type name (`[Namespace.Type, Assembly, ContentType = WindowsRuntime]`),
with `$ErrorActionPreference = 'Stop'` so a real WinRT activation
failure is still a real, non-zero-exit failure rather than a silently
swallowed non-terminating error. Title/body are XML-escaped (a new
`xmlEscape()` helper, layered underneath the existing `psQuote()`
PowerShell-string escaping — two different escaping contexts) so
notification text can't break out of the toast XML payload. No
external module is installed, referenced, or required.

## Problem 2: a real tool failure was invisible to the public `StreamEvent` stream

`ToolRegistry.invoke()` already correctly catches a thrown
`execute()` error and returns `{ok: false, content: "..."}` rather
than propagating an exception — existing, correct, defensive design.
But `AIOrchestrator.sendMessage()` (`core/ai-engine/src/orchestrator.ts`)
only ever used that result internally, to build the next round's `tool`
message — it was never surfaced as a `StreamEvent` to the caller. The
_only_ way a caller could infer success or failure was the model's own
subsequent narration — and a model narrating a failure gracefully
(exactly what it's supposed to do) is not evidence the underlying
action worked, and is not something a real test should rely on
parsing.

### Fix

`StreamEvent` gains a `tool_result` variant
(`{ type: "tool_result"; toolCallId; name; ok; content }`), yielded by
`AIOrchestrator` immediately after `ToolRegistry.invoke()` returns,
carrying the real, authoritative `ok`/`content` straight from the real
result — before the model ever gets a chance to narrate it. Unlike the
internal-only `tool_call_progress` heartbeat (docs/adr/0022), this
event _is_ forwarded to `sendMessage()`'s own callers, since it's
genuinely useful, real information a caller (a real test, a future UI)
should be able to observe directly.

## Decision

Both problems are fixed for real, not worked around in the test:

1. `powershell-system-api.ts`'s `showNotification()` uses native WinRT
   APIs; no third-party module dependency exists anywhere in this path.
2. `AIOrchestrator` yields a real `tool_result` event for every tool
   invocation.
3. `tool-calling.real.test.ts` now asserts directly on
   `toolResultEvent.ok === true` — the authoritative signal — rather
   than only the absence of an orchestrator `error` event. A secondary,
   approximate check on the final reply's wording (no "failed",
   "couldn't", etc.) is retained as a real, if fragile-by-nature,
   sanity check layered _on top of_ the authoritative assertion, not a
   substitute for it.
4. Real, always-run test coverage added for both: five new
   `powershell-system-api.test.ts` tests confirm the generated command
   uses only native WinRT APIs (and explicitly asserts `BurntToast`
   never appears in it), uses the pre-registered AUMID, sets
   `$ErrorActionPreference`, and correctly XML-escapes untrusted
   content; two new `orchestrator.test.ts` tests confirm `tool_result`
   is yielded on both success and — mirroring the exact real failure
   this phase found — on a caught `execute()` failure that the model
   narrates gracefully, with no orchestrator `error` event.

## Consequences

- Real desktop notifications on real Windows no longer depend on an
  undocumented, unprovisioned third-party module.
- Any future real tool-calling test (or real UI) can now distinguish
  genuine tool success from a gracefully-narrated failure without
  parsing the model's own words.
- `tool_result` is additive to the `StreamEvent` union; audited the
  same non-core consumers checked in docs/adr/0022 (`voice-pipeline.ts`,
  no exhaustive `StreamEvent.type` switches anywhere) and confirmed
  none break.
- Real re-verification (does the real Windows notification now
  genuinely display, does `toolResultEvent.ok` read `true` on the
  user's actual hardware) is the explicit next step — not yet
  performed as of this document.
