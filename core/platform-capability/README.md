# @ryper/platform-capability — Platform Capability Layer (PCL)

Phase 10 of RYPER AI OS. The common interface layer every supported
platform must implement, and the **only** thing the AI Engine, Planner,
Tool Framework, and Plugins are allowed to talk to for anything
OS/hardware-touching:

```
User → Voice Engine → AI Engine → Planner → Tool Framework
  → Platform Capability Layer
  → Windows / macOS / Linux / Android / iOS / Browser adapters
```

See `docs/adr/0006`–`0008` for this phase's significant design decisions.

## Architecture

`CapabilityManager` is the facade every caller above this layer uses.
Nothing in this package contains OS-specific logic — every real action
happens inside a `PlatformAdapter`, and per the brief ("Do NOT implement
the operating-system-specific logic yet"), the only adapter this phase
ships is `createNullAdapter()`, a real, honest, zero-capability
implementation (see ADR 0007). Real Windows/macOS/Linux/Android/iOS/
Browser adapters are future-phase work that plugs into the exact same
`PlatformAdapter` contract without any change here.

## Adapter architecture

```
                        PlatformResolver
                       /       |        \
              AdapterRegistry  |   PlatformDetector (injectable)
                       |
        ┌──────────────┼──────────────┬─────────────┬─────────────┬──────────┐
   Windows Adapter  macOS Adapter  Linux Adapter  Android Adapter  iOS Adapter  Browser Adapter
   (future phase)   (future phase) (future phase) (future phase)  (future)     (future)
```

Every adapter — real or the null fallback — implements one contract:

```ts
interface PlatformAdapter {
  readonly platform: PlatformId;
  readonly adapterVersion: string;
  supports(domain: CapabilityDomain): boolean;
  describeCapability(domain: CapabilityDomain): CapabilityDescriptor | undefined;
  invoke(domain, operation, parameters, context): Promise<unknown>;
  getDeviceInfo(): DeviceInfo;
  getRuntimeLimitations(): readonly RuntimeLimitation[];
}
```

`AdapterRegistry.register()`/`.replace()` is registration; `PlatformResolver`
is what turns "what platform am I on" into "which adapter answers for
it" — falling back to `createNullAdapter(platform)` when nothing is
registered yet, so every caller always gets a real, predictable answer.

## Capability registry overview

`CapabilityDomain` is an open `string` (see ADR 0007), not a closed union
— `BUILTIN_CAPABILITY_DOMAINS` names the brief's 40 (`application_control`,
`browser_control`, ... `security`) as typed constants, but
`CapabilityRegistry.register()` accepts any domain string, which is what
makes "plugins can register new abstract capabilities" real. Each domain
gets a `CapabilityDescriptor` (name, description, version, optional
`requiredCapability` for permission-gating, optional
`inputSchema`/`outputSchema` validated with `@ryper/tool-framework`'s
`ToolValidator`).

`CapabilityResolver.resolve(domain, adapter)` asks the adapter itself
whether it's supported — never a hardcoded table — and, on "no," attaches
a human-readable reason and (via a small built-in hint table) a
`suggestedAlternative` when one exists, satisfying the brief's fallback
strategy: report the reason, suggest an alternative, never let a caller
hit a runtime failure.

## Core modules → files

| Module (from the brief)                         | File                          |
| ----------------------------------------------- | ----------------------------- |
| Capability Registry, Capability Metadata        | `capability-registry.ts`      |
| Capability Manager (facade)                     | `capability-manager.ts`       |
| Capability Resolver                             | `capability-resolver.ts`      |
| Platform Resolver                               | `platform-resolver.ts`        |
| Adapter Registry, Adapter Loader (registration) | `adapter-registry.ts`         |
| Adapter contract + reference null adapter       | `adapter-contract.ts`         |
| Capability Validator                            | `capability-validator.ts`     |
| Capability Discovery                            | `capability-discovery.ts`     |
| Capability Diagnostics, Capability Metrics      | `capability-diagnostics.ts`   |
| Capability Configuration                        | `capability-configuration.ts` |
| Permission integration                          | `capability-permissions.ts`   |
| Planner integration                             | `planner-integration.ts`      |
| Tool Framework integration                      | `tool-integration.ts`         |
| Plugin integration                              | `plugin-integration.ts`       |

## Reuse — nothing here was reimplemented that already existed

- **Security (`@ryper/security`)**: `CapabilityPermissions` calls
  `CapabilityBroker.requestCapability()`/`hasGrant()` directly — the same
  "wrap the broker, don't re-implement it" pattern every prior phase's
  permission layer uses.
