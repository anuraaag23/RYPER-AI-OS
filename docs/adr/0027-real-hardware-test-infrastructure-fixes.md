# ADR 0027: Real-hardware test infrastructure fixes — Edge resolution and fail-fast preflight diagnostics

**Status:** Accepted (Phase 13.15, media-control test infrastructure)

## Context

A real run of `media-control-capability.real.test.ts` on real Windows
hardware, with the llama-server env vars independently confirmed set
and correct, surfaced two real, separate infrastructure problems — not
a RYPER implementation failure:

1. `bootstrapAIOrchestrator()` reported `llmDiagnostics.status ===
"binary-missing"` despite `RYPER_LLAMA_SERVER_BINARY`/
   `RYPER_LLAMA_MODEL` being set correctly in the same shell used to
   invoke Vitest.
2. The Edge-launching fixture's `Start-Process -FilePath 'msedge.exe'`
   failed with "The system cannot find the file specified."

The user independently investigated further and confirmed: the
llama-server binary and model files genuinely exist at the configured
paths; the env vars are genuinely set; `Get-Command msedge.exe`
returns nothing; neither standard `Program Files` Edge location
exists; and, ultimately, **no browser at all** (Edge, Chrome, Firefox,
Brave) is discoverable on this specific test machine.

## Investigation: comparing against the already-working real tests

`defaultLlamaServerPaths()` (`llm-model-provisioning.ts`) — the
function that reads `RYPER_LLAMA_SERVER_BINARY`/`RYPER_LLAMA_MODEL` —
is shared, unmodified, identical code across every real test file in
this repository (`llm-runtime.real.test.ts`, `tool-calling.real.test.ts`,
`audio-capability.real.test.ts`, `media-control-capability.real.test.ts`).
There is no separate or different "resolution path" in
`media-control-capability.real.test.ts` to have diverged — confirmed
by direct inspection, not assumed. This rules out a code-level bug
specific to this file as the explanation for problem 1.

## Decision: fail-fast preflight rather than a guessed fix

Since the shared resolution code is provably identical, and the actual
runtime cause of problem 1 (whatever is preventing this specific
Vitest process from seeing the env vars — most plausibly a worker-pool
isolation difference, e.g. not using `--pool=forks
--poolOptions.forks.singleFork`, or a session/shell mismatch) cannot be
verified without running on the real machine, this ADR does not claim
to fix a root cause it cannot confirm. Instead, `buildHarness()` now
runs `realHardwareLlamaPreflight()`
(`platform/desktop-app/test/support/real-hardware-preflight.ts`)
first: it reads and logs the exact `RYPER_LLAMA_SERVER_BINARY`/
`RYPER_LLAMA_MODEL` values this specific process sees, and fails
immediately — in milliseconds, not ~90 seconds — with a precise,
actionable message if either is missing or doesn't point to a real
file, naming the most likely real causes. This turns an ambiguous,
slow, downstream failure into an immediate, diagnostic one, which is
the responsible fix when the actual cause can't be confirmed remotely.

## Decision: correcting a wrong assumption about Edge resolution

Problem 2's root cause **was** confirmed directly: the original
`media-session-fixture-launcher.ts` doc comment claimed
`Start-Process -FilePath 'msedge.exe'` would resolve via Windows' "App
Paths" registry redirection. **That assumption was wrong.**
`Start-Process` calls .NET's `Process.Start()`, which only searches
the current directory and `PATH` — App Paths redirection is a
`ShellExecuteEx`-level mechanism (Explorer, the `start` verb, the Run
dialog), never consulted by direct process creation. This would have
failed identically on any machine where Edge is installed but not on
`PATH` (a common, unremarkable case), independent of whether Edge is
present at all on this particular machine.

Fixed with `resolveEdgeExecutable()`
(`media-session-fixture-launcher.ts`), checked in order:

1. **`RYPER_EDGE_BINARY`** — an explicit override, verified against
   the real filesystem before use, for a machine where Edge is
   installed somewhere non-standard.
2. **A real registry read** of the App Paths key
   (`Get-ItemProperty 'HKLM:\...\App Paths\msedge.exe'`) — the correct
   way to use this mechanism (a real registry query, not an assumption
   about process-launch behavior).
3. **The two standard install locations**
   (`Program Files`/`Program Files (x86)`).
4. **A real `Get-Command msedge.exe`** `PATH` lookup, as a last resort.

If none succeed, `resolveEdgeExecutable()` throws a clear, explicit
error: _"This is a TEST-ENVIRONMENT PREREQUISITE, not a RYPER
implementation failure."_ `launchMediaSessionFixture()` now always
passes the _resolved_ path to `Start-Process -FilePath`, never a bare
`'msedge.exe'`. A new `realHardwareEdgePreflight()` calls this and
logs the resolved path/method before any launch is attempted, so a
missing-browser environment fails immediately rather than after
`bootstrapAIOrchestrator()` and the LLM preflight have already run.

## Decision: no browser substitution

Per explicit instruction, this ADR does **not** substitute Chrome,
Firefox, or Brave for Edge, even though none of the four are present
on the confirmed test machine. This fixture's physical verification
specifically depends on Chromium/Edge's `MediaSession`-to-SMTC
integration (`docs/adr/0026`); a different browser engine's exact
behavior here has not been investigated or proven equivalent, and
substituting one without that investigation would be introducing an
unverified assumption into a test whose entire purpose is to avoid
unverified assumptions. If Chrome support is wanted in the future,
that is a real, separate decision requiring its own investigation and
documentation — not a silent fallback.

## Consequences

- On the confirmed test machine (no browser installed at all), the new
  preflight will report a precise, honest
  `"Microsoft Edge executable not found... this is a TEST-ENVIRONMENT
PREREQUISITE"` error rather than the previous confusing "cannot find
  the file specified" from a bare, unresolved `Start-Process` call.
  Per the user's explicit instruction, the four media-control physical
  capabilities remain **NOT VERIFIED** on this machine until a real
  browser is available — this ADR does not, and cannot, manufacture a
  passing physical result out of a genuinely absent prerequisite.
- The two existing, environment-dependent tests in
  `media-control-capability.real.test.ts` (docs/adr/0025, which check
  whatever media session happens to already be active, with no
  dependency on Edge/the fixture at all) are unaffected by this ADR
  and remain a real, independent way to physically verify media
  control if the machine has some other media application open.
- `mediaControl()`, `media_play`/`media_pause`/`media_next`/
  `media_previous`, and every other piece of production media-control
  code were **not modified** by this ADR — every change here is test
  infrastructure only, per explicit instruction that no production
  media-control failure has been established.
- Whether the llama-server preflight's diagnostic message actually
  reveals the true cause of problem 1 (worker-pool isolation, shell
  mismatch, or something else) is the explicit next thing to observe
  on the user's next real run — not yet confirmed as of this document.
