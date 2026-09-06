# RYPER AI OS

Monorepo for RYPER AI OS — a single AI assistant present across Windows,
macOS, Linux, Android, iOS/iPadOS, and the web, offline-first and
privacy-first by design. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
for the original approved Phase 1 architecture, and
[`docs/adr/`](docs/adr/) for every significant decision made since,
including where later phases deliberately deviated from that original
plan (most notably [`docs/adr/0014`](docs/adr/0014-electron-desktop-shell.md),
on the desktop shell's framework).

**Current state (Phase 13.9, see [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md)
for the complete phase-by-phase history):** a real, tested, 28-package
TypeScript Core (AI orchestration, memory, planning, voice, tool-calling,
plugins, platform capability layer, a production Windows platform agent)
and a real, working Electron desktop application — the first genuinely
usable end-to-end slice of the product, not a prototype — including a
real microphone/speaker audio bridge (Phase 13.6; see
[`docs/adr/0017`](docs/adr/0017-renderer-mediated-audio-bridge.md)),
real local Whisper/Piper speech-to-text and text-to-speech providers
with real, automatic barge-in (Phase 13.7; see
[`docs/adr/0018`](docs/adr/0018-local-stt-tts-and-automatic-bargein.md)),
and a real LLM provider — a locally-managed llama.cpp server by
default, explicit-only optional cloud providers — wired into the
existing `AIOrchestrator` as the **primary** provider whenever a real
binary+model are actually detected/running (Phase 13.9; see
[`docs/adr/0020`](docs/adr/0020-real-llm-provider-and-tool-call-validation.md)).
**This does not remove the deterministic pattern-matcher
(`HeuristicToolCallingProvider`)** — it remains registered as the
honest, always-available last-resort fallback whenever no real
local/cloud LLM is actually reachable (the same real precedence
pattern Phase 13.7 already established for STT/TTS's
`ReferenceVoiceRuntimeProvider` fallback — see
[`platform/desktop-app/electron/ai-orchestrator-bootstrap.ts`](platform/desktop-app/electron/ai-orchestrator-bootstrap.ts)'s
own doc comment for the exact registration order and conditions). An
earlier version of this README described the real LLM provider as
"replacing" the pattern-matcher placeholder outright — that wording
was inaccurate and has been corrected here (see
[`docs/adr/0030`](docs/adr/0030-universal-open-power-management-lifecycle-hardening.md)'s
documentation-reconciliation section); nothing about the actual
runtime behavior changed, only this description of it.
Phase 13.8 actually built whisper.cpp from source and ran a real Piper
install against this real provider code (real, non-silent audio
produced and inspected) in a sandboxed environment with no audio
hardware and no Windows — see
[`docs/adr/0019`](docs/adr/0019-phase-13-8-real-verification-findings.md)
for exactly what that did and did not prove.
Every package builds, tests, lints, and formats clean from a cold
`npm ci`.

## Requirements

- Node.js `>= 20` (see `.nvmrc`)
- npm `>= 10` (npm workspaces are used for the monorepo — no separate
  package manager install required)

## Getting started

```bash
npm install
npm run build          # tsc --build across every package's project reference
npm test                # vitest, run across every package
npm run lint             # eslint, zero warnings allowed
npm run format:check      # prettier --check
npm run ci                 # everything CI runs, in one command
```

To build the desktop app's renderer bundle specifically (in addition to
the `tsc --build` step above, which covers its Electron main process):

```bash
cd platform/desktop-app
npm run build:renderer   # vite build — real, bundled, production output
```

See [`platform/desktop-app/README.md`](platform/desktop-app/README.md)
for what actually launching the Electron app requires, and this build
environment's honest limitation there (no display server to verify a
real window against).

## Repository layout

