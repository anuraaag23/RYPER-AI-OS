# ADR 0024: Real Windows audio capabilities — native COM volume control, keybd_event media control, and CapabilityBroker activation

**Status:** Accepted (Phase 13.15)

## Context

With the notification capability confirmed real end-to-end on real
hardware (Phase 13.14), the user asked for a careful, investigated
expansion into further real Windows desktop capabilities — explicitly
requiring reuse of existing architecture, explicit identification of
capabilities that should be deferred as unreliable/unsafe rather than
guessed at, and real `CapabilityBroker` enforcement for every
state-modifying action.

## Investigation

Reading `core/windows-agent/src/windows-adapter.ts`'s full `invoke()`
dispatch table and `powershell-system-api.ts` end to end (rather than
assuming) found that most of the target capability list is **already
real**: `application_control` (launch/close/enumerate — genuine
`Start-Process`/`Stop-Process`/`Get-CimInstance` commands),
`filesystem` (all operations), `clipboard` (`Get-Clipboard`/
`Set-Clipboard` — genuinely built into PowerShell, no extra work
needed), `device_information`, `registry`, `background_services`,
`process_management`, and `display` (`listDisplays`, though its WMI
data source, `Win32_DesktopMonitor`, is a known-unreliable source for
detailed per-monitor metadata — a pre-existing limitation, not
something this phase changes). None of these needed new work to be
"real."

Two real gaps were found, matching the same "comment-placeholder"
pattern Phase 13.14 found and fixed for notifications:

1. **Audio**: `getVolume`, `setVolume`, `getMute`, `setMute`,
   `setDefaultAudioDevice`, and `mediaControl` were all literal
   PowerShell comments (e.g. `# set system volume to ${level}`) —
   never touching real Windows, always exiting 0 and doing nothing.
   Critically, the _already-shipped_ AI tools `volume_up`/
   `volume_down`/`set_volume`/`mute`/`unmute`
   (`desktop-actions.ts`/`desktop-tools.ts`) already call these exact
   stub methods — so this wasn't dead code nobody could reach; it was
   live, reachable functionality that silently did nothing.
2. **Window management**: `setWindowState` (minimize/maximize/
   restore), `moveWindow`, `resizeWindow`, `snapWindow`, and
   `centerWindow` are the same class of stub. Unlike audio, **no AI
   tool in this repository currently exposes any window-management
   action at all** — the stubs are unreachable dead code today, not
   live, silently-broken functionality.
3. **`audio`/most other domains have no `requiredCapability`.**
   Following Phase 13.12/13.14's precedent for `notifications`, this
   means `CapabilityBroker` was never actually reachable for any
   audio action, live and shipped or not.

## Decision: what this phase implements for real

**Audio — `getVolume`/`setVolume`/`getMute`/`setMute`**, implemented
via a real, native (no third-party module) `Add-Type` C# projection of
WASAPI's `IAudioEndpointVolume` COM interface — reflecting
`IMMDeviceEnumerator`, resolving the default render endpoint, and
activating its `IAudioEndpointVolume`. This is a long-established,
widely field-tested community technique (it predates, and is the
underlying reason several third-party "volume control" PowerShell
modules exist as thin wrappers around exactly this same COM path).
Chosen over the two alternatives: a third-party module (rejected per
explicit instruction — no module is installed or referenced anywhere)
and simulated volume-up/-down key presses (rejected because the
_already-shipped_ `set_volume`/`volume_up`/`volume_down`/`mute`/
`unmute` tools require exact-level get/set, which a relative key press
cannot honestly provide without first knowing the current level —
itself requiring the same COM path anyway).

**Audio — `mediaControl`** (play/pause/next/previous/stop),
implemented via a real, native `user32.dll` `keybd_event` virtual-key
press (`VK_MEDIA_PLAY_PAUSE`/`VK_MEDIA_NEXT_TRACK`/etc. — real, stable
`winuser.h` constants). Chosen deliberately as the _lower-risk_ half of
this phase's real work: `keybd_event` is a single, simple, extremely
well-documented Win32 call with no ABI-order sensitivity, unlike the
COM vtable interop above.

