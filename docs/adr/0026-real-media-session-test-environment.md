# ADR 0026: A real, deterministic media-session test environment via a real Edge window and the Web MediaSession API

**Status:** Accepted (Phase 13.15, media control physical verification)

## Context

`media-control-capability.real.test.ts` (docs/adr/0025) was designed
to honestly report `"NOT VERIFIED (no active media session)"` when the
real test machine has nothing playing at run time, rather than
weakening its assertions or faking a physical result. The user's first
real-hardware run did exactly that: all mechanical assertions passed
(real Qwen3 tool calls, real `CapabilityBroker` grants,
`tool_result.ok === true` for all four actions), but Windows reported
no active System Media Transport Controls (SMTC) session at all, so
physical playback verification could not run. The user confirmed this
was the correct, honest outcome — not a bug — and asked for a real,
deterministic media-session test environment to be investigated, with
hard constraints: no mocking of any Windows media API, no simulated/
reference media session for the real-hardware certification, no
weakened assertions, and an honest "NOT VERIFIED" outcome preserved if
a real session still can't be reliably established.

## Options considered

1. **Legacy Windows Media Player (`wmplayer.exe`) with a real audio
   file.** Rejected as unreliable across real machines: Microsoft has
   been removing this executable from some Windows 11 editions/OEM
   images since 22H2, so its presence isn't guaranteed.
2. **The modern "Media Player" UWP app.** Rejected as primary:
   launching a specific UWP app with a specific file deterministically
   (via `shell:AppsFolder\...` or similar) is real but has historically
   been fragile to script reliably, and the exact package identity
   varies across Windows 11 SKUs/update channels.
3. **A real, visible Microsoft Edge window playing a local HTML page
   that uses the standard, first-party Web `MediaSession` API.**
   Chosen. Edge ships built into every real Windows 11 install, making
   it the most portable option. Critically, registering
   `navigator.mediaSession.metadata` and action handlers
   (`setActionHandler("play"/"pause"/"previoustrack"/"nexttrack", ...)`)
   is a completely legitimate, first-party OS integration point, not a
   workaround — it is exactly the same mechanism real streaming sites
   (Spotify Web Player, YouTube Music, etc.) use to appear in Windows'
   own "now playing" widget, and it registers a genuine SMTC session
   with the real OS. This closes the loop with code already built in
   this repo: `getNowPlayingState()`
   (`docs/adr/0025`, `GlobalSystemMediaTransportControlsSessionManager`)
   does not need to change at all — a correctly-configured page is
   simply a real session for it to read, the same as any other real
   media app.

## Decision

### A real, minimal HTML fixture

`platform/desktop-app/test/fixtures/media-session-fixture.html`: a
real, self-contained page with a real (if silent), valid, looping WAV
`<audio>` element (a genuine 1-second, 8kHz, 8-bit PCM WAV — real
audio data, not an empty/missing source, since some browsers
deprioritize or refuse SMTC registration for elements that never
actually produce a decodable audio stream), and real
`navigator.mediaSession` wiring: `play`/`pause` handlers that call
`audio.play()`/`audio.pause()` and set `playbackState`; `nexttrack`/
`previoustrack` handlers that rotate through a real, fixed, three-title
in-page playlist and update `mediaSession.metadata`. The audio is
silent by design (should not be audible during an automated test run),
not an attempt to hide anything about what the page does.

### A real, native launcher

`platform/desktop-app/test/support/media-session-fixture-launcher.ts`
(test-support only, never shipped): `launchMediaSessionFixture()` runs
a real, native PowerShell `Start-Process -FilePath 'msedge.exe'
-ArgumentList '--autoplay-policy=no-user-gesture-required', ... -PassThru`
via this repo's existing `ShellExec` contract, relying on Windows' own
"App Paths" registry resolution for `msedge.exe` (registered by every
real Edge install) rather than a hard-coded path. Returns the real,
independent process's PID.
`--autoplay-policy=no-user-gesture-required` is a real, documented,
first-party Edge/Chromium flag for exactly this kind of automated
scenario — not an exploit or workaround.
`closeMediaSessionFixture()` sends a real `Stop-Process -Id <pid>
-Force -ErrorAction SilentlyContinue`, called from the test's `finally`
block regardless of outcome.

### The test itself: hard assertions once a real session exists, honest fallback if it doesn't

A new test in `media-control-capability.real.test.ts` (the two
existing, environment-dependent tests from docs/adr/0025 are
unchanged): launches the real fixture, then polls — with a real,
bounded 20-second timeout — the same real `getNowPlayingState()` until
it reports an active session with the fixture's expected initial track
title (confirming the real session is genuinely registered and
readable, not assumed). If established, every subsequent physical
assertion is **hard and unconditional** — `media_play` must result in
`status === "playing"`, `media_pause` in `status === "paused"`,
`media_next`/`media_previous` in the exact expected track title — with
no weakening, exactly as strict as `audio-capability.real.test.ts`'s
volume assertions. If a real, active, readable session still cannot be
established within the timeout on a given run (a real Edge autoplay/
window-focus quirk, a machine-specific policy, etc.), the test
explicitly logs `"NOT VERIFIED (could not establish a real, active,
readable media session via the Edge fixture within 20s)"` and returns
without asserting the physical claims — the honest outcome the user
required, not a forced failure of the whole suite on an environmental
precondition, and not a false success.

### New test coverage

`media-session-fixture-launcher.test.ts` (new, always-run, no real
hardware needed): proves the real `Start-Process`/`Stop-Process`
command construction (the correct flags, the correct PID parsing, real
error propagation on a launch failure, and that cleanup never throws
on an already-gone process).

## Consequences

- Physical verification of `media_play`/`media_pause`/`media_next`/
  `media_previous` no longer depends on what happens to already be
  playing on the test machine — a real, controllable session can be
  created on demand, using only first-party OS/browser mechanisms.
- This environment _improves the odds_ of physical verification
  succeeding; it does not itself constitute proof — the test's own
  polling/timeout logic can still honestly report NOT VERIFIED if Edge
  or SMTC registration doesn't cooperate on a given real run, and that
  outcome must be reported as such, not glossed over.
- Real re-verification (does the fixture's real SMTC session actually
  get created and read correctly, do all four hard physical assertions
  actually pass) is the explicit next step — not yet performed as of
  this document.
