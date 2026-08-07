# RYPER AI OS

Monorepo for RYPER AI OS — a single AI assistant present across Windows,
macOS, Linux, Android, iOS/iPadOS, and the web, offline-first and
privacy-first by design. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
for the full approved Phase 1 architecture (source of truth — do not
redesign without updating that document first).

This repository is the Phase 2 foundation: workspace layout, tooling, and a
real, tested, compiling TypeScript Core + web shell. Native desktop/mobile
shells are scaffolded with complete, valid native project files but are not
build-verified here, since this environment has no Windows/Xcode/Android
toolchain — see each `platform/*/README.md` for details and next steps.

## Requirements

- Node.js `>= 20` (see `.nvmrc`)
- npm `>= 10` (npm workspaces are used for the monorepo — no separate
  package manager install required)

## Getting started

```bash
npm install
npm run build       # tsc --build across every package's project reference
npm test             # vitest, run across every package
npm run lint          # eslint, zero warnings allowed
npm run format:check  # prettier --check
npm run ci             # everything CI runs, in one command
```

## Repository layout

```
core/        platform-agnostic domain logic (conversation, memory, model
             routing, RAG, plugins, automation, documents, media, security,
             sync, event bus, logging) — pure TypeScript, no OS APIs.
             core/ai-engine is the Core AI Engine (Phase 3): the
             orchestrator every future module talks to — see
             core/ai-engine/README.md. core/local-runtime is the Local AI
             Runtime & Model Management system (Phase 4) — see
             core/local-runtime/README.md. core/memory-system is the
             Memory System (Phase 5) — see core/memory-system/README.md.
             core/voice-engine is the Voice Engine & Audio Platform
             (Phase 6) — see core/voice-engine/README.md.
platform/    per-OS shells. platform/web is a real, tested TS package;
             desktop/mobile are native-toolchain scaffolds (see their
             READMEs).
ui/          design-system (tokens, liquid-glass presets) and components
             (framework-agnostic view-models consumed by native UIs).
plugins/     the plugin SDK third-party developers build against, plus a
             worked example plugin.
infra/       CI documentation and the opt-in, disabled-by-default telemetry
             client.
docs/        architecture, environment, secrets, and logging documentation.
.github/     GitHub Actions workflows (CI, CodeQL, release).
```

Every package under `core/`, `ui/`, `plugins/`, `platform/web`, and
`infra/telemetry` is an independent npm workspace: it has its own
`package.json`, `tsconfig.json`, `src/`, and `test/`, and can be built and
tested in isolation (`npm run build -w @ryper/<name>`,
`npm test -w @ryper/<name>`).

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the approved Phase 1
  architecture (PRD → tech selection). Single source of truth.
- [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) — environment variables.
- [`docs/SECRETS.md`](docs/SECRETS.md) — secrets management policy.
- [`docs/LOGGING.md`](docs/LOGGING.md) — logging conventions.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — coding standards and PR process.

## License

MIT — see [`LICENSE`](LICENSE).
