# @ryper/plugin-platform — Plugin SDK & Extension Platform

Phase 9 of RYPER AI OS. The official extension system: every future
integration should be installable as a plugin instead of requiring core
platform changes. See `docs/adr/0001-two-package-split.md` through
`0005-lifecycle-transitions-not-states.md` for the significant design
decisions this phase introduced.

## Two packages, two audiences

- **`@ryper/plugin-sdk`** (`plugins/sdk`, extended this phase) — what a
  plugin _author_ imports. `definePlugin()` is unchanged from before this
  phase; new, optional `extended` metadata and `lifecycle` hooks, plus the
  `PluginContext` interface family, are additive.
- **`@ryper/plugin-platform`** (this package) — what the _host_ imports to
  install, run, and manage plugins. A plugin author never imports this
  package directly.

## SDK overview

```ts
import { definePlugin } from "@ryper/plugin-sdk";

export default definePlugin({
  id: "weather-plugin",
  name: "Weather",
  version: "1.0.0",
  actions: [{ name: "get_forecast", handler: (input) => ({ sunny: true }) }],
  extended: {
    author: "Jane Doe",
    description: "Gets a weather forecast",
    minSdkVersion: "1.0.0",
    maxSdkVersion: "9.0.0",
    pluginType: "automation",
    toolRegistrations: [{ actionName: "get_forecast", spec: /* ToolSpec */ {} }],
    plannerTaskSchemas: [
      { operation: "weather.get_forecast", description: "...", parameterNames: ["city"] },
    ],
    settingsSchema: { type: "object", properties: { units: { type: "string", enum: ["c", "f"] } } },
  },
  lifecycle: {
    initialize: async (context) => {
      await context.memory.remember("plugin started");
      context.events.on("system", "system.startup", () => context.logging.info("system started"));
    },
    onEnable: (context) => context.notifications.notify("Weather", "Ready to go"),
  },
});
```

Every `PluginContext` accessor (`tools`, `memory`, `plannerIntegration`,
`voice`, `settings`, `events`, `logging`, `diagnostics`, `notifications`)
is a plain interface in the SDK — see ADR 0002 for why the SDK never
implements any of them itself.

## Core modules → files

| Module (from the brief)                       | File                        |
| --------------------------------------------- | --------------------------- |
| Plugin Manifest (versioned)                   | `manifest.ts`, `types.ts`   |
| Plugin Validator                              | `manifest-validator.ts`     |
| Plugin Dependency Resolver                    | `dependency-resolver.ts`    |
| Plugin Sandbox                                | `sandbox.ts`                |
| Plugin Permission Manager                     | `permission-manager.ts`     |
| Plugin Configuration Manager                  | `plugin-configuration.ts`   |
| Plugin Diagnostics, Plugin Metrics            | `plugin-diagnostics.ts`     |
| Plugin Logger                                 | `plugin-logger.ts`          |
| Event System (8 categories)                   | `event-bridge.ts`           |
| Plugin Registry                               | `plugin-registry.ts`        |
| Plugin Lifecycle Manager                      | `lifecycle.ts`              |
| Store support (format/signing/compat/updates) | `store-format.ts`           |
| Plugin Loader                                 | `plugin-loader.ts`          |
| Plugin Installer/Updater/Uninstaller          | `plugin-installer.ts`       |
| Plugin Configuration                          | `plugin-platform-config.ts` |
| Plugin Manager (facade)                       | `plugin-manager.ts`         |

## Plugin lifecycle

See ADR 0005. `PluginLifecycleManager` validates every transition against
a fixed table before running it, and calls whichever of a plugin's
optional `PluginLifecycleHooks` applies:

```
registered → installed → loaded → initialized → enabled ⇄ disabled
                                              enabled ⇄ suspended
                            enabled/disabled/suspended → uninstalled
                                          (any) → failed → installed (retry)
```

`resume` and `reload` are transitions through this same table (see ADR
0005), not separate states.

## Sandbox

See ADR 0003. `PluginSandbox` enforces per-plugin concurrent-call limits,
a wall-clock timeout, and a payload-size ceiling around every
`PluginRuntime.invoke()` call — real, tested limits, not a placeholder.
Permission/filesystem/network isolation is already real underneath, via
`@ryper/security`'s `CapabilityBroker`, which `PluginRuntime` (and
therefore the sandbox) already calls.

## Store architecture (no online store)

See ADR 0004. `store-format.ts` defines the package envelope
(`PluginPackageManifestEnvelope`), a real HMAC-SHA256 signing/verification
pair, `checkVersionCompatibility()`, and `isValidUpdate()`. No network
client, registry, or publish flow exists — that's explicitly out of scope
for this phase.

