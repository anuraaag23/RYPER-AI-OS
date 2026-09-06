# ADR 0025: Media control verification strategy — a read-only WinRT "now playing" signal, and honest conditional physical verification

**Status:** Accepted (Phase 13.15, media control sub-phase)

## Context

With `volume_up` confirmed REAL HARDWARE VERIFIED (a real, measured
system volume change, independently read before and after), the user
asked for the same rigor applied to `media_play`/`media_pause`/
`media_next`/`media_previous` — explicitly warning not to assume media
control works just because volume does, and explicitly forbidding
claiming physical success without an objective success criterion.

`mediaControl()` itself was already real (native `keybd_event`, fixed
earlier in Phase 13.15 — see `docs/adr/0024`) — this ADR is about how
to **verify** it, not about re-implementing it.

## The core problem: volume's verification strategy doesn't transfer

`audio-capability.real.test.ts` proves `volume_up` by reading an
always-populated, universal, exact numeric value (WASAPI's master
volume) before and after the action. Media playback has no equivalent:
Windows only exposes "now playing" state for an application that
currently has an _active_ System Media Transport Controls (SMTC)
session — which requires something to actually be playing or paused
on the test machine at the moment the test runs. Unlike volume (which
always has _some_ value, even if nothing is making sound), a machine
with no media application open has **no session to read state from at
all** — not an error, a genuinely empty, valid state.

This repo cannot manufacture that precondition from Node/PowerShell
without launching and controlling a real media application — a much
larger, separate piece of work not attempted here. So the verification
strategy has to be designed around this real environmental constraint,
not assume it away.

## Decision: `getNowPlayingState()`, a real, read-only WinRT signal

Added `getNowPlayingState(): Promise<MediaSessionState>` to
`WindowsSystemApi`, implemented for real via
`Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager`
(WinRT, Windows 10 1809+) — the same real, OS-level session registry
every app's media transport controls (lock screen, volume flyout "now
playing" widget) already read from, not a per-app integration. Reads
the current session's `PlaybackStatus` (mapped to a real
`MediaPlaybackStatus` union: `none`/`closed`/`opened`/`changing`/
`stopped`/`playing`/`paused`) and, when available, the current track's
title/artist via `TryGetMediaPropertiesAsync()`.

Not exposed as an AI tool — there is nothing for a user to ask for
here beyond what `media_play`/etc. already provide; it exists purely
to give a real-hardware test an objective, independently-readable
signal.

WinRT's async methods (`RequestAsync()`, `TryGetMediaPropertiesAsync()`)
have no native PowerShell `await`. The `Await` helper this
implementation uses — reflecting `[System.WindowsRuntimeSystemExtensions]`'s
generic `AsTask<T>` extension method and blocking on the resulting
.NET `Task` — is the standard, widely-documented community technique
for this (the same category of technique as ADR 0024's
`IAudioEndpointVolume`/toast-notification WinRT reflection elsewhere
in this file), not invented for this ADR.

**Honest risk note, matching ADR 0024's precedent:** like the volume
COM interop, this specific WinRT reflection/async-await plumbing
cannot be proven correct by a unit test with a fake `ShellExec` — only
real Windows hardware can confirm it works. Stated plainly here, not
hidden.

`status: "none"` (no active session) is a real, valid, common outcome
— the command still exits 0 in that case, not an error.

## Decision: the real-hardware test's honest, two-tier verification

`media-control-capability.real.test.ts` makes an explicit distinction
between what is always provable and what is only conditionally
provable, rather than either (a) weakening assertions to always pass
regardless of physical reality, or (b) failing the test entirely on
environments where physical verification isn't possible:

1. **Always asserted, regardless of environment** — the same rigor
   every other real test in this repo already holds itself to: a real,
   structurally valid tool call was produced by Qwen3; the real broker
   genuinely granted `automation.execute`; the real tool executed with
   `tool_result.ok === true` and no orchestrator error event; and real
   Qwen3 produced a real final reply. This is genuine, physical proof
   the _mechanical path_ — including a real `keybd_event` call
   actually running on real Windows — works, exactly the same class of
   evidence `tool_result.ok` already represents in every other real
   test in this repo (`tool-calling.real.test.ts`,
   `audio-capability.real.test.ts`).
2. **Conditionally asserted, only when a real, active media session
   exists** on the test machine at run time (checked via a real
   `getNowPlayingState()` read before anything else happens): that the
   real, observable session state actually changed the way the action
   implies — `play`/`pause` toggling `status` to `"playing"`/`"paused"`,
   `next`/`previous` changing the current track's `title`. This is the
   stronger, physical, environment-dependent claim, and is a hard
   assertion (the test fails if it doesn't hold) whenever the
   precondition for checking it is met.
3. **When no active session exists** (or, for track changes, when a
   session exists but no track title is readable, or the title happens
   not to change — e.g. a single-track source), the test does **not**
   silently pass item 2 or weaken the assertion to tolerate an
   unchanged value. It explicitly logs
   `"NOT VERIFIED (<specific reason>)"` for that action and makes no
   physical-verification claim for it — per the user's explicit
   instruction to report this honestly rather than weaken the test.

This means the test's pass/fail status is never contingent on the test
machine's media state at run time (so it isn't flaky), while the
_evidence log it produces_ honestly reflects whatever additional
physical proof the real environment did or didn't allow — the user (or
anyone reading the run's output) can tell, for each action, whether it
was mechanically proven only or physically confirmed.

## Consequences

- `media_play`/`media_pause`/`media_next`/`media_previous` can now be
  run for real on real hardware with an honest verification outcome
  either way — never a false "physically verified" claim, and never a
  spurious failure purely because nothing happened to be playing on
  the test machine.
- New always-run, no-hardware-required test coverage:
  `powershell-system-api.test.ts` (3 new tests: real WinRT/`AsTask`
  command construction, no third-party module, honest `"none"`
  reporting, correct enum-name lowercasing) and
  `reference-system-api.test.ts` (4 new tests, using a real, minimal,
  deterministic in-memory simulated playlist: play/pause/stop set
  real, readable status; next/previous genuinely change the current
  track and wrap correctly at both ends).
- Real re-verification (does the WinRT reflection genuinely work,
  does a real machine with real media playing show the expected
  physical state transitions) is the explicit next step — not yet
  performed as of this document. Depending on what's playing (or not)
  on the user's real test machine, the physical claims in items 2/3
  above may be VERIFIED, NOT VERIFIED, or a mix — that outcome is
  expected to be reported honestly, not assumed.
