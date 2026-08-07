# ADR 0013: Explicit `exports` maps on every workspace package for RC1, `"files"`/`"module"` deliberately omitted

**Status:** Accepted (Release Candidate 1)

## Problem

Every one of the 27 workspace packages relied solely on `main`/`types`
for module resolution. This works — verified repeatedly through Phases
10, 11, 11.5, 11.6, and 11.7 — but it's "implicit" resolution in the
sense RC1's brief means: `main`/`types` is Node's legacy resolution
algorithm, is agnostic to what specific entry a given tool or condition
(ESM import vs. a hypothetical future CJS `require`, type-checking vs.
runtime, ...) actually wants, and doesn't explicitly declare a package's
public surface. RC1 asks for "a production-quality exports map... Do not
leave any package relying on implicit resolution."

## Decision

Every package's `package.json` now has an explicit `exports` map:

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  "./package.json": "./package.json"
}
```

- **`"types"` listed first** — required by TypeScript's own
  `resolvePackageJsonExports`, which expects the `types` condition
  earliest in each conditional block.
- **Only an `"import"` condition, no `"require"`** — every package is
  `"type": "module"` and `tsc --build` (with `module`/`moduleResolution:
"NodeNext"` in `tsconfig.base.json`) only ever emits `.js` ESM output;
  there is no `.cjs` build anywhere in this repository. Adding a
  `"require"` condition pointing at a file that doesn't exist would be
  actively wrong, not just unnecessary.
- **`"."` only, no deep-import subpaths** — verified first, not assumed:
  a repo-wide grep found zero imports of the shape `@ryper/<name>/<path>`
  anywhere in any package's `src/` or `test/` (every import already goes
  through the package's barrel). Restricting `exports` to `"."` therefore
  matches existing usage exactly and additionally _enforces_ "every
  package exports only its public API" (a requirement named in the
  Phase 11.7 brief) — a deep import that bypassed a package's `index.ts`
  barrel would now fail to resolve at all, which is the intended
  behavior for a package boundary.
- **`"./package.json"` exposed** — standard practice; tooling that reads
  a dependency's own `package.json` at runtime (version checks,
  `require.resolve`, etc.) keeps working.
- **`main`/`types` were kept, not removed**, as a fallback for any tool
  that doesn't understand `exports` (older Node, certain older bundlers).
  Every modern resolver (Node ≥12.7, TypeScript's `NodeNext`, Vite)
  prefers `exports` over `main` when both are present, so this is
  free insurance, not a competing source of truth.

`vitest.config.ts`'s `resolve.alias` (Phase 11.7, `docs/adr/0012`) is
unaffected: Vite resolves an aliased specifier before it ever consults
the target package's `package.json`, so the new `exports` maps and the
zero-`dist/`-required alias resolution work together, not in tension —
verified by running the full suite with the alias active and zero
`dist/` output (908/908), and separately with the alias temporarily
disabled to force real `exports`-map resolution against a real build
(908/908, proving the maps are correct on their own merits, not merely
accepted by `tsc`).

## What was deliberately NOT added

- **`"files"`** — controls what `npm publish` includes in a package's
  tarball. Every one of the 27 packages is `"private": true` and cannot
  be published at all; a `"files"` field on a package that can never be
  published is dead configuration with zero observable effect. Adding it
  would be cargo-culting a field for a use case that doesn't exist in
  this repository, not fixing anything.
- **`"module"`** — a legacy, non-standard field some older bundlers
  (early Rollup/webpack) used to find an ESM entry point before the
  `exports` map exists as a standard mechanism for exactly that. Since
  every package now has a proper `exports` map with an `"import"`
  condition — the modern, standardized replacement — adding `"module"`
  as well would be redundant, and could invite drift between the two if
  ever hand-edited independently in the future.
- **`"peerDependencies"`** — already confirmed absent and unnecessary in
  Phase 11.6's audit (no package in this internal, non-plugin-consuming
  monorepo has a peer relationship to declare); nothing changed here to
  revisit that finding.

## Verification

Full pipeline run clean, twice: once immediately after adding the
`exports` maps, and once again after a completely fresh `npm ci` (to
confirm the `package.json` edits didn't perturb the lockfile — they
don't, since `exports` isn't a dependency-resolution field). Both runs:
`npm run build` 0 errors, `npm test` 908/908, `npm run lint` 0
warnings, `npm run format:check` clean. Additionally: every `exports`
map target file verified to exist on disk after a real build (27/27,
0 problems), and the full suite verified passing via genuine
`package.json` `exports` resolution alone (Vitest alias temporarily
disabled) as well as via the Phase 11.7 alias with zero `dist/` output —
both paths now work, for different, complementary reasons.

## Alternatives Considered

- **Leave `main`/`types` as the only resolution mechanism.** This is
  what RC1's brief explicitly asked to move past ("do not leave any
  package relying on implicit resolution"), and is strictly less capable
  than an explicit `exports` map (no way to declare conditional exports,
  no way to restrict deep imports to enforce a public API boundary).
- **Add `"require"` conditions with a real CommonJS build.** Rejected:
  this repository has never produced CJS output at any phase, would
  require adding a second `tsc` output target to all 27 packages'
  `tsconfig.json`/build scripts, and nothing in this repository or its
  consumers needs CJS — the closest thing to a "redesign" this RC1 phase
  explicitly prohibits.

## Migration Impact

None for any existing import in this repository (verified: zero deep
imports existed to break). A future package consumer gets stricter,
more explicit resolution — attempting a deep import that used to work
only by accident (falling through `main`'s directory) would now
correctly fail fast instead of silently reaching into a package's
internals.
