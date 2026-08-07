# ADR 0012: Vitest resolves `@ryper/*` packages via a generated `resolve.alias` to source, not `dist`

**Status:** Accepted (Phase 11.7)

## Problem

Running `vitest run` against a test file that imports a workspace
package (e.g. `core/windows-agent/test/integration.test.ts`, which
transitively imports `@ryper/planner`, `@ryper/security`,
`@ryper/tool-framework`, `@ryper/platform-capability`, and more) failed
before a single test ran, whenever the target package(s) hadn't already
been built:

```
Error: Failed to resolve entry for package "@ryper/planner". The package
may have incorrect main/module/exports specified in its package.json.
  Plugin: vite:import-analysis
```

This reproduced reliably from a clean checkout (`npm ci` with no prior
`npm run build`), and would equally hit any CI configuration that runs
`build` and `test` as separate/parallel jobs, or a contributor running
`npm test` inside a single package directory without first building the
whole workspace.

## Root Cause

Every `@ryper/*` package's `package.json` sets `"main":
"./dist/index.js"` and `"types": "./dist/index.d.ts"` — correct for a
real consumer, and for `tsc --build`'s own project-reference graph,
_after_ `tsc --build` has produced `dist/`. But Vite's module resolution
(the `vite:import-analysis` plugin Vitest uses to transform test files
and everything they import) performs ordinary Node-style `package.json`
resolution against the filesystem **at test-collection time** — it has
no awareness of `tsc --build`'s project-reference graph, build order, or
even that a build step exists. If `dist/index.js` doesn't exist yet for
a given package, Vite cannot resolve it, full stop, regardless of
whether that package's TypeScript source is perfectly valid.

Every prior stabilization phase's verification passed 908/908 because it
always ran `npm run build` immediately before `npm test` (matching the
`ci` script's `format:check && lint && build && test` order) — which
masked this gap rather than closing it.

## Decision

`vitest.config.ts` now sets `resolve.alias`, mapping every `@ryper/<name>`
import straight to that package's TypeScript source entry
(`<packageDir>/src/index.ts`) instead of letting Vite fall through to
Node/`package.json` resolution. Vitest already transforms `.ts` test
files on the fly via esbuild; this makes it transform the workspace
packages they import the same way, so test execution no longer depends
on `dist/` existing at all.

The alias map is **generated**, not hand-maintained: `vitest.config.ts`
walks `core/*`, `ui/*`, `plugins/*`, `plugins/examples/*`, `platform/*`,
and `infra/*` at config-load time, reads each `package.json`'s `name`
field (skipping any directory without both a `package.json` and a
`src/index.ts` — e.g. `platform/desktop`, which has neither), and builds
`{ "@ryper/<name>": "<dir>/src/index.ts" }` from that. Adding a new
workspace package with a `src/index.ts` requires no `vitest.config.ts`
change; the alias map can't drift out of sync with the real package set
the way a hand-typed list could.

No package's `main`/`types`/`exports` fields changed — they remain
correctly `dist`-pointing for real consumers (a future publish step, or
another tool that isn't Vitest). No source code changed. No public API
changed.

## Alternatives Considered

- **Always run `npm run build` before `npm test` and document that as a
  hard requirement.** This is what already worked, and is still true —
  the `ci` script still builds before testing. Rejected as the _only_
  fix because it doesn't satisfy "every package can be imported
  independently" / "every package resolves ... during ... Testing"
  (a requirement repeated across the Phase 10, 11, 11.5, and 11.6
  briefs) and remains one misordered CI step or one `cd
core/some-package && npm test` away from the exact failure this ADR
  fixes. It's also strictly slower for local iteration: a change to one
  package's `src/` would otherwise require rebuilding it (and
  `tsc --build`'s dependents, transitively) before its tests would even
  start.
- **Give every package `"exports"` field pointing at conditional
  source/dist entries** (a `"development"` condition, etc.) and teach
  Vite to prefer it. Rejected: this is real scope creep for what's
  otherwise a Vitest-only problem — Node's own resolution, `tsc
--build`, and npm's workspace symlinks all already resolve every
  package correctly today; only Vite/Vitest's resolution is the gap.
  Adding `exports` maps to all 27 packages' `package.json` files to fix
  a Vitest-only issue would be a much larger, riskier surface (`exports`
  restricts deep-import patterns some tooling might rely on) for the
  same outcome `resolve.alias` achieves with a single, test-tooling-only
  config change.
- **A hand-written alias list in `vitest.config.ts`.** Rejected in favor
  of generating it from each package's own `package.json` — a
  hand-written list is exactly the kind of hardcoded-path drift risk
  this stabilization track has been trying to eliminate (see Phase
  11.5's audit of `tsconfig.json` reference lists for the same class of
  problem), and would need a manual edit every time a package is added,
  renamed, or removed.

## Tradeoffs

Tests now exercise a package's TypeScript source directly, transformed
by esbuild, rather than its compiled `dist/` output. This is the same
tradeoff essentially every TS/Vitest monorepo makes (testing source, not
build output) and was already true for the package under test itself
(Vitest never ran compiled `.test.js` files); this ADR just extends the
same treatment to its workspace dependencies. The gap this leaves —
`tsc --build`'s own type-checking, declaration output, and any
build-time-only transform are not exercised by `npm test` alone — is
already covered separately by `npm run build`, which both the `ci`
script and every phase's verification process continues to run.

## Migration Impact

None for any package's public contract. `vitest.config.ts` is the only
file changed. Verified by running the full 908-test suite three ways:
with zero `dist/` output anywhere in the repo (proving the fix), after a
normal `npm run build` (proving no regression to the documented
build→test flow), and via `npm run lint`/`npm run format:check` (both
still clean, including on `vitest.config.ts` itself, which
`tsconfig.eslint.json`'s root-level `"*.ts"` include already covered
before this change).