## Reuse — nothing here was reimplemented that already existed

- **Plugin Runtime (`@ryper/plugin-runtime`)**: `PluginManager` owns one
  `PluginRuntime` and never reimplements capability-checked invocation —
  `PluginSandbox` and `ToolPluginBridge` both call `PluginRuntime.invoke()`
  directly.
- **Security (`@ryper/security`)**: `PluginPermissionManager` calls
  `CapabilityBroker.requestCapability()`/`hasGrant()`/`revoke()` directly.
- **Memory System (`@ryper/memory-system`)**: `PluginConfigurationManager`
  and a plugin's scoped `memory` context accessor are both thin callers of
  `MemoryManager`'s public API.
- **Tool Framework (`@ryper/tool-framework`, Phase 8)**: `PluginLoader`
  cross-registers `toolRegistrations` with a supplied `ToolPluginBridge`;
  `PluginConfigurationManager` reuses `ToolValidator`/`JsonSchema` for
  settings-schema validation instead of a third schema validator.
- **Planner (`@ryper/planner`, Phase 7)**: `PluginLoader` cross-registers
  `plannerTaskSchemas` with a supplied `PlannerPluginRegistry`.
- **Voice Engine (`@ryper/voice-engine`)**: a plugin's `voice` context
  accessor calls a supplied `VoiceCommandRouter.register()` directly.
- **Event Bus (`@ryper/event-bus`)**: `PluginEventBridge` is the only
  route from plugin code to the shared bus, filtered to 8 categories.

No file in any of those packages was modified.

## Honest limitations — read before shipping a real plugin

- **No real OS-level sandbox** (see ADR 0003) — resource limits, not
  process isolation.
- **Signing is HMAC, not PKI** (see ADR 0004) — fine for first-party
  plugins, not yet suitable for an open multi-publisher store.
- **`toPluginManifest()` is a one-way projection.** `ExtensionManifest`
  carries richer metadata than `@ryper/plugin-runtime`'s `PluginManifest`
  needs; round-tripping isn't supported (nor needed — the platform is
  always the one holding the full `ExtensionManifest`).
- **Dependency resolution requires an exact version match**, not a
  semver range — `PluginDependencyResolver` checks
  `dependency.version === installed.version` exactly. Range grammar
  (`^1.2.0`, `>=1.0.0 <2.0.0`) is a deliberate non-goal for this phase;
  `semver.ts` only implements comparison and inclusive-range checks.
- **`PluginInstaller.update()` only supports updating a plugin that is
  currently `"enabled"` or `"disabled"`** — updating from any other state
  requires disabling/enabling it first. This is a real constraint of the
  lifecycle transition table (ADR 0005), not an oversight.
- **No plugin currently registers real tools/planner schemas/voice
  commands in this repo** — `plugins/examples/example-plugin` still only
  uses the original, simpler `definePlugin` shape. Wiring a real example
  plugin through `toolRegistrations`/`plannerTaskSchemas` end-to-end is
  natural follow-up work, demonstrated only in this package's own tests.

## Performance

- `PluginPlatformRegistry`/`PluginDependencyResolver` are `Map`-backed —
  O(1) lookup, O(plugins + edges) resolution with memoized DFS.
- `PluginDiagnostics` is a bounded ring buffer (default 200 entries);
  `PluginMetrics` is O(1)-space running counters per plugin — the same
  split used in `@ryper/planner` and `@ryper/tool-framework`.
- `PluginSandbox`'s concurrency tracking is a single `Map<pluginId, count>`
  update per call, no scanning.
- `PluginEventBridge` subscription cleanup (`unsubscribeAll`) is O(k) in
  the number of that plugin's own subscriptions, never a bus-wide scan.

## Integration: installing and running a plugin

```ts
import { PluginManager } from "@ryper/plugin-platform";
import { definePlugin } from "@ryper/plugin-sdk";

const manager = new PluginManager({
  broker, // @ryper/security, Phase 1
  eventBus, // @ryper/event-bus
  memory: memoryManager, // @ryper/memory-system, Phase 5
  toolBridge, // @ryper/tool-framework's ToolPluginBridge, Phase 8
  plannerRegistry, // @ryper/planner's PlannerPluginRegistry, Phase 7
  voiceRouter, // @ryper/voice-engine's VoiceCommandRouter, Phase 6
});

const plugin = definePlugin({/* ... */});
const context = await manager.install(plugin);

const result = await manager.invokeAction("weather-plugin", "get_forecast", { city: "Varanasi" });

await manager.disable("weather-plugin", plugin.lifecycle);
await manager.uninstall("weather-plugin", plugin.lifecycle);
```