**`audio` domain now requires `automation.execute`** — the descriptor
in `capability-descriptors.ts` gained `requiredCapability:
"automation.execute"`, reusing the exact same `Capability` union entry
`process_management`/`background_services`/`registry` already use
(explicitly _not_ inventing a new capability type, per "reuse existing
architecture"). This activates real `CapabilityBroker` consent-gating
for every audio operation, live and shipped, for the first time.

## Decision: what this phase explicitly defers, and why

- **`setDefaultAudioDevice`**: no reliable native PowerShell technique
  exists for this specific operation. The only ways to change the
  default playback device are the undocumented, Windows-version-
  varying private `IPolicyConfig` COM interface (its vtable layout has
  changed across Windows releases and is not officially supported —
  genuinely unsafe to hand-implement blind) or a third-party module.
  Neither meets this repo's bar. `setDefaultAudioDevice()` now throws
  a clear `PowerShellExecutionError` explaining the deferral _without
  ever invoking PowerShell_ — an honest "not implemented," not a
  silent no-op or a fake success.
- **Window management** (minimize/maximize/restore/move/resize/snap/
  center): deferred **this phase** not because the underlying Win32
  APIs are unreliable (`ShowWindow`/`MoveWindow`/`FindWindow` are, if
  anything, simpler and more reliable than the audio COM interop this
  phase did implement) but because **no AI tool surface exists for
  window management at all** — implementing the PowerShell layer alone
  would add real code with zero reachable path from `AIOrchestrator`,
  violating this phase's own real-hardware-test requirement ("prove
  each newly implemented capability" — there would be nothing to
  prove it with). Building the tool surface, the `desktopActions`
  functions, and the capability wiring together is real, well-scoped
  future work — a strong candidate for the next phase.
- **Display brightness**: no method for this exists anywhere in the
  `WindowsSystemApi` interface today (confirmed by inspection, not
  assumed) — WMI brightness control
  (`WmiMonitorBrightnessMethods`) only works for laptop-panel displays
  with a supporting driver, not external/desktop monitors, and behaves
  inconsistently across hardware. Left out of scope entirely rather
  than added with a caveat that would be easy to overlook.
- **Clipboard, device information, diagnostics**: already real
  (confirmed by inspection), but have no AI tool surface yet either —
  same reasoning as window management. Not touched this phase.

## Testing

- 10 new, always-run `powershell-system-api.test.ts` tests proving the
  real command construction for volume/mute get/set (including
  percent-to-scalar conversion and clamping), that `setDefaultAudioDevice`
  is an honest deferral that never invokes PowerShell, that
  `mediaControl` sends the real, correct virtual-key code for every
  action via native `user32.dll`, and that none of this ever
  references a third-party module or an undocumented interface.
- 2 new, always-run `desktop-tools-capability-broker.test.ts` tests
  proving `volume_up` is genuinely denied when consent is denied (the
  real production default — see `main.ts`) and genuinely succeeds,
  with a real broker audit trail, when consent is approved.
- 1 new opt-in real-hardware test,
  `platform/desktop-app/test/audio-capability.real.test.ts` — the
  second real-hardware capability test in this repository. Drives a
  real Qwen3 `volume_up` tool call through the entire real path and,
  distinctively, reads the real system volume via the same new COM
  interop both before and after the tool call, asserting the value
  actually changed — physical evidence the COM path genuinely works,
  not just that PowerShell exited 0.

## Honest risk note

The `IAudioEndpointVolume` COM vtable ordering cannot be proven
correct by a unit test with a fake `ShellExec` — only real Windows
hardware can confirm it. This is a real, acknowledged risk this ADR
accepts rather than hides: a wrong method order in COM interop
silently calls the wrong function rather than failing loudly. The new
real-hardware test above is designed specifically to catch this (by
reading real volume state, not just checking exit codes), and should
be the first thing run on real hardware for this phase.

## Consequences

- `automation.execute`-gated actions across `audio`,
  `process_management`, `background_services`, and `registry` are now
  consistently denied by default on real Windows until a real consent
  UI exists (matching the precedent Phase 13.12's ADR 0021 already
  established for `notifications`) — correct, fail-closed, by-design
  behavior, not a regression, but a real, user-visible behavior change
  for `volume_up`/`set_volume`/`mute`/`unmute`/media controls that
  previously worked ungated.
- Real re-verification (does the COM interop genuinely change real
  system volume, does `keybd_event` genuinely control real media
  playback) is the explicit next step — not yet performed as of this
  document.
