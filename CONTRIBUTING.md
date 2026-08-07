# Contributing to RYPER AI OS

## Before you start

The Phase 1 architecture (`docs/ARCHITECTURE.md`) is the approved source of
truth. Changes that contradict it (new cross-cutting dependencies between
`core/*` modules, new capabilities that bypass `@ryper/security`, etc.)
need an update to that document first, in its own PR.

## Coding standards

- **Strict typing everywhere.** No `any`. `noUnusedLocals`,
  `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` are on in
  `tsconfig.base.json` — work with them, don't suppress them.
- **No placeholder implementations.** Every exported function must do what
  its name says; if a capability isn't ready yet, don't merge a stub that
  silently returns fake data — leave the feature unimplemented and tracked
  in an issue instead.
- **100% public API documentation.** Every exported type/function gets a
  doc comment explaining _why_, not just _what_ — see any file under
  `core/*/src` for the expected style.
- **`core/*` never imports from `platform/*` or `ui/*`.** Dependencies flow
  one direction: platform/ui → core, never the reverse.
- **Every module ships tests with it.** A PR that adds an exported function
  without a corresponding `test/*.test.ts` case will not pass CI review,
  even if `npm test` happens to stay green.

## Workflow

1. `npm install`
2. Make your change inside the relevant workspace package(s).
3. `npm run format` then `npm run lint` — fix everything before opening a PR.
4. `npm run build` — must succeed with zero TypeScript errors.
5. `npm test` — must be green; add tests for new behavior.
6. Open a PR. CI (`.github/workflows/ci.yml`) re-runs all of the above on
   Node 20.x and 22.x, plus CodeQL.

## Commit style

Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
`chore:`) — this keeps `release.yml`'s auto-generated release notes useful.
