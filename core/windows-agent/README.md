# @ryper/windows-agent — Windows Platform Agent

Phase 11 of RYPER AI OS. The first production implementation of Phase
10's Platform Capability Layer (`@ryper/platform-capability`)
`PlatformAdapter` contract:

```
User → Voice Engine → AI Engine → Planner → Tool Framework
  → Platform Capability Layer (CapabilityManager)
  → WindowsAdapter  (this package)
  → WindowsSystemApi (injected)
```

No component outside this package calls a Windows API directly. No
component outside the Platform Capability Layer calls this package's
`WindowsAdapter.invoke()` directly either — everything goes through
`CapabilityManager.invoke()`, which runs permission checks and parameter
validation first (see `core/platform-capability/README.md`).

See `docs/adr/0009`–`0010` for this phase's significant design
decisions.

## Architecture

```
                          WindowsAdapter
                    (implements PlatformAdapter)
                               |
        ┌─────────┬─────────┬─┴───────┬──────────┬───────────┐
   ProcessManager  WindowManager  ApplicationManager  FileManager  ...
        |               |               |                |
        └───────────────┴───────┬───────┴────────────────┘
                                 |
                         WindowsSystemApi (injected)
                        /                        \
     InMemoryWindowsSystemApi              PowerShellWindowsSystemApi
     (default; real; in-memory)            (production; real PowerShell/
                                             WMI commands; needs a real
                                             ShellExec to actually run)
```

Sixteen manager classes, each named for one of the brief's core modules,
sit between `WindowsAdapter` and `WindowsSystemApi`:

| Manager                  | File                      | Brief section                           |
| ------------------------ | ------------------------- | --------------------------------------- |
| `ProcessManager`         | `process-manager.ts`      | Application Control (process lifecycle) |
| `WindowManager`          | `window-manager.ts`       | Window Management                       |
| `ApplicationManager`     | `application-manager.ts`  | Application Control                     |
| `FileManager`            | `file-manager.ts`         | Filesystem                              |
| `ClipboardManager`       | `clipboard-manager.ts`    | Clipboard                               |
| `NotificationManager`    | `notification-manager.ts` | Notifications                           |
| `AudioManager`           | `audio-manager.ts`        | Audio                                   |
| `DisplayManager`         | `display-manager.ts`      | System Information (display)            |
| `DeviceManager`          | `device-manager.ts`       | System Information                      |
| `PermissionManager`      | `permission-manager.ts`   | Security (UAC/elevation)                |
| `RegistryInterface`      | `registry-interface.ts`   | Registry Interface                      |
| `ServiceManager`         | `service-manager.ts`      | Windows Service Manager                 |
| `EventMonitor`           | `event-monitor.ts`        | Event Monitor                           |
| `PerformanceMonitor`     | `performance-monitor.ts`  | Performance Monitor                     |
| `DiagnosticsManager`     | `diagnostics-manager.ts`  | Diagnostics                             |
| `WindowsVersionDetector` | `version-detector.ts`     | Supported Windows Versions              |

Every manager takes a `WindowsSystemApi` (and, where the brief requires
confirmation before a destructive action, a `DestructiveActionGate`) in
its constructor and touches nothing else — no manager imports
`child_process`, `node:fs`, or a Win32 binding.

## The `WindowsSystemApi` seam

The one interface (`windows-system-api.ts`) every manager and
`WindowsAdapter` goes through. Two implementations ship:

- **`InMemoryWindowsSystemApi`** (`reference-system-api.ts`) — the
  default. A real, fully functional, stateful implementation: an actual
  process table, window list, virtual filesystem, registry map, service
  list, and event log. Every operation is observable — killing a process
  really removes it from the next `listProcesses()` call. This is what
  every test in this package runs against.
- **`PowerShellWindowsSystemApi`** (`powershell-system-api.ts`) — the
  production shape. Every method builds a real PowerShell/CIM/WMI
  command string and parses its `ConvertTo-Json` output. It depends on
  one injected function, `ShellExec`, to actually run a command.

See "Honest Limitations" below for why the second one doesn't work in
this build environment, and `docs/adr/0009` for the full reasoning.

