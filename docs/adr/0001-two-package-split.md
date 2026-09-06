# ADR 0001: Two-package split — extend `@ryper/plugin-sdk`, add `@ryper/plugin-platform`

**Status:** Accepted (Phase 9)

## Context

Phase 9's brief asks for a much richer plugin system (manifest versioning,
full lifecycle, sandboxing, permission auditing, a store architecture) than
the two packages that already existed going into this phase:

- `plugins/sdk` (`@ryper/plugin-sdk`): the author-facing `definePlugin`/
  `defineAction` helpers, used by `plugins/examples/example-plugin`.
- `core/plugin-runtime` (`@ryper/plugin-runtime`): the minimal capability-
  checked action registry/invoker `definePlugin`'s output feeds into.

The ground rules for this phase require reusing existing implementations,
extending rather than replacing, never renaming packages, and never
modifying unrelated modules.

## Decision

Two changes, not one new monolithic package:

1. **Extend `@ryper/plugin-sdk` additively.** `definePlugin`/`defineAction`
   keep their exact existing signatures and return shape for
   `manifest`/`actions` — every existing caller (including
   `plugins/examples/example-plugin` and its tests) is unaffected. New,
   entirely optional fields (`extended`, `lifecycle`) and new exported
   interfaces (`PluginContext` and its sub-interfaces) are additive only.
2. **Add a new package, `core/plugin-platform`**, for everything that has
   no existing home: the richer manifest, dependency resolution, the
   sandbox, permission groups/audit, lifecycle state machine, diagnostics/
   metrics/logging, the event bridge, and the Plugin Store format. This
   package _depends on_ `@ryper/plugin-sdk` and `@ryper/plugin-runtime`
   (and, for cross-integration, `@ryper/tool-framework` and
   `@ryper/planner`) — it does not fold their logic in.

`@ryper/plugin-runtime` itself was not modified; `PluginPlatformRegistry`
and `PluginManager` are a richer layer _on top of_ it, not a replacement.

## Consequences

- No backward-compatibility break: `plugins/sdk`'s own test suite and
  `plugins/examples/example-plugin` pass unchanged.
- A plugin author only ever imports `@ryper/plugin-sdk` — the platform
  package is purely a host-side concern, never a plugin-author dependency.
- The cost is one extra package boundary and a small amount of type-only
  coupling (`@ryper/plugin-sdk` now has type-only references to
  `@ryper/tool-framework`, `@ryper/planner`, `@ryper/voice-engine`,
  `@ryper/memory-system` for the `PluginContext` interfaces). This is
  judged worthwhile: it keeps the "what does a plugin author see" surface
  small and stable even as the host-side platform grows.
