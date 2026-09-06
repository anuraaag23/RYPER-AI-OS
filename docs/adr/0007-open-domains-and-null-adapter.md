# ADR 0007: Open `CapabilityDomain` strings and a real null adapter

**Status:** Accepted (Phase 10)

## Context

The brief lists 40 capability domains and requires "plugins must be able
to... register new abstract capabilities," while also requiring "do NOT
implement the operating-system-specific logic yet" for the six platform
adapters. Two design questions follow: should `CapabilityDomain` be a
closed TypeScript union, and what should `CapabilityManager` do when a
caller asks about a platform with no adapter registered yet (true for
every platform, in this phase)?

## Decision

1. **`CapabilityDomain` is `type CapabilityDomain = string`**, exactly
   like `@ryper/tool-framework`'s `ToolCategory` (Phase 8) and
   `@ryper/plugin-platform`'s `PluginType` (Phase 9) before it.
   `BUILTIN_CAPABILITY_DOMAINS` lists the brief's 40 as a typed constant
   array for call-site convenience, never as the type itself. A plugin
   registering `"custom.weather_widget"` needs no change to this
   package.
2. **`createNullAdapter(platform)` is a real, fully-implemented
   `PlatformAdapter`** — not a `throw new Error("not implemented")`
   stub — that honestly reports zero supported domains, "unknown" device
   info, and one runtime limitation explaining why. `PlatformResolver`
   returns it automatically whenever `AdapterRegistry` has nothing
   registered for the requested platform.

## Consequences

- Every `CapabilityManager.resolve()`/`.invoke()`/`.discover()` call
  returns a real, well-formed answer today, for every one of the six
  platforms, with zero real adapters implemented yet — satisfying "avoid
  runtime failures, provide graceful degradation" from day one rather
  than only once Windows/macOS/etc. adapters exist.
- A plugin (or a future real adapter) can register a brand-new domain or
  swap in a real implementation (`AdapterRegistry.replace()`) without
  touching this package's source.
- The tradeoff, consistent with every prior phase's honesty pattern
  (Phase 6's audio hardware, Phase 7's scheduler, Phase 9's sandbox): the
  null adapter's "unsupported everywhere" answer is accurate today but
  will need real per-platform adapters — Phase 10 explicitly defers that
  work, and `core/platform-capability/README.md`'s limitations section
  says so plainly.
