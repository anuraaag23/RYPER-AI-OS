# CI/CD

GitHub Actions workflows live in `.github/workflows/` (GitHub only executes
workflows from that exact path). This folder documents the strategy behind
them.

## Workflows

- **`ci.yml`** — runs on every push/PR to `main`: `npm ci`, Prettier check,
  ESLint, `tsc --build` across all TypeScript project references, then
  `vitest run --coverage`. Runs on Node 20.x and 22.x to catch version
  drift early.
- **`codeql.yml`** — static security analysis of the JS/TS surface, on every
  PR and weekly on a schedule.
- **`release.yml`** — triggered by a `vX.Y.Z` tag; runs the full `npm run ci`
  gate, then drafts a GitHub Release. Native packaging (MSIX, notarized
  `.app`, AppImage, Play Store bundle, App Store build) is deliberately
  **not** included yet — each `platform/*` shell will add its own packaging
  job once that platform's native toolchain is set up in this repo, since it
  needs an OS-specific runner and platform-specific signing secrets.

## Path-scoped test runs (future work once the monorepo grows)

The Phase 1 architecture calls for path-based CI triggers so a change
scoped to one `platform/*` shell doesn't re-run the full cross-platform
matrix. With the current package count, the full suite runs in well under
CI's cache-warm budget, so this hasn't been necessary yet — `ci.yml` is
intentionally the simple, whole-repo version. When per-shell native jobs are
added (Phase "native toolchains"), split triggers using
`on.push.paths`/`on.pull_request.paths` filters per job, so a Swift-only
change doesn't trigger the Android job and vice versa.

## Required secrets (configure in repo/organization settings)

See `../docs/SECRETS.md` for the full policy. CI currently requires no
secrets — `ci.yml` and `codeql.yml` run entirely on public dependencies.
`release.yml` will need signing secrets once native packaging is added.