## Windows version support

`WindowsVersionDetector` calls `WindowsSystemApi.detectWindowsVersion()`
once, during `WindowsAdapter.create()` (see `docs/adr/0010` for why
creation is async), and caches the result. `WindowsAdapter.supports()`,
`getDeviceInfo()`, and `getRuntimeLimitations()` all read that cache
synchronously afterward, per the `PlatformAdapter` contract.

Windows 10 and Windows 11 are supported; anything else (`release:
"unsupported"`) doesn't throw during creation — it's surfaced as a
runtime limitation and every `invoke()` call fails with a clear
`UnsupportedCapabilityError`, matching the brief's "gracefully disable
unsupported features" rather than crashing. A small table in
`version-detector.ts` (`WINDOWS_10_UNSUPPORTED_OPERATIONS`) lists the
individual operations this adapter treats as Windows 11-only (currently:
clipboard history, and the Windows 11 snap-layout flyout — basic window
snapping still works on Windows 10).

## Security

- **Destructive actions never run silently.** `confirmation.ts`'s
  `DestructiveActionGate` sits in front of killing a critical process
  (`ProcessManager`), deleting a file (`FileManager`), stopping a
  critical service (`ServiceManager`), and writing a registry value
  (`RegistryInterface`). Its default confirmer (`denyAllConfirmer`)
  refuses everything — a platform shell must inject a real UI-backed
  confirmer to allow any of these at all.
- **Registry writes are off by default.** `RegistryInterface` refuses
  every `writeValue()` call unless constructed with `{ allowWrites: true
}` _and_ the destructive-action gate confirms the specific write.
- **Never auto-elevates.** `PermissionManager.requestElevation()` always
  round-trips through an injected `ElevationPrompt`; the default
  (`denyElevation`) always says no. Nothing else in this package raises
  a process's privilege level.
- **No component bypasses these checks.** `WindowsAdapter.invoke()` is
  the only entry point into any manager, and it never skips a manager's
  own confirmation/authorization logic.

## Plugin extensibility

`plugin-extensions.ts`'s `WindowsPluginCapabilityRegistry` lets a plugin
contribute a Windows-specific `(domain, operation)` handler without
editing `windows-adapter.ts`. `WindowsAdapter.invoke()` checks its
built-in dispatch table first, then falls back to this registry. See
`docs/adr/0010` and `test/integration.test.ts`'s
`"a plugin-contributed Windows capability handler is reachable
end-to-end..."` test for a worked example (a fictional `tray_icons`
domain).

## Wiring into the rest of RYPER AI OS

`bootstrap.ts` is the one-call path:

```ts
import { CapabilityBroker } from "@ryper/security";
import { bootstrapWindowsPlatformAgent, createLaunchApplicationTool } from "@ryper/windows-agent";

const broker = new CapabilityBroker(async (request) => true /* real UI prompt goes here */);
const { adapter, capabilityManager } = await bootstrapWindowsPlatformAgent({ broker });

// Tool Calling Framework (Phase 8): wrap one capability as a real ToolDefinition.
const launchTool = createLaunchApplicationTool(capabilityManager);
toolManager.registerTool(launchTool);

// Agent Planner (Phase 7): let the Planner ask what the active adapter supports.
import { createCapabilityResolver, PlannerEngine } from "@ryper/planner";
import { createPlannerCapabilitySource } from "@ryper/platform-capability";
const planner = new PlannerEngine({
  capabilityResolver: createCapabilityResolver(createPlannerCapabilitySource(capabilityManager)),
});
```

`test/integration.test.ts` exercises this full stack — `CapabilityManager`
permission checks, a real `PlannerEngine` resolving task-type support
through the Windows adapter, and a real `ToolManager` invoking a
`createCapabilityTool`-wrapped capability — end to end.

## Capability domains implemented

