# ADR 0006: `CapabilityResolver` gains an injectable `PlatformSupportSource`

**Status:** Accepted (Phase 10)

## Context

The brief's Planner Integration requirement is explicit: "The Planner must
query the Platform Capability Layer before generating executable plans.
Planning decisions should adapt to the capabilities exposed by the active
platform adapter." `@ryper/planner`'s `CapabilityResolver` (Phase 7)
already exists and answers a very similar question — "can this task type
run on this platform?" — but from a static, hardcoded per-platform table
(`platformSupport` in `capability.ts`), not a live adapter query.

## Decision

Add one optional constructor parameter to `@ryper/planner`'s
`CapabilityResolver`:

```ts
export type PlatformSupportSource = (taskType: TaskType, platform: SupportedPlatform) => boolean;

export class CapabilityResolver {
  constructor(private readonly supportSource?: PlatformSupportSource) {}
  // resolve() uses supportSource if provided, else the existing static table
}
```

`PlannerEngineOptions` gains a matching optional `capabilityResolver`
field, defaulting to `new CapabilityResolver()` exactly as before.
`@ryper/platform-capability`'s `createPlannerCapabilitySource(manager)`
builds a `PlatformSupportSource` backed by a real `CapabilityManager`
query (`manager.resolve(domain, platform).supported`), mapping
`TaskType` → `CapabilityDomain` via `TASK_TYPE_TO_DOMAIN`.

This was judged the minimal, safest change: it touches two files in an
existing package (`capability.ts`, `planner-engine.ts`), both changes are
purely additive (new optional parameters with defaults reproducing the
exact previous behavior), and every existing caller — including Phase
7/8/9's own test suites — needed zero changes.

## Consequences

- `new CapabilityResolver()` and `new PlannerEngine()` behave identically
  to before this phase; verified by Phase 7's full existing test suite
  passing unchanged.
- A host wiring up the real Platform Capability Layer gets genuinely
  dynamic, adapter-driven planning decisions by passing one extra
  constructor argument — no fork of `@ryper/planner`, no duplicated
  planning logic in `@ryper/platform-capability`.
- The `TaskType` → `CapabilityDomain` mapping in `TASK_TYPE_TO_DOMAIN` is
  necessarily lossy (19 task types onto a broader, coarser-grained
  40-domain set) — documented as a known simplification in
  `core/platform-capability/README.md`, not hidden.
- `@ryper/planner`'s own `SupportedPlatform` spells the sixth platform
  `"web"`; `@ryper/platform-capability`'s `PlatformId` spells it
  `"browser"` (matching the brief's adapter list). `toPlatformId()` in
  `types.ts` is the single place that translates between the two —
  `createPlannerCapabilitySource` and `CapabilityManager.invoke()` both
  use it, so the mismatch is handled once, not per call site.
