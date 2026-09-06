# ADR 0005: Lifecycle transitions, not a state per verb

**Status:** Accepted (Phase 9)

## Context

The brief lists ten lifecycle actions: install, load, initialize, enable,
disable, suspend, resume, reload, update, uninstall. Modeling each action
as its own persistent state would produce states like `"resumed"` that are
indistinguishable from `"enabled"` once the action completes, and a
`"reloaded"` state with no independent meaning either.

## Decision

`PluginLifecycleState` has nine members
(`registered/installed/loaded/initialized/enabled/disabled/suspended/
uninstalled/failed`) plus a fixed transition table
(`ALLOWED_TRANSITIONS` in `lifecycle.ts`). "Resume" and "reload" are
**transitions**, not states:

- `resume(pluginId, ...)` performs the `suspended -> enabled` transition
  and calls `hooks.onResume`.
- `reload(pluginId, ...)` performs `disable` immediately followed by
  `enable` (calling both `onDisable` and `onEnable` in order), landing
  back in `"enabled"`.
- `update` is handled by `PluginInstaller.update()`, which suspends (if
  currently enabled), unregisters and reloads the plugin's registration,
  then enables — again landing in `"enabled"`, never a distinct
  `"updated"` state.

Every transition is validated against the table before it runs;
`PluginLifecycleManager` throws `LifecycleTransitionError` rather than
silently allowing an invalid jump (e.g. enabling a plugin that was never
initialized).

## Consequences

- `PluginPlatformRegistry.get(pluginId).state` always answers "what is
  this plugin doing right now," never "what was the last verb called on
  it" — a strictly more useful signal for anything (diagnostics, a future
  UI) that displays plugin status.
- Callers get a hard guarantee: a hook only ever fires when its
  precondition state is real, because the guard runs before the hook.
- The cost is a slightly less literal mapping from the brief's ten verbs
  to code — two of them (`resume`, `reload`) are methods that don't
  introduce new states, which is called out here explicitly rather than
  left for a reader to infer from the state list alone.
