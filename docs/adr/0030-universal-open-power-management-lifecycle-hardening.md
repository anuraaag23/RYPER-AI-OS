# ADR 0030: Universal open capability, browser resolution, OS power management, STT/TTS lifecycle hardening

**Status:** Accepted (Tier 1 implementation-only pass — testing/certification intentionally deferred, see the note at the end)

## Context

This pass's brief named five real, previously-open Windows Tier-1 gaps:
universal open (URL/file/folder), real per-browser resolution (fixing
the `chrome → edge` bug), OS power management (shutdown/restart/sleep)
with a real confirmation boundary, an STT/TTS lifecycle hardening
audit, and documentation reconciliation. This ADR covers all five.

## Decision

### 1. Universal open capability

Three real Windows-agent modules, all wired into `WindowsAdapter`
(`application_control` domain):

- **`browser-resolver.ts`** — `BrowserResolver`, real multi-tier
  discovery for Edge/Chrome/Firefox/Brave: (1) the existing
  `listInstalledApplications()` infra, (2) the real Windows "App Paths"
  registry key (`HKLM` then `HKCU`), (3) known install-location probing
  (both Program Files variants, `%LOCALAPPDATA%` for per-user
  installs) via `listDirectory`. Never substitutes a different browser
  than the one asked for — a genuinely-not-installed browser reports
  `BrowserNotInstalledError`.
- **`path-resolver.ts`** — `PathResolver`: quote stripping, a narrow
  and honestly-scoped `%USERPROFILE%` expansion (the only environment
  variable resolvable without real `process.env` access, which this
  package's `WindowsSystemApi` abstraction deliberately doesn't expose
  — any other `%VARIABLE%` reports a clear
  `UnresolvedEnvironmentVariableError` rather than guessing), and
  known-folder name resolution ("my downloads folder" →
  `getWellKnownFolderPath("downloads")`). Also exports `looksLikeUrl`/
  `normalizeUrl` — a deliberately conservative, real domain-shape check
  (not a heuristic an LLM decides), used by `smart_open`.
- **`WindowsAdapter.smartOpen()`** — the brief's single higher-level
  dispatcher: classifies a target as URL (via `looksLikeUrl`) or
  file/folder (verified against the _real_ filesystem — tries
  `listDirectory` first, falls through to `openFile` on failure, whose
  own real "no file here" error is the honest final answer if the
  target is neither). Never an LLM guess.
- New `WindowsSystemApi.openFolder()`, backed by real `explorer.exe`
  (`PowerShellWindowsSystemApi`) / directory-existence validation
  (`InMemoryWindowsSystemApi`).
- `ApplicationManager.openUrl(url, browserId?)` — omitting `browserId`
  is the pre-existing default-browser behavior, unchanged; supplying
  one resolves via `BrowserResolver` and launches that exact browser's
  executable with the URL as its argument (`startProcess`, the
  existing safe, `execFile`-style primitive — no shell string building).
  `ApplicationManager.launchBrowser(browserId)` covers "open Chrome"
  with no target site, a genuinely different real operation from
  `openUrl` (which always needs a URL to hand the browser).

### 2. The real `chrome → edge` bug, and how "open X" actually gets classified

`desktop-actions.ts`'s `KNOWN_APP_IDS` table literally mapped
`chrome: "microsoft.edge"` — removed. No browser name is in that table
anymore; `resolveBrowserId()` (in `browser-resolver.ts`) is the one,
real source of truth for browser names.

**A real architectural constraint discovered while wiring the fast
voice-command path**: `DEFAULT_INTENT_PATTERNS`'s `open_application`
pattern (`/^open (?<app>.+)$/i`) is checked first (in both
`VoiceCommandRouter`'s fast path and `HeuristicToolCallingProvider`'s
own matching) and matches _any_ "open ..." phrase — meaning a dedicated
`open_url`/`open_file`/`open_folder` voice pattern that also starts
with "open" could never actually be reached; `open_application`'s own
handler would always win first. Rather than fight this ordering,
`desktopActions.openApplication()` itself became the real classifier
for every "open ..." phrase that isn't a known app or a known browser
standalone:

1. Peel off a trailing "... in `<browser>`" suffix, if present
   (`splitTargetAndBrowser` — "YouTube in Chrome" → target `"YouTube"`,
   browser `"chrome"`).
