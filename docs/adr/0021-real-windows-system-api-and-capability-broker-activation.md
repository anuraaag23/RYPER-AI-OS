# ADR 0021: Real PowerShell-backed Windows system API, real capability-descriptor registration, and `--jinja` for real structured tool calling

**Status:** Accepted (Phase 13.12)

## Context

The user asked for the real Qwen3 structured tool-calling path —
`AIOrchestrator` → `ToolRegistry` (Tool Framework) → `CapabilityBroker`
— to be implemented and verified end-to-end, with no mocks in the real
integration test. Phases 13.9–13.11 had already made real Qwen3 chat
completion and real cancellation work through this repo's real
provider code. Investigating what a genuinely real tool-calling test
would need to exercise surfaced three real, pre-existing gaps that
would have made "no mocks" impossible to honor without fixing them
first — none are new problems created by this phase; they are
long-standing gaps this is the first attempt to actually close.

### Gap 1: no real `ShellExec` existed anywhere in the repository

`@ryper/windows-agent`'s `PowerShellWindowsSystemApi` has always
accepted an injectable `ShellExec` (`(command: string) =>
Promise<ShellExecResult>`), and its own doc comment already named the
gap: a real desktop shell must inject a real one before it does
anything useful. Nothing in this repository — not `core-bootstrap.ts`,
not any test — ever implemented one. `createWindowsAdapter()`'s
default `systemApi`, used everywhere including production's real
Electron bootstrap on real Windows, is the in-memory reference
implementation. **Every desktop capability the shipped app exposes
(volume, app launch, notifications, ...) has been operating against an
in-process fake, never real Win32/WMI state, on every platform,
including real Windows, since these features were first built.**

### Gap 2: `WINDOWS_CAPABILITY_DESCRIPTORS` was never registered with `CapabilityManager`

`CapabilityManager.invoke()`'s permission-check pipeline
(`CapabilityPermissions.requestPermission()`, which is what actually
calls into `CapabilityBroker`) only runs `if (descriptor)` — and
`registry.get(domain)` only returns a descriptor if something called
`capabilityManager.registerCapability(descriptor)` for that domain.
Nothing in this repository ever did, for any domain, anywhere —
`WINDOWS_CAPABILITY_DESCRIPTORS` was only ever consumed internally by
`WindowsAdapter` itself (`knownDomains`, `getCapabilityDescriptor()`),
never handed to the `CapabilityManager` that's supposed to enforce it.
**`CapabilityBroker` has therefore never actually been consulted for
any real desktop action, in production or in any existing test.** The
"real, structural tool-call security" Phase 13.9's ADR 0020 correctly
describes is real at the schema-validation layer inside
`ToolRegistry.invoke()`; the deeper consent-gating layer it was
designed to also enforce has been silently inert underneath it.

### Gap 3: no registered desktop tool ever set `requiredCapability`

`ToolRegistry.invoke()` has had its own direct broker hook
(`if (tool.requiredCapability && this.broker) this.broker.assertGranted(...)`)
since Phase 13.9, but every tool `desktop-tools.ts` builds
(`open_application`, `set_volume`, `mute`, `media_play`, ...) reaches a
capability domain (`application_control`, `audio`) whose descriptor has
no `requiredCapability` set at all — so this hook has never actually
fired for any registered tool.

### A fourth, adjacent finding: real llama-server needs `--jinja` for tool calling

`LlamaServerManager` (Phase 13.9) launches `llama-server` with `-m`,
`--port`, `--host` only. Recent llama.cpp builds (matching the user's
real `b10453`) only render a GGUF's embedded Jinja chat template — the
thing that encodes Qwen3's tool-call format — when started with
`--jinja`; without it, the server falls back to a generic completion
template with no tool-call-aware parsing hooks, and `tools`/
`tool_calls` in the OpenAI-compatible wire format never round-trip
correctly. This doesn't affect Phase 13.10/13.11's already-verified
real plain chat and cancellation (they don't request tools), so it
went unnoticed until this phase specifically needed real tool calling.

## Decision

1. **`platform/desktop-app/electron/windows-shell-exec.ts` (new):**
   `createNodePowerShellExec()`, a real `child_process.execFile`-backed
   `ShellExec` that runs `powershell.exe -NoProfile -NonInteractive
-Command <command>` and reports the real exit code/stdout/stderr —
   never a shell-interpreted `exec()`, never a mock.

2. **`core-bootstrap.ts`:** on `win32`, `createWindowsAdapter()` is now
   given `{ systemApi: createPowerShellWindowsSystemApi(createNodePowerShellExec()) }`
   instead of no override, and `WINDOWS_CAPABILITY_DESCRIPTORS` is now
   registered with `capabilityManager` right after the adapter. This is
   a real, material behavior change for the shipped app on real
   Windows: desktop actions now touch real Win32/WMI state via real
   PowerShell instead of an in-memory fake, and the domains whose
   descriptors declare a `requiredCapability` (`notifications`,
   `filesystem.write`, `automation.execute` — process management,
   background services, registry) are now actually gated by
   `CapabilityBroker` for the first time. Domains without a
   `requiredCapability` (`audio`, `application_control`,
   `window_management`, `clipboard`, `display`, `device_information`,
   `security`, `diagnostics`) are unaffected — they were, and remain,
   intentionally ungated; this ADR does not change that policy, only
   makes the policy that already existed on paper actually take effect.
   Since `main.ts`'s real `ConsentPrompt` always denies (no consent UI
   exists yet — see its own comment), the practical effect today is
   that the three now-gated domains will be **denied by default** on
   real Windows until a real consent UI ships. That is the intended,
   fail-closed behavior this architecture was designed to have — not a
   regression introduced here.