- **Tool Framework (`@ryper/tool-framework`, Phase 8)**:
  `CapabilityValidator` reuses `ToolValidator`/`JsonSchema` instead of a
  fourth JSON-schema validator; `CapabilityManager.invoke()` accepts a
  real `ToolExecutionContext`; `createCapabilityTool()` produces a real
  `ToolDefinition`.
- **Planner (`@ryper/planner`, Phase 7)**: extended, not forked — see ADR 0006. `createPlannerCapabilitySource()` builds the injectable
  `PlatformSupportSource` the Planner's own `CapabilityResolver` now
  accepts.
- **Plugin SDK (`@ryper/plugin-sdk`, Phase 9)**: extended with an
  optional `PluginCapabilityAccess` interface on `PluginContext` (same
  host-injected-interface pattern as every other accessor —
  `core/plugin-platform`'s ADR 0002); `createPluginCapabilityContext()`
  implements it against a real `CapabilityManager`.

No file in any of those packages was modified beyond the two additive,
backward-compatible edits called out in ADR 0006 (`@ryper/planner`) and
the one additive interface field in `@ryper/plugin-sdk`.

## Permissions & fallback strategy

`CapabilityManager.invoke()` runs: permission check (via
`CapabilityPermissions`, which no-ops for domains with no
`requiredCapability`) → parameter validation against the descriptor's
`inputSchema` → adapter invocation → diagnostics/metrics recording, in
that order, every time — the same pipeline shape
`@ryper/tool-framework`'s `ToolExecutor` (Phase 8) and
`@ryper/plugin-platform`'s sandbox (Phase 9) use.

## Honest limitations — read before wiring a real platform adapter

- **No real platform adapter exists yet.** `createNullAdapter()` is the
  only implementation, and it honestly supports nothing — see ADR 0007.
  Every `CapabilityManager.resolve()` call returns `supported: false`
  until a real adapter is registered for that platform.
- **No real OS/hardware detection.** `defaultPlatformDetector` returns
  `"browser"` unconditionally (the one platform this repo's own Node test
  environment can honestly claim); a real host supplies its own
  `PlatformDetector`.
- **The `TaskType` → `CapabilityDomain` map (`TASK_TYPE_TO_DOMAIN`) is
  lossy** — 19 Planner task types onto a coarser subset of the 40
  domains. Good enough for "can the active adapter do this kind of
  thing," not a precise 1:1 mapping. See ADR 0006.
- **`createCapabilityTool()` is a pattern, not an enforced boundary.** A
  future tool author could still write a hand-rolled `execute` that calls
  an OS API directly — Tool Framework's `ToolDefinition.execute` is
  structurally an arbitrary function, always was. See ADR 0008.
- **`FALLBACK_HINTS` in `capability-resolver.ts` is a small, hand-picked
  table** (5 entries), not a general capability-similarity engine. It
  covers the domains where a reasonable degradation is obvious; anything
  else gets a reason with no suggested alternative rather than a guessed
  one.

## Performance

- `CapabilityRegistry`/`AdapterRegistry` are `Map`-backed — O(1) lookup,
  single synchronous read/write per operation (no `await` inside a
  mutating method, so there's no torn-read window under concurrent async
  callers).
- `CapabilityDiagnostics` is a bounded ring buffer (default 200 entries);
  `CapabilityMetrics` is O(1)-space running counters per domain — the
  same split used in every prior phase's diagnostics/metrics pair.
- `CapabilityDiscovery.discover()` is O(registered domains) per call — it
  re-resolves live rather than caching, so a report is never stale, at
  the cost of re-querying the adapter each time it's requested.

## Integration: registering a capability, an adapter, and invoking

```ts
import { CapabilityManager } from "@ryper/platform-capability";

const manager = new CapabilityManager({ broker, platformDetector: () => "windows" });

manager.registerCapability({
  domain: "notifications",
  name: "Notifications",
  description: "Send a system notification",
  version: "1.0.0",
  inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
});

// Future phase: manager.registerAdapter(createWindowsAdapter());
// Today: falls back to createNullAdapter("windows") automatically.

const support = manager.resolve("notifications"); // { domain, supported, reason?, suggestedAlternative? }
const report = manager.discover("user-1"); // full DiscoveryReport

await manager.invoke("notifications", "send", { title: "Hi" }, context); // permission -> validate -> adapter -> diagnostics
```

### Wiring into the Planner

```ts
import { CapabilityResolver, PlannerEngine } from "@ryper/planner";
import { createPlannerCapabilitySource } from "@ryper/platform-capability";

const capabilityResolver = new CapabilityResolver(createPlannerCapabilitySource(manager));
const engine = new PlannerEngine({ capabilityResolver });
```