2. Known app → `application_control.launch` (unchanged, pre-existing).
3. Known browser name, no explicit browser suffix → `launchBrowser`.
4. A small, explicit, well-known-website-name table
   (`KNOWN_WEBSITE_ALIASES` — `youtube`, `google`, `github`, etc.; the
   brief's own literal examples, not general knowledge) → `open_url`.
5. Otherwise, the real `smart_open` classification — covers
   "open my Downloads folder" and "open C:\...\file.pdf" through this
   same handler, verified against the real filesystem.

Separately, a genuinely pre-existing, previously-_dead_ intent
(`DEFAULT_INTENT_PATTERNS`'s `open_website`, matching a real
domain-shaped pattern like "open github.com" or "go to github.com")
had **zero registered handler anywhere in the codebase** before this
pass — completely unreachable. Renamed to `open_url` to match the real
tool now registered for it (both `VoiceCommandRouter` and
`HeuristicToolCallingProvider` key off the intent name directly, so it
had to match the tool/handler name to be reachable through either
path), and gave it a real handler. This is not a regression of any
previously-working behavior — none existed for this intent before.

`open_folder`'s own dedicated voice pattern ("show me `<folder>`")
deliberately excludes a bare "this"/"that" ("Show me this folder") —
resolving _that_ phrasing needs a notion of "the folder currently being
discussed," which no context-tracking mechanism exists anywhere in this
voice pipeline. Documented as a real, known, out-of-scope limitation
rather than resolved to a fabricated, wrong path.

### 3. OS power management

New `power_management` capability domain (`shutdown`, `restart`,
`sleep`), plus a new `system.power` entry in `@ryper/security`'s
`Capability` union (`"protected"` sensitivity). `PowerManager`
(`power-manager.ts`) is the single real gate every one of these three
operations passes through — reusing the _existing_
`DestructiveActionGate` (the same one `FileManager.delete()` already
relies on), not a second confirmation mechanism. Real,
zero-interpolation PowerShell commands back the real implementation;
the in-memory reference implementation honestly cannot power off the
process it's running inside of, so it records the request rather than
fabricating a stronger claim (see `core/windows-agent/README.md`).

**Cancellation race, closed explicitly**: `PowerManager`'s `gated()`
helper checks the caller's `AbortSignal` both _before_ and
_immediately after_ `DestructiveActionGate.require()` resolves. A
confirmer that takes real wall-clock time (a UI dialog, a voice
confirmation) gives a genuine window for a cancellation to arrive while
it's still pending; without the second check, a "yes" that arrives
after the cancellation would still have executed the real,
irreversible operation.

### 4. STT/TTS lifecycle audit

Most of the scenarios the brief lists (microphone/speaker unavailable,
STT/TTS provider-selection failure, cancellation, provider playback
failure) were already handled honestly — `MicrophoneManager`,
`SpeakerManager`, and both registries' `select()` already throw clear,
real errors rather than swallowing them, and those errors already
propagate correctly to `runTurn()`'s catch block.

**One real, serious, previously-undiscovered bug found and fixed**:
that catch block correctly transitions the session to `error`/
`cancelled` on failure (as of ADR 0028's fix), but _nothing_ ever
transitioned it back to `idle` afterward. Since `transition("listening")`
— the very first thing every `runTurn()` call does — is only valid
_from_ `"idle"`, **every voice turn after the very first failure would
throw `InvalidVoiceSessionTransitionError` immediately**, permanently
breaking the pipeline until the whole process restarted. This is the
exact opposite of the brief's "subsequent turns can retry" requirement,
and is a more serious version of the same family of bug ADR 0028 found
(a real transition silently never firing). Fixed in both
`AudioPipelineManager.runTurn()` and `VoicePipeline.runTurn()`: if the
session is parked in `error`/`cancelled` when a new turn begins, it's
reset to `idle` first — preserving the failed turn's own terminal state
as its true, observable history (a UI reading state mid-failure still
saw `error`/`cancelled`) while guaranteeing the next turn can actually
start.

### 5. Documentation reconciliation

The top-level `README.md` described the real llama.cpp LLM provider as
"replacing the deterministic pattern-matcher placeholder" — inaccurate;
`HeuristicToolCallingProvider` remains registered, always, as the
honest last-resort fallback whenever no real local/cloud LLM is
actually reachable (`platform/desktop-app/electron/ai-orchestrator-bootstrap.ts`'s
own doc comment already described this correctly — only the top-level
README was stale). Corrected. `platform/desktop-app/README.md` was
already accurate and needed no change.
`core/windows-agent/README.md` updated with the new `power_management`
domain, the universal-open capability, and honest limitation notes for
`BrowserResolver`'s untested-on-real-hardware discovery tiers.

## Consequences

- Real per-browser opening now works as specified — no browser is ever
  silently substituted for another.
- Real OS power actions exist, gated the same way the one other
  pre-existing destructive action (file deletion) already is — no new
  authorization model invented.
- The session-recovery bug fix is the single highest-value change in
  this pass: without it, the entire voice pipeline was one failed turn
  away from being completely unusable until restart, for _any_ real
  cause of failure (STT error, TTS error, AI Engine error, device
  disconnect) — a severity the original lifecycle-hardening ask likely
  didn't anticipate finding.

## What this does not do (honest scope — PART 18)

- **Hibernate** was explicitly scoped out by the brief and is not
  implemented.
- **No UI exists** for the power-management confirmation step — per the
  brief's own instruction ("do not invent a UI if the existing
  consent/confirmation architecture is not ready... document any
  intentionally deferred UI piece"), the real, typed capability and the
  real `DestructiveActionGate` authorization boundary are fully
  implemented and denies by default; a platform shell wiring a real,
  UI-backed `DestructiveActionConfirmer` (the same interface
  `FileManager.delete()` already expects one for) is a future,
  separate integration task, not a missing capability.
- **`BrowserResolver`'s registry/candidate-path discovery is real but
  unverified against actual Windows hardware** — same honest caveat
  every `PowerShellWindowsSystemApi` method in this package already
  carries (see `core/windows-agent/README.md`'s "Honest Limitations").
- **The STT/TTS audit was real but not claimed exhaustive** — this pass
  found and fixed the one serious bug described above; it did not
  attempt to enumerate every conceivable provider-specific failure mode
  (e.g. a specific cloud STT vendor's rate-limit response shape).
- **"Show me this folder" (a bare demonstrative, no named target)**
  cannot be resolved without a "currently referenced item" context
  mechanism that doesn't exist anywhere in this voice pipeline — same
  real limitation as "open this image" from an earlier phase. Not
  solved here; documented, not faked.

## Testing

Testing intentionally deferred to the next phase, per this phase's
explicit instructions. A targeted `tsc --build` compile check (not a
full lint/test/format/package certification) was run after each
implementation batch purely as a development aid to catch type errors
early — no test suite, lint, or format check was run, and nothing in
this document should be read as a certification claim. Tier 1 is not
declared complete by this ADR.