3. **`llm-model-provisioning.ts`:** `LlamaServerManager` now launches
   `llama-server` with an added `--jinja` flag.

4. **`desktop-tools.ts`/`desktop-actions.ts`:** a new `show_notification`
   tool (safe, non-destructive, easily verified) is the first desktop
   tool to set `requiredCapability: "notifications"`, activating
   `ToolRegistry`'s own broker hook for the first time.

5. **New tests:**
   - `platform/desktop-app/test/desktop-tools-capability-broker.test.ts`
     (always runs, no hardware/LLM required): proves, with real
     `ToolRegistry`/`CapabilityBroker`/`CapabilityManager` code (using
     the in-memory reference `WindowsSystemApi`, the same legitimate
     test double the rest of this repo's fast suite already uses —
     not a mock of anything this test verifies), that
     `show_notification` is genuinely refused without a prior grant
     and genuinely succeeds with one, closing the gap that this
     enforcement path had zero coverage anywhere before this phase.
   - `platform/desktop-app/test/tool-calling.real.test.ts` (opt-in,
     same env-var gating as `llm-runtime.real.test.ts`, plus
     `process.platform === "win32"`): drives a real Qwen3 prompt
     through the real, unmodified `AIOrchestrator` → real `ToolRegistry`
     → real `CapabilityBroker` → real `CapabilityManager` → real
     `PowerShellWindowsSystemApi` → real `powershell.exe`, and asserts
     a real, model-produced tool call, a real capability grant/audit
     trail, real execution, and a real round-tripped final reply. No
     mocks anywhere in this path.

## Known follow-up (not fixed by this phase)

`ToolRegistry.invoke()`'s own `requiredCapability` check
(`assertGranted`) and `CapabilityManager.invoke()`'s permission check
(`requestPermission`, which self-requests/grants via the broker) use
**different actor identities** for the same logical call:
`AIOrchestrator` never passes an explicit `actorId` into
`toolRegistry.invoke()`, so it always defaults to `"ai-engine"`; but
`desktop-tools.ts`'s `execute()` closures pass their own
`actorId` (`"ai-orchestrator"` by default) into
`capabilityManager.invoke()`. `ToolRegistry`'s check is a hard
assertion with no self-granting path, so nothing in the real
end-to-end flow ever satisfies it on its own — both real tests above
work around this with an explicit, real pre-grant for `"ai-engine"`
before invoking the tool, mirroring what a real one-time consent grant
(e.g. a future Settings UI toggle) would already have done. Aligning
these two actor identities (or removing the redundant `ToolRegistry`
check in favor of relying solely on `CapabilityManager`'s
self-granting one) is real follow-up work, not resolved here.

## Consequences

- Positive: the real Qwen3 → `AIOrchestrator` → `ToolRegistry` →
  `CapabilityBroker` → real Windows action → back to Qwen3 path the
  user asked for is now genuinely implementable and (pending the
  user's real-hardware run) verifiable without any mock in the loop.
- Positive: this closes a real, previously-undetected gap where the
  shipped app's own capability-consent design was inert on real
  Windows.
- Risk: on real Windows, `notifications`/`filesystem.write`/
  `automation.execute`-gated actions will now be denied by default
  (fail-closed, correct-but-newly-visible) until a real consent UI
  exists — worth flagging prominently in release notes so it isn't
  mistaken for a regression.
- Scope not addressed: the actor-identity mismatch noted above; a real
  consent UI; extending `--jinja`/tool-calling verification to cloud
  providers.
