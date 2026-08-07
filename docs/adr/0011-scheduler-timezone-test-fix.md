# ADR 0011: Fix the Scheduler's timezone-dependent test assertion, not its (correct) local-time implementation

**Status:** Accepted (Phase 11.5)

## Problem

`core/planner/test/scheduler.test.ts`'s `"arms a job and reports the next
run time"` test failed non-deterministically depending on the host
machine's configured timezone. On a host whose local timezone is UTC
(e.g. most CI containers, including this repo's default sandbox), it
passed; on any other timezone (verified: `America/Los_Angeles`,
`Asia/Kolkata`, `Pacific/Apia`, `Pacific/Kiritimati`,
`Pacific/Marquesas`), it failed.

## Root Cause

The test asserted:

```ts
expect(handle.nextRunAt).toContain("T07:00");
```

`handle.nextRunAt` is produced by `computeNextRun(...).toISOString()`.
`Date.prototype.toISOString()` **always renders UTC**, regardless of the
host's local timezone. The assertion implicitly assumed the host's local
timezone offset from UTC is zero — true only by coincidence on a UTC
host, false everywhere else.

This is _not_ a bug in `computeNextRun` or in `ScheduleSpec.atTime`.
`ScheduleSpec.atTime` is documented, on purpose, as **local** time (`/**
24h "HH:MM" local time... */` in `types.ts`) — "remind me daily at 7am"
is a request for 7am in the caller's own timezone, not 7am UTC, which is
the only sensible behavior for a scheduling feature a voice assistant
exposes to a human. `computeNextRun`'s use of local-time `Date` methods
(`setHours`, `getDate`, `getDay`, ...) correctly implements that
contract, and does so consistently on any single host regardless of that
host's configured timezone, because both its input (`from`) and its
arithmetic run in the same timezone.

## Decision

Fix the test, not the implementation:

```ts
const nextRun = new Date(handle.nextRunAt);
expect(nextRun.getHours()).toBe(7);
expect(nextRun.getMinutes()).toBe(0);
```

Parsing `nextRunAt` back into a `Date` and reading local getters checks
the same local wall-clock instant `computeNextRun` produced — `new
Date(isoString)` correctly reconstructs the absolute instant regardless
of timezone, and `getHours()`/`getMinutes()` on it read the local
wall-clock hour/minute on whatever host runs the test, which is exactly
what was scheduled. This is deterministic and cross-platform because it
validates the same local-time contract the implementation promises,
rather than assuming a specific UTC offset.

`computeNextRun` and `ScheduleSpec.atTime` were both left unchanged, and
both now carry an explicit doc comment recording this local-time
contract and warning against re-introducing a UTC-string-matching
assertion (see `scheduler.ts`).

## Alternatives Considered

- **Rewrite `computeNextRun` to operate in UTC** (`setUTCHours`,
  `getUTCDate`, `getUTCDay`, ...). Rejected: this would silently
  reinterpret every `atTime` as a UTC time instead of the user's local
  time, which is a behavior change for real users (a redesign of a
  working, correctly-specified feature) — the exact kind of change this
  stabilization phase's brief prohibits ("Do NOT redesign the
  architecture... Do NOT change public APIs unless absolutely
  necessary"). It would also have been a strictly worse fix for the
  stated symptom: the test would still need to change either way, and
  UTC-only scheduling is arguably wrong product behavior, not just an
  implementation detail.
- **Pin `TZ=UTC` in the test runner / CI config** so the existing
  assertion always happens to pass. Rejected: this hides the
  non-determinism rather than fixing it — the brief explicitly says
  "the timezone implementation must be deterministic and cross-platform,"
  and a test that only passes under one specific forced `TZ` value is
  the opposite of that. It also does nothing for a real user running
  this scheduler outside of CI, whose Windows/macOS/Linux machine will
  virtually never be configured to `TZ=UTC`.

## Tradeoffs

None of substance — the fix is strictly a bug fix. `nextRunAt`'s public
contract (an ISO-8601 UTC-rendered string) is unchanged; a consumer that
already round-trips it through `new Date(...)` to compare or display it
sees no behavior change at all. Only the _test's own_ assertion style
changed.

## Migration Impact

None. No public API, type, or runtime behavior changed — only
`core/planner/test/scheduler.test.ts`'s one assertion and doc comments in
`core/planner/src/scheduler.ts`. Verified deterministic by running the
full repo test suite (908 tests) under both the default UTC sandbox
timezone and `TZ=Pacific/Marquesas` (UTC−09:30, a timezone chosen to
maximize the chance of exposing any remaining off-by-offset or
half-hour-boundary issues) — both runs are 908/908 passing with no other
timezone-sensitive failures found anywhere else in the repository.