`application_control`, `window_management`, `clipboard`, `notifications`,
`audio`, `display`, `filesystem`, `device_information`,
`process_management`, `background_services`, `registry`, `security`,
`diagnostics`, `performance_monitoring`, `power_management`. See
`capability-descriptors.ts` for the full `CapabilityDescriptor` list, and
`windows-adapter.ts`'s `buildDispatchTable()` for every `(domain,
operation)` pair each one implements.

`requiredCapability` is only set where `@ryper/security`'s `Capability`
union has a matching entry (`notifications`, `filesystem.write`,
`automation.execute`, `system.power`); most domains are left ungated at
the `CapabilityBroker` level and rely on this package's own
`DestructiveActionGate`/`PermissionManager` instead — the same "partial
by design" tradeoff `docs/adr/0006` documents for the Planner's
`TASK_TYPE_TO_DOMAIN`. `power_management` (shutdown/restart/sleep) is
gated by **both**: a `system.power` capability grant _and_, independently,
`DestructiveActionGate`'s own per-call confirmation via `PowerManager` —
see `docs/adr/0030`.

### Universal open capability (`application_control`, see `docs/adr/0030`)

- `open_url` (optionally with `browserId`), `open_file`, `open_folder`,
  `smart_open` (deterministic URL/file/folder classification — verified
  against the real filesystem via `listDirectory`, never guessed),
  `list_browsers`, `launch_browser`.
- `BrowserResolver` (`browser-resolver.ts`) does real, multi-tier browser
  discovery (installed-apps list → Windows "App Paths" registry → known
  install-location probing) for Edge/Chrome/Firefox/Brave. Explicitly
  requested browsers that aren't installed report
  `BrowserNotInstalledError` — never silently substituted for a
  different browser.
- `PathResolver` (`path-resolver.ts`) handles quoted paths and a narrow,
  honestly-scoped set of environment-variable expansion (see its own
  "Honest limitation" doc comment: only `%USERPROFILE%` is resolved,
  derived from the real `getWellKnownFolderPath("desktop")` result,
  since this package's `WindowsSystemApi` abstraction has no
  general-purpose `process.env` access by design).

### OS power management (`power_management`, see `docs/adr/0030`)

- `shutdown`, `restart`, `sleep` — every operation routes through
  `PowerManager`, which reuses the existing `DestructiveActionGate`
  (the same one `FileManager.delete()` already relies on) rather than a
  second confirmation mechanism, and explicitly re-checks any
  `AbortSignal` both before and after that gate's (potentially
  real-time) confirmation wait, closing a real cancellation race a
  slower confirmer could otherwise create.
- `PowerShellWindowsSystemApi`'s implementations use fixed, zero-
  interpolation command strings (`Stop-Computer -Force`,
  `Restart-Computer -Force`, and the standard WinForms
  `SetSuspendState` technique for sleep) — no user input of any kind
  ever reaches them.
- The in-memory reference implementation cannot actually power off the
  process it's running in without breaking the reference environment
  itself, so it honestly records the request (`lastPowerAction`) for a
  test to observe rather than fabricating a stronger claim.

## Honest Limitations

- **`PowerShellWindowsSystemApi` cannot run in this build environment.**
  There is no native Windows toolchain in this Linux sandbox — no
  `powershell.exe`, no WMI, no Windows. Its default `ShellExec`
  (`unavailableShellExec`) always rejects, explaining this plainly rather
  than pretending to succeed. It is exercised in tests via an injected
  fake `ShellExec` that verifies command construction and JSON-output
  parsing, never real Windows behavior. A real deployment must inject a
  real `ShellExec` (e.g. wrapping `child_process.execFile("powershell.exe",
...)`) and should validate the generated commands against a real
  Windows host before first production use.
- **Real-time event subscription is not implemented in the production
  API.** `PowerShellWindowsSystemApi.subscribeToEvents()` is an honest
  no-op that logs why (`Register-CimIndicationEvent`-based event
  watching is real Windows work this phase doesn't implement) — the
  in-memory reference implementation's event emission is fully
  functional and is what `EventMonitor` is tested against.
- **Clipboard history and media session control are best-effort in the
  production API.** `Get-Clipboard`/`Set-Clipboard` don't expose the
  Windows Clipboard History (Win+V) API, and there's no standard
  PowerShell cmdlet for media-session transport controls — both are
  marked with `log.warn(...)` in `powershell-system-api.ts` rather than
  silently faked.
- **`requiredCapability` coverage is partial**, as noted above — most
  domains rely on this package's own confirmation/elevation gates rather
  than a `@ryper/security` `Capability` grant, because the current
  `Capability` union doesn't have an entry for most of them (e.g. there
  is no `"audio"` or `"window_management"` capability — `system.power`
  was added specifically because power actions are irreversible enough
  to warrant both gates simultaneously; see `docs/adr/0030`).
- **`BrowserResolver`'s registry and candidate-path discovery tiers are
  real but untested against a real Windows machine**, same honest
  caveat as `PowerShellWindowsSystemApi` generally — its "App Paths"
  registry key and install-path assumptions are standard, well-known
  Windows conventions, not this-machine-specific guesses, but nothing
  in this sandbox can verify them against real hardware. The reference
  (`InMemoryWindowsSystemApi`) implementation only exercises the
  first discovery tier (`listInstalledApplications()`), since it has no
  registry/filesystem-probing browser data seeded by default.
- **The in-memory reference filesystem is not a real filesystem** — no
  actual disk I/O happens, paths are just map keys using Windows-style
  backslash separators. This is intentional (see `docs/adr/0009`) but
  means, for example, permission errors a real NTFS ACL would produce
  are not modeled.

## Performance Considerations

- `WindowsAdapter.create()` against the default
  `InMemoryWindowsSystemApi` completes in low single-digit milliseconds
  (see `test/performance-benchmarks.test.ts`); against
  `PowerShellWindowsSystemApi`, it costs one PowerShell process
  round-trip (`Get-CimInstance Win32_OperatingSystem`), typically
  100–300ms on real Windows hardware.
- Every manager method is `async` and awaits exactly one
  `WindowsSystemApi` call per operation (aside from composite operations
  like `restart`, which is `kill` + `start`) — no manager does its own
  polling or blocking I/O.
- `DiagnosticsManager` and `PerformanceMonitor` both cap their retained
  history (`diagnosticsHistorySize`/`performanceHistorySize`, default
  500), so long-running processes stay bounded in memory regardless of
  invocation volume — verified in
  `test/performance-benchmarks.test.ts`'s
  `"diagnostics invocation history stays bounded regardless of load"`.
- `EventMonitor` is a single subscription re-emitting onto
  `@ryper/event-bus`; it does not poll.

## Remaining Integration Gaps

- No real Windows-hosted `ShellExec` implementation ships in this
  repository (by design — see "Honest Limitations"); a platform shell
  target must provide one.
- `PowerShellWindowsSystemApi`'s generated commands are not validated
  against a real Windows/PowerShell installation anywhere in this
  repository's CI.
- Toast notification action-button click handling (the brief's "Action
  notifications") is modeled in the type system
  (`NotificationSpec.actions`) and the in-memory reference implementation
  accepts it, but there is no wired-up callback path from a real Windows
  toast click back into this package — that requires a
  `Windows.UI.Notifications`-level integration a future phase should add.
- `CapabilityManager`'s built-in `Capability` union
  (`@ryper/security`) doesn't yet have entries for most Windows domains
  this adapter implements (audio, window management, display, ...); a
  future phase to `@ryper/security` could close this gap so more domains
  can be gated at the broker level instead of relying solely on this
  package's own confirmation gates.

## Testing

`npm test` (from the repo root, or `cd core/windows-agent && npm test`)
runs:

- **Unit tests** for `InMemoryWindowsSystemApi` and every manager,
  including destructive-action confirmation paths (allow/deny).
- **Mock capability tests** for `PowerShellWindowsSystemApi` against a
  fake `ShellExec`.
- **Windows Adapter tests**: dispatch coverage, version-based
  degradation, plugin-handler fallback, and error/diagnostics recording.
- **Integration tests** wiring a real `CapabilityManager`, a real
  `PlannerEngine` (via `createPlannerCapabilitySource`), and a real
  `ToolManager` (via `createCapabilityTool`) together end to end.
- **Performance benchmarks**: bounded-time sanity checks, not a load
  test.

No test in this package touches a network or a real Windows API.