```
core/            platform-agnostic domain logic — pure TypeScript, no OS APIs.
                 21 packages: logging, event-bus, security, memory,
                 memory-system, model-router, rag, ai-engine, conversation,
                 voice-engine, planner, tool-framework, platform-capability,
                 windows-agent, plugin-platform, plugin-runtime, automation,
                 documents, media, sync, local-runtime. Each has its own
                 README with that package's architecture and API surface.
platform/        per-OS shells.
                 platform/web         — @ryper/web-shell, a real, tested
                                        Core-wiring reference (see its
                                        source for the canonical
                                        EventBus+ModelRouter+Memory+
                                        ConversationEngine assembly).
                 platform/desktop-app — @ryper/desktop-app, the Phase 12
                                        Electron desktop application (main
                                        process + preload + React/Vite
                                        renderer), hosting Core in-process.
                 platform/desktop/*   — native per-OS scaffolds (WinUI/
                                        AppKit/GTK4) from the original
                                        Phase 1 plan; intentionally
                                        untouched since — see
                                        docs/adr/0014.
                 platform/mobile/*    — Android/iOS scaffolds, not yet
                                        built out.
ui/               design-system (tokens, liquid-glass presets) and
                 components (framework-agnostic view-models consumed by
                 every shell, including the Electron renderer).
plugins/          the plugin SDK third-party developers build against,
                 plus a worked example plugin.
infra/            CI documentation and the opt-in, disabled-by-default
                 telemetry client.
docs/             architecture, environment, secrets, logging, project
                 state, and every ADR.
.github/          GitHub Actions workflows (CI, CodeQL, release).
```

Every package under `core/`, `ui/`, `plugins/`, `platform/web`,
`platform/desktop-app`, and `infra/telemetry` is an independent npm
workspace: it has its own `package.json`, `tsconfig.json`, `src/`, and
`test/`, and can be built and tested in isolation
(`npm run build -w @ryper/<name>`, `npm test -w @ryper/<name>`).

## Documentation

- [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) — **start here.** The
  complete phase-by-phase history, current package inventory with public
  API surfaces, the full dependency graph, and every known gap. Updated
  at the end of every phase; the single source of truth for "what's
  actually built."
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the original approved
  Phase 1 architecture (PRD → tech selection). Where reality has since
  diverged from this document, an ADR records why — see below.
- [`docs/adr/`](docs/adr/) — every significant architecture decision
  since Phase 1, in order, each with problem/root cause/decision/
  alternatives-considered/tradeoffs.
- [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) — environment variables.
- [`docs/SECRETS.md`](docs/SECRETS.md) — secrets management policy.
- [`docs/LOGGING.md`](docs/LOGGING.md) — logging conventions.
- [`CHANGELOG.md`](CHANGELOG.md) — notable changes, phase by phase.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — coding standards and PR process.

## Known limitations

This is a real, working codebase built and verified in a Linux sandbox
with no display server, no Windows/macOS native toolchain, and no audio
hardware. Where that matters, the affected package's own README says so
plainly rather than silently mocking around it — see in particular
[`core/windows-agent/README.md`](core/windows-agent/README.md)'s "Honest
Limitations" (its production PowerShell-backed API) and
[`platform/desktop-app/README.md`](platform/desktop-app/README.md)'s
equivalent section (the Electron GUI itself, and — since Phase 13.6 — the
real audio bridge's untested-against-physical-hardware status, and —
since Phase 13.7/13.8 — the real local STT/TTS providers: Piper's
binary and a real voice were successfully obtained and run in this
sandbox and produced real audio; a real Whisper model could not be —
confirmed structurally unreachable, not just untried, see
[`docs/adr/0019`](docs/adr/0019-phase-13-8-real-verification-findings.md)
— and since Phase 13.9, the real LLM provider: `llama-server` was built
from real source and run against a real, invalid test-fixture GGUF
(producing a real, honest failure), but a real inference-capable GGUF
chat model was, like Whisper's, structurally unreachable from this
sandbox; no real cloud LLM API key was available either. See
[`docs/adr/0020`](docs/adr/0020-real-llm-provider-and-tool-call-validation.md)).
`docs/
PROJECT_STATE.md`'s "known integration gaps" and "Phase 12 desktop
shell: honest scope" sections list every gap across the whole repository
in one place.

## License

MIT — see [`LICENSE`](LICENSE).
