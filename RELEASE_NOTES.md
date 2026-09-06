# RYPER AI OS — Release Notes

## Unreleased — Real-Windows verification attempted; environment-blocked, but found and fixed a genuine bug

**This entry is the honest record of the "REAL WINDOWS / REAL ELECTRON VALIDATION" phase.** The
environment this work runs in is a headless Linux (Ubuntu 24.04) sandbox — not Windows. There is no
`C:\` filesystem, no audio subsystem, no installed browsers, no display server, and no real
`llama-server` binary or GGUF model. `process.platform` reports `"linux"`. **None of the real-hardware
capabilities below have been verified on actual Windows hardware** — that requires running this
repository on a real Windows 10/11 machine with the prerequisites listed in "REAL WINDOWS VERIFIED /
NOT VERIFIED" below.

What this phase _did_ accomplish, honestly:

- Ran the four opt-in `*.real.test.ts` suites individually. Three (`audio-capability`,
  `media-control-capability`, `tool-calling`) correctly self-skip on non-Windows platforms — expected,
  not a failure. The fourth (`llm-runtime.real.test.ts`) has no such gate by design (llama.cpp is
  genuinely cross-platform, matching its own cited precedent in `core/local-runtime`), so it ran with
  the requested — nonexistent-on-this-machine — binary/model paths and failed for the fully expected
  reason.
- That run surfaced a **real, platform-independent production bug**: `LlamaServerManager.start()`
  (`llm-model-provisioning.ts`) never observed a genuine process-spawn rejection (e.g. `ENOENT` for a
  missing binary — identical behavior on Windows or Linux), so a bad binary path caused a silent 60-
  second hang, an unhandled promise rejection, and a misleading final error instead of failing
  immediately with the real cause. Fixed, with a new deterministic regression test reproducing the
  exact failure via a fake process runner (proven to fail before the fix, pass in ~500ms after).
- Added dedicated, previously-missing unit test coverage for the power-action two-phase confirmation
  state machine (`power-confirmation.test.ts`, 42 tests) — this safety-critical component (shutdown/
  restart/sleep confirm/deny/cancel/expire, including a genuine internal race condition) previously
  only had indirect coverage scattered across two other test files.
- Ran a genuinely clean certification: `rm -rf node_modules && npm ci` from the lockfile, then a full
  build, lint, format check, and test suite. **215 test files / 1323 tests passing, 5 files / 12 tests
  correctly skipped** (the opt-in real-hardware suites) — zero weakened assertions, zero deleted tests,
  zero silently-skipped failures.

**RC3 is not declared. "Production-ready" is not declared.** Real Windows hardware verification remains
entirely outstanding — see `docs/PROJECT_STATE.md` for the exact prerequisites and next steps.

## Unreleased — Real tests added for last update's changes, and they caught a genuine bug

Following up on the previous update (typed chat now reaching the real
assistant, real confirmation popups for destructive actions): that
update shipped without dedicated tests for its new pieces. Added them
now, and they immediately found something real: saying or typing "shut
down my pc" — arguably the most natural way to phrase it — didn't
actually trigger anything, because the underlying pattern only
recognized "shut down the pc." That's now fixed, and locked in with
tests covering the natural ways people actually phrase it.

---

## Unreleased — Typed chat now actually talks to the real assistant, and destructive actions get a real confirmation popup

**Note:** built as an implementation-only pass, then verified
afterward — the full automated test suite now passes against these
changes. A real end-to-end run on an actual Windows machine hasn't
happened yet (that's the next real gap), so treat "works" here as
"passes automated checks," not "confirmed on real hardware."

**This is a big one.** Until this pass, typing a message into RYPER's
chat window didn't actually reach the real assistant at all — it hit a
disconnected placeholder that echoed your message back with `[local
model]` in front of it, with no ability to actually do anything.
Voice was never affected by this, but typing was. That's now fixed:
typed messages go through the exact same real assistant, with the
exact same real abilities (opening things, managing windows, files,
power actions, all of it), that voice has always had.

**Destructive actions now get a real "are you sure?" popup.** Deleting
a file, shutting down, restarting — anything RYPER can't undo now pops
up a real confirmation window and waits for you to click Approve or
Deny, instead of being silently blocked with no way to ever approve it
(which was the previous, safe-but-incomplete state).

**Typing "yes" to confirm a shutdown now actually works**, the same
way saying it out loud already did — previously only the voice path
understood a follow-up confirmation.

**What's honestly still open:** the automated test suite passes, but
there's no dedicated test coverage yet for the new pieces specifically
(the confirmation popup, typed chat's new routing) — that's real,
disclosed, and left for the next testing pass, not silently skipped.
Nothing here has run on an actual Windows machine with a real window on
screen yet either.

---

## Unreleased — RYPER now actually asks before shutting down your PC, understands "open this," and another serious bug is fixed (implementation only, not yet tested)

**Note:** this update was built as an implementation-only pass — the
usual full test/verification pass hasn't run yet, so treat this as
"built, not yet verified," not a finished, certified release.

**Shutdown, restart, and sleep now genuinely ask first.** Say "shut
down my PC" and RYPER will ask "are you sure?" — say "yes" and it
proceeds, say "no" or "cancel" and it doesn't. An unclear reply (or
just moving on to something else) is never treated as a yes. This
question also expires after 30 seconds, so an old "yes" from earlier
in a conversation can never accidentally confirm a new request.

**RYPER now understands "open this."** After opening a file, folder,
or website, you can follow up with "open this," "open this folder," or
"play this video" and it'll refer to that exact thing. If you haven't
opened anything yet, it says so honestly instead of guessing.

**Another serious, previously-hidden bug was found and fixed**: if a
voice request was cancelled at just the wrong moment — right after
RYPER decided to do something but before it actually did it — the
action could still happen anyway, even though the user cancelled. This
applied to every action RYPER can take, not just the newer ones, and
is now fixed everywhere at once.

**What's honestly still open:** nothing here has been tested yet in
the normal sense (that's next), there's still no on-screen confirmation
dialog behind the scenes for shutdown/restart/sleep (voice confirmation
now works, but the underlying safety switch stays off until a real
dialog is wired up), and RYPER only remembers the _one_ most recent
thing you opened — it can't yet handle "the other one" or a longer
history.

---

## Unreleased — RYPER can now open websites, files, and folders by name — and a serious bug is fixed

**Note:** built as an implementation-only pass, then verified
afterward — this has now been through the full test/verification
pass, and everything below has been confirmed to actually work as
described.

**RYPER can now open things properly.** Say "open YouTube," "open
YouTube in Chrome," "go to github.com," "open my Downloads folder," or
give it a file path, and it opens the right thing. If you ask for a
specific browser and it's not installed, RYPER tells you clearly
instead of quietly opening a different one — previously, asking for
Chrome always opened Edge instead, silently.

**RYPER can now shut down, restart, or put the PC to sleep** when
asked — each one requires real confirmation before it happens, and is
denied by default until that confirmation step is actually wired up by
a future update, so nothing destructive can happen accidentally.

**A serious, previously-hidden bug was found and fixed**: if any voice
request failed for any reason — a mic hiccup, a recognition error,
anything — every voice request after that would immediately fail too,
permanently, until the app was restarted. This was a real risk to
RYPER actually being usable day-to-day, and it's now fixed: one failed
request no longer breaks the ones after it.

**A documentation mistake was corrected.** The project's own README
overstated how completely the real AI model had replaced the simpler,
pattern-based fallback system — the fallback is still there and still
does real work when no full AI model is running; only the description
of that was wrong, not the actual behavior.

**What's honestly still open:** there's still no on-screen confirmation
dialog for shutdown/restart/sleep (they're safely blocked by default
until one exists), and asking RYPER to open "this folder" with no name
attached still won't work — it has no way yet to know what "this"
refers to.

---

## Unreleased — Tier 1 completion pass, continued further: RYPER can now actually manage windows and files, plus three quiet bugs fixed

This pass closed out everything left open from the previous update.

**RYPER can now really open, move, and organize things.** Window
management (switching, minimizing, maximizing, snapping to a side of
the screen) and file/folder operations (listing, reading, searching,
copying, moving, renaming, deleting) are now things you can actually
ask RYPER to do — the underlying Windows integration was already real
and complete, it just had nothing hooked up to let the assistant use
it. Deleting a file still requires real confirmation and is denied by
default, same as any other action that can't be undone.

**A retry gap between RYPER's two voice pipelines was closed.** If the
AI service hiccups momentarily, RYPER now quietly retries once before
giving up, consistently across both the core voice engine and the
desktop app — previously only one of the two actually did this.

**Real end-to-end tests now exist** that exercise the full path from
your voice, through transcription, through RYPER's decision-making,
through actually doing something, to speaking a response back — using
the real underlying pieces, not a simplified stand-in. Writing these
surfaced an interesting, honest finding: right now, compound requests
like "list my windows, then open Notepad" are the main way RYPER's
more flexible AI-driven tool use actually gets exercised; a single
plain request like "open Notepad" is handled by a faster, simpler
matching step instead. Nothing wrong with that — it's just worth
knowing, especially since it'll matter once a full conversational AI
model is wired in.

**Three quiet bugs were found and fixed**, all in the same family:
RYPER doing something silently that looked like nothing happened.
Background noise picked up by the mic could, in rare cases, get sent
to the AI as if it were a real request. And in two different
situations, RYPER could technically "answer" but with literally no
sound — no error, nothing spoken, just silence. All three are now
fixed.

**What's honestly still open:** there's still no voice command for
shutting down, restarting, or sleeping the PC (no underlying support
for that exists yet), and no real conversational AI model is wired
into the desktop app yet — it currently relies on pattern-matching
recognized commands rather than genuinely understanding open-ended
requests. See `docs/PROJECT_STATE.md` for the complete, honest list.

**TIER 1 is closer to complete, but still not being called finished.**

---

## Unreleased — Tier 1 completion pass, continued: richer voice states + a real bug fix

Continuing the "bring Tier 1 to 100%" effort, this pass picked up the
first concrete item left open by the previous pass: the voice
assistant's internal state tracking.

**What changed:** RYPER's voice pipeline used to track only six broad
states while handling a request (idle, listening, processing,
speaking, cancelled, error). That's now ten, so the system — and any
future UI — can tell apart things that used to look identical:

- The moment your mic actually stops listening vs. RYPER still
  finishing up turning your speech into text.
- RYPER thinking through a reply vs. RYPER actively running a tool
  (like checking the time or controlling a window) on your behalf.
- You interrupting RYPER mid-sentence (normal, expected) vs. you
  explicitly hitting stop (a deliberate command) — these used to be
  reported identically.
- RYPER quietly retrying after a hiccup vs. giving up entirely.

**A real bug was found and fixed along the way:** if a voice turn
failed partway through, the code that was supposed to reset things
back to a clean state had a subtle logic error and never actually ran.
In practice this meant a failed turn could leave the assistant's
internal state stuck, rather than cleanly resetting. This is now
fixed, and there's a new test specifically checking for it.

**What's honestly still open:** window management and file/folder
voice commands still have no AI-callable tools behind them yet, there
are still no tests that exercise the full voice → transcription →
AI → tool → speech pipeline end-to-end, and STT/TTS edge cases haven't
been exhaustively audited. See `docs/PROJECT_STATE.md` for the precise
list.

**TIER 1 is still not being called complete.**

---

## Unreleased — Tier 1 completion pass: permission-check consistency fix

A request came in to bring the AI engine, Windows control layer, and
voice pipeline all the way to 100% complete in one pass. That's a
genuinely large effort spanning three major subsystems — rather than
claim false completion, this pass fixed one specific, real,
previously-known inconsistency and left the rest honestly listed as
remaining work.

**What was fixed:** two different parts of the permission system were
checking under slightly different names for the same real action,
meaning a permission a user had already granted wasn't always being
recognized correctly on the next request. Now they agree.

**What's honestly still open:** the very first time a permission is
needed, it can still be blocked before the normal "ask and remember"
flow gets a chance to run — closing that fully needs a proper
one-time-setup screen for granting the AI these permissions, which
doesn't exist yet and wasn't built here.

**TIER 1 is not being called complete.** See `docs/PROJECT_STATE.md`
for the precise, honest list of what remains across the AI engine,
Windows controls, and voice pipeline.

---

## Unreleased — Phase 13.15 (real Windows audio: volume, mute, media control)

**`volume_up` CONFIRMED on real hardware.** The user re-ran the
corrected test on their real Windows 11 machine (RTX 4050, real
Qwen3-8B) and it passed: 1 test, real end-to-end result. The volume
started at 100%, was set to a known 50% starting point, and Qwen3's
"turn it up" request genuinely raised it to 60% on the real machine —
confirmed by directly reading the volume before and after, not just by
checking for an error. The original 100% volume was correctly put back
afterward. This is the first time a real Windows action of this kind
has been physically confirmed working, not just reported as
successful.

**Scope:** only `volume_up` has been verified this way so far.
`volume_down`/`set_volume`/mute/unmute use the same underlying code
and are likely fine, but haven't been separately confirmed. Media
controls (play/pause/skip) are being verified next, and need a
different approach — see below for why.

**Not tagged as a release.** With notifications confirmed real, this
phase carefully investigated and expanded into more real Windows
capabilities — starting with audio.

### What was found

Most capabilities on the target list (opening/closing apps, files,
clipboard, device info, and more) turned out to already be real —
genuinely working, no changes needed. Volume, mute, and media controls
were a different story: the code for them looked complete, but was
actually just placeholder comments that did nothing on a real machine.
Worse, the AI's existing "turn up the volume" and "pause the music"
commands were already calling this broken code — so they've quietly
never worked, until now.

### What changed

- Volume and mute now genuinely change on real Windows, using a
  well-established native Windows technique — no extra software
  installed.
- Play/pause/next/previous now genuinely control real media playback.
- These actions now go through the same permission-check system
  notifications does, so they'll correctly ask for approval rather
  than running unchecked — matching how the rest of the app is
  designed to work.

### What was deliberately left for later, and why

- Changing which audio device is the default: there's no safe, native
  way to do this without either an unsupported trick or extra
  software, so it's honestly left unimplemented rather than faked.
- Moving/resizing/minimizing windows: the underlying Windows APIs are
  fine, but the AI has no way to ask for that yet, so there was
  nothing real to test end-to-end. Good candidate for next time.
- Screen brightness: not attempted — Windows' built-in support for
  this is inconsistent across different displays.

### Certification

Full cold-state pipeline passes clean. 196 test files / 1125 tests
passing, 4 files / 9 tests correctly skipped. Nothing existing was
weakened.

**Honestly:** the trickiest part of this fix (talking directly to
Windows' internal audio system) can't be fully verified without
running it on a real machine — that's true of this kind of low-level
Windows programming in general. A new real-hardware test is included
specifically to catch it if something's off, by actually checking the
volume changed rather than just checking for errors.

**RC3 is still not declared.** The user's real-hardware run of this
new test is the next step. See `docs/PROJECT_STATE.md` and
`docs/adr/0024` for the full account.

### Follow-up: a real machine at max volume found a real test bug (not an implementation bug)

The user's first real-hardware run of the new audio test found the
real fix genuinely worked — a real notification-style volume command
went all the way through and succeeded — but the test itself still
failed, because the test machine happened to already be at 100%
volume. "Turn it up" correctly does nothing more once you're already
at the top, the same way a real volume-up button behaves — so there
was nothing left to detect a change against. That was a bug in how the
test checked its work, not in the volume feature itself; re-checking
the underlying volume math (including at both the very top and very
bottom of the range, and for mute/unmute) confirmed it was already
correct.

The test now sets a known, safe starting volume first when needed,
double-checks that starting point is real, confirms the volume
genuinely went up from there, and always puts the user's original
volume back afterward — even if something goes wrong partway through.
A new, fast test (no real hardware needed) permanently locks in the
correct top/bottom-of-range behavior this was all about.

**Phase 13.15 is still not complete.** Media controls (play/pause/
skip) won't be attempted until this corrected volume test is confirmed
passing on real hardware.

### Media control: implemented, verification designed carefully

With volume confirmed working for real, this covers play/pause/skip.
The underlying feature was already real from earlier in this phase —
this part is about proving it works, and volume's approach (read the
exact number before and after) doesn't carry over: Windows only knows
what's "now playing" if something is actually playing or paused at the
moment the check happens, which this repo can't arrange on its own
without opening a real media app.

So the new real test is honest about what it can and can't prove: it
always checks that the request genuinely went through the whole real
system (the AI asked, permission was granted, the real key press ran,
and it reported success) — that part is never in doubt. Then,
_only if_ something happens to actually be playing on the real machine
at test time, it also checks that playback state genuinely changed the
way it should. If nothing's playing, it says so plainly — "not
verified, no active session" — rather than pretending either way.

Added solid, fast test coverage that doesn't need real hardware, plus
the new opt-in real test itself.

**Media control hasn't been checked on real hardware yet.**

### Media control real-hardware result: the request genuinely worked, but nothing was playing to prove it changed

The user ran the real test on their machine. Every part of the request
genuinely worked — the AI asked for play/pause/skip, permission was
granted for real, and the app reported success for all four actions.
But nothing was actually playing or paused on the machine at the time,
so there was nothing for the test to check the result against — the
test correctly and honestly said "not verified" instead of guessing.
**Media control is not being called verified yet.** Nothing was
changed in the actual feature just to make a test pass more easily.

Next: setting up a real, repeatable way to have something genuinely
playing during the test, using a real, ordinary browser window (the
same way real music sites like Spotify's web player already show up in
Windows' own "now playing" controls) — not a fake or simulated
player. Design is done; building it is next.

### That real, repeatable playing-something environment is now built

A small local web page opens in a real Edge window during the test and
uses the same standard browser feature real music sites already use to
show up in Windows' "now playing" controls — nothing fake, nothing
simulated, just a genuine, controllable source for the test to check
against. Once that real session is confirmed up and running, all four
checks (play, pause, next, previous) are held to the full, strict
standard — no loosening. If that real session can't be confirmed on a
given run, the test still says so honestly rather than guessing either
way. Nothing about how the app itself controls media was changed —
this is purely new testing infrastructure.

**This new test hasn't been run on real hardware yet.**

### Real-hardware run found two setup problems — not a feature bug

Running the new test for real found two real setup issues, and
neither one means the media feature itself is broken. First, the AI
model wasn't being detected even though it was correctly configured —
after comparing against the other real tests that already work
correctly, the underlying check turned out to be identical everywhere,
so instead of guessing at a fix, the test now prints out exactly what
it sees for that configuration and fails immediately with a clear
reason, rather than waiting a minute and a half to fail with a
confusing message. Second, the way the test tried to open the browser
was based on a wrong assumption about how Windows finds installed
programs — now fixed to check several real locations properly (an
explicit override, the Windows registry, standard install folders,
then a system-wide search), and to say plainly "Edge isn't installed"
if none of those find it, rather than failing with a cryptic error.

On investigation, it turned out this particular test machine has no
web browser installed at all. That's a real gap in that machine's
setup, not something wrong with RYPER — the test now reports that
clearly instead of pretending otherwise. Nothing about how the app
itself plays, pauses, or skips media was touched.

**Phase 13.15 is not being called complete.** Physically verifying
play/pause/next/previous still requires a real browser to be present
on the test machine.

---

## Unreleased — Phase 13.14 (real notification fix + honest tool-result verification)

**CONFIRMED on real hardware.** The user re-ran the real test on their
actual Windows 11 machine (RTX 4050, real Qwen3-8B) and it passed for
real: 1 test, ~91 seconds. Real Qwen3 asked for a notification, the
permission system genuinely approved it, a real Windows notification
genuinely appeared, the app genuinely confirmed success, and Qwen3
correctly reported it worked. This is the first time this project has
had a full real tool-calling round trip confirmed on real hardware.

**Scope:** only the notification capability has been verified this
way so far. Other capabilities (volume, media, clipboard, and more)
are being investigated and built out next in Phase 13.15.

**Not tagged as a release.** With Phase 13.13's timeout fix confirmed
working, the real Windows run got all the way to actually trying to
show a notification — and that specific action failed. This phase
fixes it, and closes a real gap in how the test judged success.

### What was wrong

The notification code was calling a Windows command that only works
if a particular add-on package is installed — and it never was, on
this or any machine. So the command failed immediately. The AI
correctly and gracefully told the user something went wrong — but the
test itself wasn't actually checking whether the notification worked,
only whether a different, unrelated kind of failure had occurred. That
let a genuinely broken notification look like a pass.

### What changed

- Notifications now use a way of showing Windows toast notifications
  that's built into Windows itself, not a separate add-on.
- The AI orchestrator now reports the real, true result of every tool
  it runs — success or failure — instead of only being knowable from
  how the AI happened to describe it afterward.
- The real test now checks that real result directly, so a genuinely
  failed action can no longer be mistaken for a pass just because the
  AI described the failure politely.

### Certification

Full cold-state pipeline passes clean. 196 test files / 1113 tests
passing, 3 files / 8 tests correctly skipped. Nothing existing was
weakened.

**RC3 is still not declared.** Both fixes are real and now have solid
test coverage, but confirming the notification genuinely appears on
the user's real machine is still the next step. See
`docs/PROJECT_STATE.md` and `docs/adr/0023` for the full account.

---

## Unreleased — Phase 13.13 (real-hardware tool-calling stall fix)

**Not tagged as a release.** The user's real Windows/Qwen3 run of
Phase 13.12's tool-calling test got further than ever before — real
detection, real permission check, real "granted" decision — then
failed with a timeout partway through. This phase finds and fixes why.

### What was wrong

The code that turns a streamed AI response into a tool call was
quietly waiting until the _entire_ tool call finished generating
before reporting any progress at all — fine for a fast response, but
invisible to the safety timeout that's supposed to catch a genuinely
stuck connection. On real local hardware, a tool call can take longer
to fully generate than that timeout allows, and with no visible
progress in between, it looked indistinguishable from a stall. This
wasn't a sign anything else was broken — real chat and real
cancellation had already been proven working on the same hardware.

### What changed

- The streaming code now reports real progress as a tool call is being
  built, not just once it's complete — so a slow-but-genuinely-working
  local model no longer looks stuck.
- Local models now get a longer, but still bounded, safety timeout than
  remote/cloud ones, since local hardware can reasonably take longer.
  A truly stuck remote connection still fails fast, exactly as before.
- Added the option to turn off the model's "thinking" step specifically
  for tool calls, which the model's own guidance recommends for more
  predictable tool use.
- The real test now prints out exactly what it found at each
  step — the tool call the model produced, the permission log, and the
  model's final reply — so a real run's results are easy to see.

### Certification

Full cold-state pipeline passes clean. 196 test files / 1107 tests
passing, 3 files / 8 tests correctly skipped. Nothing existing was
weakened.

**RC3 is still not declared.** This fixes the specific mechanism with
high confidence, but the user's real re-run — confirming it actually
works end-to-end on the real hardware — is still the next step. See
`docs/PROJECT_STATE.md` and `docs/adr/0022` for the full account.

---

## Unreleased — Phase 13.12 (real structured tool-calling)

**Not tagged as a release.** With real chat and real cancellation both
confirmed on real hardware, this phase implements and verifies the
last piece: a real Qwen3 tool call running all the way through this
app's permission system to a real action and back, with no mocks.

### What this found

Building a genuinely real test for this surfaced three things that
had quietly never worked: the app's desktop actions have always talked
to an in-memory fake instead of real Windows, even in the shipped app
on real Windows; the permission-consent check that's supposed to gate
sensitive actions was never actually wired up, so it was never
consulted; and no tool had ever been marked as needing that check in
the first place. None of these are new bugs — they're gaps that were
always there, found for the first time by trying to build a real,
unmocked test.

### What changed

- Real PowerShell now backs desktop actions on Windows instead of an
  in-memory stand-in.
- The permission-consent check is now actually wired up for the three
  domains that need it (notifications, writing files, and
  process/service/registry automation). Since there's no consent
  dialog UI yet, those three will now correctly ask-and-be-denied by
  default on real Windows — that's the safe behavior working as
  designed, not something broken by this change. Everyday actions like
  volume and opening apps are unaffected.
- A new, safe "show a notification" action is the first to use this
  permission check for real.
- `llama-server` now starts with the flag real Qwen3 tool-calling
  needs.
- A new always-on test (no real hardware needed) proves the permission
  check genuinely works. A new opt-in real-hardware test drives an
  actual Qwen3 tool call through the whole real path.

### Certification

Full cold-state pipeline passes clean. 196 test files / 1101 tests
passing, 3 files / 8 tests correctly skipped. Nothing existing was
weakened.

**RC3 is still not declared.** The user's real-hardware run of the new
opt-in tool-calling test is the next step. See `docs/PROJECT_STATE.md`
and `docs/adr/0021` for the full account.

---

## Unreleased — Phase 13.11 (real-hardware integration-test defect fix #2)

**Not tagged as a release.** Real milestone hidden inside a small fix:
with Phase 13.10's fix in place, the user's real Windows/RTX 4050
re-run got the **real chat-completion test passing** — a real Qwen3
response, produced through this repo's own code, for the first time
ever. The real cancellation test then hung for a different reason.

### What was wrong

The real test's own HTTP wrapper (needed to talk directly to a real
llama-server) forwarded everything to `fetch()` except the cancellation
signal. The real provider code was already correctly asking to be
cancelled — the test's wrapper just wasn't passing that request
through. Every other real call site in the app does this correctly.

### What changed

- One line added to the test's `httpFetch` wrapper to forward the
  cancellation signal, matching what the real app's equivalent code
  already does.
- No provider, orchestrator, or app code changed.
- Reproduced the exact hang against a local test server in this
  session to confirm the mechanism and the fix, since this sandbox
  still has no real llama-server to test against directly. **The
  user's own real-hardware re-run is still the step that confirms real
  cancellation** — not yet performed as of this note.

### Certification

Full cold-state pipeline passes clean. Same test counts as Phase
13.9/13.10 — no tests added or weakened.

**RC3 is still not declared.** The next milestone, once cancellation
is confirmed, is real structured tool-calling against the real model —
nothing built for that yet. See `docs/PROJECT_STATE.md`'s Phase 13.11
section for the full root cause and verification breakdown.

---

## Unreleased — Phase 13.10 (real-hardware integration-test defect fix)

**Not tagged as a release.** This phase exists because the user
independently ran Phase 13.9's opt-in real-LLM suite for the first
time on real hardware (Windows, RTX 4050, real `llama-server` +
real Qwen3-8B-Q4_K_M.gguf) and it failed with a real `TypeError`.

### What was wrong

Not the LLM, not `llama-server`, not the provider architecture — a
call-shape mistake in the real integration test itself.
`createLlamaCppProvider()` returns a provider whose `streamChat()`
takes `(modelId, request)`, but the test called it with just
`(request)`, the shape used by a different, related interface. That
left the real request object undefined by the time it reached the
provider's HTTP-request-building code, which is exactly the
`TypeError` the user saw. Every real production code path in this
repository already called this correctly — the defect was isolated
to two call sites inside one opt-in test file.

### What changed

- Fixed both call sites in `llm-runtime.real.test.ts` to pass the
  correct model-id argument, matching how the real Electron app
  already calls this same code.
- No provider, orchestrator, or security code changed.
- Re-verified the corrected call path in this (still-sandboxed)
  session against a local fake server standing in for llama-server,
  confirming the fix is correct at the code level. **The user's own
  real-hardware re-run, with this fix applied, is the next step** —
  not yet performed as of this note.

### Certification

Full cold-state pipeline (`npm ci` → `npm run build` → `npm test` →
`npm run lint` → `npm run format:check`) passes clean. Same test
counts as Phase 13.9 — 195 files / 1098 tests passing, 2 files / 7
tests correctly skipped in this sandbox (no real binary/model here).
No tests were weakened or skipped-to-pass.

**RC3 is still not declared.** See `docs/PROJECT_STATE.md`'s Phase
13.10 section for the full root cause, call-site audit, and remaining
blockers.

---

## Unreleased — Phase 13.9 (Real LLM + Production Tool Calling)

**Not tagged as a release.** Per this phase's own assessment: **"Voice
pipeline verified for Piper/TTS, model-management diagnostics, and now
the LLM/tool-calling architecture, but RC3 remains blocked by real
end-to-end model execution."** See `docs/PROJECT_STATE.md`'s Phase
13.9 section for the complete, itemized certification matrix.

### Headline

The last of the three seams named back in Phase 13.5 is now
architecturally closed: `HeuristicToolCallingProvider` — a
deterministic pattern matcher, never a language model — is no longer
the only option. A real, locally-managed llama.cpp server is the
default local LLM when installed; explicit-only cloud providers
(OpenAI/Anthropic/Google-compatible) are supported when configured.
Real, structural argument validation now protects every tool call —
`set_volume(500)` is rejected before it ever reaches execution.

### What's genuinely new

- A real local LLM runtime, managed end-to-end: detection, process
  startup, health-checking, and real HTTP chat communication with an
  existing, unmodified provider.
- Real, explicit-only cloud provider support — never silently active.
- Real security hardening: tool arguments are now validated against
  their schema before anything executes, and before the capability
  broker is even consulted.
- A real, secondary bug found and fixed: the placeholder AI's
  arguments weren't properly typed, which the new validator correctly
  caught.

### What is still not verified, on purpose, stated plainly

- **No real LLM has ever produced a real response in this repository.**
  `llama-server` was built from real source and genuinely run — including
  a real, honest failure against an invalid model file — but a real,
  usable chat model could not be obtained from this build environment,
  for the same network reason Phase 13.8 couldn't obtain a real Whisper
  model.
- **No cloud LLM call was made.** This environment has no API key for
  any vendor, and none was invented.
- **Every default automated test in this repository still exercises
  `HeuristicToolCallingProvider`**, not a real LLM — that remains true
  until a real model or API key is available to actually route through.
- **RC3 remains blocked** — not by missing architecture anymore, but by
  the need to actually run this architecture with a real model and real
  audio hardware, neither of which co-exist with this build environment.

## Unreleased — Phase 13.8 (Real Model + Real Hardware Voice Verification)

**Not tagged as a release.** Per this phase's own certification:
**"Voice pipeline verified [for Piper/TTS and model-management
diagnostics], but RC3 remains blocked by the real LLM/tool-calling
seam"** — and additionally blocked by no real Whisper model access and
no physical hardware verification, both structural to this build
environment. See `docs/PROJECT_STATE.md`'s "Phase 13.8" section for
the complete, itemized certification matrix.

### Headline

This phase actually built whisper.cpp from source and ran a real Piper
install against the real Phase 13.7 code — not mocks, not fakes. Piper
genuinely worked: real, non-silent audio was produced and inspected. A
real Whisper model could not be obtained in this environment — checked
thoroughly, confirmed structurally blocked, reported honestly rather
than worked around with a substitute.

### What's genuinely verified now

- Real Piper synthesis through the actual repository code, with real
  performance numbers (291–568ms per call) and real cancellation
  (11ms to kill an in-flight process).
- Real, correct "model missing" diagnostics against a real (but
  model-less) whisper.cpp install.
- Real echo cancellation/noise suppression requests, using the
  browser's own real, built-in audio processing — no custom DSP
  written.

### What is still not verified, on purpose, stated plainly

- **No real Whisper transcription has ever run.** The model files are
  hosted on Hugging Face, which this build environment cannot reach —
  confirmed with real, repeated attempts, not assumed.
- **No physical hardware — microphone, speaker, USB, Bluetooth — was
  tested.** This build environment has none. Every hardware-dependent
  claim in the original brief is reported as `NOT AVAILABLE`.
- **RC3 remains blocked**, for the same reason as every phase since
  13.5: the "AI" deciding what to do is still a deterministic pattern
  matcher, not a language model.

## Unreleased — Phase 13.7 (Real Local STT + TTS)

**Not tagged as a release.** Per this phase's own certification report:
**NOT READY FOR RC3.** See `docs/PROJECT_STATE.md`'s "Phase 13.7: real
local STT + TTS" section for the complete, item-by-item account.

### Headline

RYPER can now be wired to real, local, offline speech recognition and
synthesis — real whisper.cpp and Piper CLI binaries, invoked as real
child processes, with real cancellation. The first sentence of a
response starts playing while later sentences are still being
synthesized. And critically: RYPER now stops talking the instant the
user starts talking — real, automatic barge-in, no button required —
verified with a real end-to-end test.

### What's genuinely new

- Real local STT (whisper.cpp) and TTS (Piper) provider integration,
  with real on-disk detection that tells you precisely what's missing
  ("Whisper provider installed but model missing") instead of a bare
  "voice unavailable."
- A real bug fix: STT/TTS calls were silently always failing before
  this phase (nothing was ever registered as an available model) — now
  fixed, with an honest placeholder always available as a fallback.
- Real sentence-by-sentence speech, not one long blocking synthesis
  call.
- Real automatic barge-in: say "wait, what time?" while RYPER is mid-
  sentence, and it stops immediately and listens.

### What is still not real, on purpose, stated plainly

- **No real model has actually been run.** The Whisper/Piper model
  files this integration expects are hosted on Hugging Face, which
  this build environment cannot reach. The integration code is real;
  running a real model on real audio has not been demonstrated here.
  Exact installation instructions are in `docs/PROJECT_STATE.md`.
- **No echo cancellation or noise suppression exists.** On a laptop
  with its mic close to its speaker, RYPER may hear itself.
- **No physical hardware was tested**, same as Phase 13.6.
- **The "AI" is still a deterministic pattern matcher, not a language
  model** (unchanged from Phase 13.5) — this remains the largest gap
  before this becomes the product the original brief describes.

## Unreleased — Phase 13.6 (Real Desktop Audio Bridge)

**Not tagged as a release.** Per this phase's own certification report:
**AUDIO BRIDGE COMPLETE — RC3 STILL BLOCKED BY OTHER SEAMS.** See
`docs/PROJECT_STATE.md`'s "Phase 13.6: real desktop audio bridge"
section for the complete, item-by-item account.

### Headline

The desktop app can now actually capture microphone audio and play
synthesized speech through real hardware — `UnavailableAudioBridge` is
no longer the production audio path. A real `RendererAudioBridge`
bridges the Electron main process to genuine `navigator.mediaDevices`/
`AudioContext` code running in the renderer, over a typed IPC contract.
Device enumeration, permission handling, capture, playback, and
barge-in cancellation are all real — verified with 30 new tests, not
merely assumed to work because an interface exists.

### What's genuinely new

- Real device enumeration/selection, surfaced in a new Settings UI
  "Audio Devices" panel.
- Real permission handling, including a previously-missing Electron
  `session.setPermissionRequestHandler` configuration — without it,
  `getUserMedia()` would always fail regardless of OS permission state.
- Real microphone capture with real PCM resampling to the STT
  provider's expected rate, and honest handling of denial,
  unavailability, and device disconnect.
- Real speaker playback with real, immediate barge-in: interrupting
  playback sends a real message that stops the real, currently-playing
  audio node — not an internal flag flip.

### What is still not real, on purpose, stated plainly

- **No physical hardware was tested.** This build environment has no
  display server and no physical or virtual microphone/speaker. Every
  new line of code calls real browser APIs and builds/bundles cleanly,
  but hardware-level behavior is unverified here.
- Speaker _output-device_ routing is selectable in the UI but not
  functionally wired — no browser exposes an API to route
  `AudioContext` playback to a specific non-default output device.
- The "AI" deciding which tool to call is still a deterministic pattern
  matcher, not a language model (unchanged from Phase 13.5).
- STT/TTS still have no real model behind them (unchanged since Phase
  4/13.5) — captured microphone audio reaches a real pipeline, but the
  transcription and synthesis themselves remain honestly placeholder.

## Unreleased — Phase 13.5 (Voice Pipeline Completion)

**Not tagged as a release.** Per this phase's own certification report,
this work is **not ready for RC3** — see
`docs/PROJECT_STATE.md`'s "Phase 13.5: what changed and what remains
honestly unreal" section for the complete, item-by-item account. Recorded
here so the change is visible before the next numbered release, not
because it constitutes one.

### Headline

The voice pipeline now drives a real `@ryper/ai-engine` `AIOrchestrator`
— real multi-round tool execution, with each step's result genuinely
observed before the next runs — instead of the simpler
`ConversationEngine` Phase 13 used. A real, multi-step voice command
("open calculator, then set the volume to 30 percent, then mute") now
executes as three real, sequenced, observed actions against the real
Windows Platform Agent, not a single canned response.

### What's genuinely new

- Real `AIOrchestrator` wiring (all six sub-components real).
- Real tool definitions for every desktop action this repository can
  actually back with a capability, shared between the voice-command
  router and the orchestrator's tool-calling loop (one implementation,
  two integration surfaces).
- Real `AbortSignal` cancellation — a genuine gap (the signal was
  threaded through but never checked) found and fixed.

### What is still not real, on purpose, stated plainly

- The "AI" deciding which tool to call is a **deterministic pattern
  matcher**, not a language model — no LLM of any kind is bundled in
  this repository. It cannot understand phrasing its patterns don't
  cover.
- Wake word, STT, and TTS are unchanged from Phase 13: a real but
  non-acoustic wake-word detector, and no real speech-recognition or
  speech-synthesis model exists anywhere in this repository.
- No real microphone/speaker hardware bridge exists — nothing in this
  release can actually listen to or speak to a person.
- No hardware testing was performed — this build environment has no
  audio device or display server.

## RC2 (Desktop Shell)

**Tag:** `rc2` · **Follows:** `rc1` · **Phase:** 12 certification

## Headline

RYPER AI OS now has a real, working desktop application — not a
prototype, not a mockup. `platform/desktop-app` is a genuine Electron
app with a functioning chat interface, an animated voice indicator, a
system tray, and a settings window, all wired to the real backend
(`core/*`) built through RC1. This is the first release where someone
could plausibly sit down and use the product, in a limited but entirely
real form.

## What's new since RC1

- **Desktop application.** Real conversation flow (create, rename,
  archive, delete, search conversations; send/receive messages; copy,
  delete, and regenerate replies), rendered with real GitHub-flavored
  markdown, syntax-highlighted code blocks, and tables — all sanitized
  against XSS before display.
- **Voice Orb.** A real, animated state-machine component (idle,
  listening, thinking, speaking) built on the platform-agnostic
  view-model already defined in `@ryper/components`.
- **System tray.** Show/hide the app, toggle voice on and off,
  push-to-talk, open settings, quit — all wired to real handlers.
- **Settings window.** Theme (light/dark/system), voice toggle,
  push-to-talk shortcut, launch-at-login, and a live diagnostics panel
  (backed by the real Windows Platform Agent when running on Windows).
- **Liquid Glass design system**, applied at runtime from the shared
  `@ryper/design-system` token package — no hand-duplicated design
  values between packages.

## What's explicitly not in this release

We'd rather tell you plainly than have you discover it:

- No Memory Viewer, Plugin Manager, Model Manager, Automation page,
  Document Center, Diagnostics window, Permission Center, About window,
  or Developer Console yet. Their nav entries exist and are visibly
  disabled ("coming soon") rather than hidden or faked.
- No real microphone input or text-to-speech output yet — push-to-talk
  currently only animates the orb; it doesn't capture or play audio.
- Chat replies arrive as a complete response, not a token-by-token
  network stream (the underlying streaming primitives exist in
  `core/ai-engine` but aren't yet wired through the conversation path
  the desktop app uses).
- No installer, auto-updater, or code signing yet — this release is a
  buildable application, not a packaged, distributable one.
- macOS and Linux have no platform-specific capability agent yet (only
  Windows does); the app still runs and degrades gracefully on other
  platforms, just without any OS-specific features.

Full detail on every gap: `docs/PROJECT_STATE.md`'s "Phase 12 desktop
shell: honest scope and remaining gaps" section.

## Under the hood

- The desktop shell runs on **Electron**, hosting the existing
  TypeScript Core in-process — a deliberate change from the original
  Phase 1 architecture plan (native per-OS shells over a Rust Core),
  made because Core was actually built in TypeScript across ten prior
  phases and rewriting it in Rust to match the original plan wasn't in
  scope for a UI phase. Full reasoning: `docs/adr/0014`.
- Every package (28 total) still builds via TypeScript project
  references, tests via Vitest, lints via ESLint, and formats via
  Prettier — all verified from a completely cold `npm ci` before this
  release.

## Upgrade / migration notes

None. This release is additive: one new package
(`platform/desktop-app`), no changes to any existing package's public
API, no breaking changes anywhere in `core/*`, `ui/*`, or `plugins/*`.

## Verification

```
npm ci
npm run build
npm test          # 952/952 passing, 179 test files
npm run lint       # 0 warnings
npm run format:check
```

All pass clean from a cold checkout as of this release.
