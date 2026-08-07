# ADR 0010: Async `WindowsAdapter.create()`, and a plugin capability-extension registry separate from `CapabilityManager`

**Status:** Accepted (Phase 11)

## Context

Two Phase 11-specific design questions came up that Phase 10's
`PlatformAdapter` contract doesn't answer on its own:

1. `PlatformAdapter.supports()` is synchronous (`docs/adr/0007`), but
   "detect Windows version automatically, gracefully disable unsupported
   features" (the brief) requires knowing the release _before_ answering
   `supports()` — and detecting it is inherently async
   (`WindowsSystemApi.detectWindowsVersion()` returns a `Promise`).
2. The brief separately requires "allow plugins to contribute
   Windows-specific capability implementations without modifying the
   core Windows Platform Agent." `@ryper/platform-capability`'s
   `PluginCapabilityAccess.registerCapability()` (Phase 10) lets a
   plugin declare a new _domain_ to `CapabilityManager` — but nothing
   makes that domain actually do anything on Windows without editing
   `WindowsAdapter` itself, which the brief explicitly forbids.

## Decision

1. **`WindowsAdapter` is constructed only via the async static factory
   `WindowsAdapter.create()`**, never `new WindowsAdapter()` (the
   constructor is private). `create()` awaits
   `WindowsVersionDetector.detect()` once, up front, before the instance
   is ever handed back — so every synchronous method required by
   `PlatformAdapter` (`supports()`, `getDeviceInfo()`,
   `getRuntimeLimitations()`) can read the cached version synchronously
   from then on. Version detection is treated as a one-time
   initialization cost, not a per-call one, on the (documented)
   assumption that a running Windows install's release doesn't change
   mid-process.
2. **A separate `WindowsPluginCapabilityRegistry`** lives inside this
   package. A plugin registers a `(domain, operation) → handler`
   function here — distinct from, and in addition to, declaring the
   domain through `PluginCapabilityAccess.registerCapability()`.
   `WindowsAdapter.invoke()` checks its own built-in dispatch table
   first, then falls back to this registry, so adding a new capability
   is purely additive: no `if` branch in `windows-adapter.ts` ever
   mentions a specific plugin.

## Consequences

- `supports()` before `create()` resolves would have to either lie
  (assume supported) or block synchronously (impossible for an async
  detection call); requiring `create()` avoids the question entirely by
  making "not yet initialized" an unrepresentable state for a caller
  holding a `WindowsAdapter` instance.
- A platform shell that wants to start showing UI before Windows-version
  detection finishes must do so around `WindowsAdapter.create()`'s
  `await`, not around individual capability calls — a startup-latency
  tradeoff, not a per-call one. `README.md`'s "Performance
  Considerations" section quantifies this as effectively free against
  `InMemoryWindowsSystemApi` and a single PowerShell round-trip against
  `PowerShellWindowsSystemApi`.
- Two registration steps (`CapabilityManager.registerCapability()` +
  `WindowsPluginCapabilityRegistry.register()`) for one new
  plugin-contributed Windows capability is more ceremony than one, but
  keeps the separation of concerns Phase 10 already established: PCL
  owns _whether a domain is visible and permission-gated_;
  `windows-agent` owns _what actually runs on Windows for it_. Collapsing
  the two would mean `@ryper/platform-capability` — a package meant to
  stay platform-agnostic — would need to know about Windows-specific
  plugin extension points.
