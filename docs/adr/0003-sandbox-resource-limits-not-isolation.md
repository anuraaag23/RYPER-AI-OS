# ADR 0003: `PluginSandbox` enforces resource limits, not process isolation

**Status:** Accepted (Phase 9)

## Context

The brief asks every plugin to "execute in a sandbox" with "Permission
Isolation, Resource Limits, Memory Limits, CPU Limits, API Restrictions,
Filesystem Restrictions, Network Restrictions." This build environment has
no native toolchain, no V8 isolate/worker-thread boundary in use by
`@ryper/plugin-runtime`, and no OS-level process sandboxing (seccomp,
containers, etc.) available to call into — the same category of
constraint earlier phases hit with audio hardware and native schedulers.

## Decision

Split the sandbox's responsibilities by what can be honestly implemented
today:

- **Permission isolation, filesystem restriction, network restriction**
  are already real: `@ryper/plugin-runtime`'s `PluginRuntime.invoke()`
  checks capability grants via `@ryper/security`'s `CapabilityBroker`
  before running any action. `PluginSandbox` doesn't re-implement this —
  it calls straight through to `PluginRuntime.invoke()`.
- **Resource/memory/CPU limits** are enforced as three concrete,
  measurable proxies layered around that same call: a per-plugin
  concurrent-call ceiling, a wall-clock timeout per call, and a
  JSON-serialized-payload byte ceiling on both input and output (a
  memory-usage proxy, not true heap accounting). These are real, tested,
  and actually reject calls that violate them — not placeholders.
- **API restrictions** are structural: a plugin's only route to Core
  capabilities is through `PluginContext` (see ADR 0002), which is itself
  a restricted API surface.

`core/plugin-platform/README.md` states plainly that this is not a real OS
sandbox.

## Consequences

- Every limit `PluginSandbox` enforces is real and independently testable
  (see `test/sandbox.test.ts`) — nothing here silently no-ops.
- A malicious plugin could still, in principle, exhaust host-process
  memory in ways the payload-size proxy doesn't catch (e.g. leaking
  references across calls) — that gap is documented rather than papered
  over, and a future phase with access to worker threads or a native host
  process boundary is the natural place to close it.
- Should a real process/isolate boundary become available, only
  `PluginSandbox`'s internals need to change — `PluginManager.invokeAction()`
  and everything above it stay the same.
