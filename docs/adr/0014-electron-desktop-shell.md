# ADR 0014: Phase 12 desktop shell is Electron + TypeScript, deviating from `docs/ARCHITECTURE.md` §20's native-shells-over-Electron / Rust-Core plan

**Status:** Accepted (Phase 12) — a deliberate, documented deviation, not an oversight

## Context

`docs/ARCHITECTURE.md` is this project's Phase 1 design document. Its §20
("Technology Selection") explicitly chose **native per-OS shells (WinUI/
Win32, AppKit, GTK/Qt) over Electron**, talking to a **Rust (or C++) Core**
over gRPC/IPC, specifically to avoid Electron's overhead. `platform/
desktop/{windows,macos,linux}` contain scaffolds matching that plan: a
WinUI 3 `.csproj`, a Swift Package Manager manifest, and a GTK4 Rust
`Cargo.toml` — each an intentionally minimal placeholder (a few lines, a
`main` that only prints a scaffold message), each explicitly documented
in its own README as unbuildable in this sandbox (no Xcode, no Windows
SDK/MSVC, no GTK4 dev headers here) and, more importantly, **never
integrated with anything** — they predate, and were never updated
alongside, every phase of actual Core implementation.

That actual implementation — every phase from Phase 1 (per `docs/
PROJECT_STATE.md`) through RC1 — built Core as a **TypeScript/Node.js**
monorepo (`core/*`, 27 packages: `@ryper/ai-engine`, `@ryper/planner`,
`@ryper/memory`, `@ryper/memory-system`, `@ryper/conversation`,
`@ryper/voice-engine`, `@ryper/tool-framework`, `@ryper/platform-
capability`, `@ryper/windows-agent`, `@ryper/security`, `@ryper/plugin-
platform`, `@ryper/sync`, `@ryper/telemetry`, ...), not Rust. No Rust
Core exists anywhere in this repository. §14's own roadmap says "each
phase ends with... an update to \[the architecture] document if reality
diverges from design" — that update never happened; this ADR is that
update, for the desktop-shell decision specifically.

Phase 12's own brief is explicit and specific, and takes precedence for
_this_ decision: "CURRENT STATE: RC1 has already been completed. The
repository already contains: AI Engine, Planner, Memory System, Voice
Engine, Conversation Engine, Local Runtime, Plugin Platform, Tool
Framework, Windows Agent, Platform Capability Layer, Security, Logging,
Documents, Synchronization... DO NOT rebuild or replace these systems.
Integrate them" and "Choose the best production desktop framework
already compatible with the repository." Every one of those named
systems is a TypeScript package.

## Decision

The Phase 12 desktop shell (`platform/desktop-app`, `@ryper/desktop-app`)
is built with **Electron**, hosting Core **in-process** in Electron's
main process (a real Node.js process) — not gRPC to a separate Core
process, and not native WinUI/AppKit/GTK4.

This directly contradicts §20's stated preference. The deviation is
deliberate, for reasons that only became fully clear once RC1's actual
package graph existed to evaluate against:

1. **Rewriting Core in Rust to match §20 is not "integrating existing
   systems" — it is rebuilding them**, which this phase's own brief
   explicitly forbids ("DO NOT rebuild or replace these systems"). A
   Rust rewrite of 27 packages' worth of tested, RC1-certified business
   logic is a multi-phase undertaking on its own, not something a
   desktop-shell phase can or should absorb as a prerequisite.
2. **None of the three native toolchains are usable in this build
   environment** — confirmed by each shell's own pre-existing README
   (no Xcode, no Windows SDK/MSVC/WinUI workload, no GTK4 dev headers or
   Rust toolchain here). Building real native UI code this phase would
   be exactly the "honestly non-functional here, real code for a real
   machine to build" pattern already established for `core/windows-
agent`'s `PowerShellWindowsSystemApi` — except ×3 (Swift, C#, Rust),
   with no way to verify any of the three even compiles, let alone
   renders or wires up correctly to Core, from this sandbox. That
   tradeoff is acceptable for one well-scoped, already-isolated
   production API (`PowerShellWindowsSystemApi`); it is not an
   acceptable foundation for "the first fully usable desktop
   application," which this phase's brief demands be genuinely usable
   and non-mocked.
3. **Electron's main process is a real Node.js process**, so it can
   `import` `@ryper/ai-engine`, `@ryper/planner`, `@ryper/conversation`,
   `@ryper/memory`, `@ryper/voice-engine`, `@ryper/platform-capability`,
   `@ryper/windows-agent`, and every other Core package **directly, with
   zero serialization boundary** — not mocked, not stubbed, not proxied
   through a gRPC contract that doesn't exist yet. This is a strictly
   _more_ direct integration with the real, existing Core than the
   original gRPC-to-a-separate-process plan would have given even a
   perfectly executed native shell.
4. `docs/ARCHITECTURE.md` §4.1 itself allows "in-process" Core
   integration explicitly for some shells ("gRPC / IPC (desktop) or
   in-process (mobile/web)") — Electron's main-process architecture is a
   defensible extension of that same in-process principle to desktop,
   given Core's real implementation language.

## What is preserved from the original architecture

- **Core remains platform-agnostic business logic, called by a thin
  shell** — the Electron main process is the same thin
  orchestration/OS-bridging role §4.2 assigns to shells ("shells contain
  no business logic, only presentation + OS bridging"); all real logic
  still lives in `core/*`.
- **The `platform/desktop/{windows,macos,linux}` native scaffolds are
  left in place, untouched** — not deleted, not repurposed. If a future
  phase pursues native shells (e.g., once/if Core migrates toward Rust,
  or via FFI/N-API bindings into the existing TS Core, or a real gRPC
  server wrapping it), those scaffolds are exactly where that work
  starts. This ADR does not foreclose that path — it documents why
  Phase 12 does not take it.
- **The Liquid Glass design language, window/navigation model, and
  every UI requirement in Phase 12's brief are implemented as designed**
  — the deviation is the underlying framework/IPC mechanism, not the
  product experience.

## Alternatives Considered

- **Tauri** (Rust shell + system webview + a sidecar Node process for
  Core, communicating over local IPC). Rejected: still requires a Rust
  toolchain this sandbox doesn't have for the shell half, and still
  needs an IPC/serialization boundary to reach the real TypeScript
  Core — strictly more complexity than Electron's in-process model for
  no corresponding benefit, given Core's actual language.
- **Write a real gRPC server in the existing Node Core and a minimal
  native client for one OS only (e.g., Windows, per §14's original
  Phase 1 sequencing: "Desktop shell (one OS first)")**. Considered
  seriously — it's closer to the original design and reuses more of the
  existing `platform/desktop/windows` scaffold. Rejected for this phase
  because it still cannot be compiled or verified at all in this
  sandbox (no Windows SDK/WinUI workload here), which would mean
  shipping unverified native UI code as "the first fully usable desktop
  application" — a claim this phase's own success criteria (`Desktop
application launches successfully`, `No placeholder UI`) require to
  be true, not aspirational.
- **Build only a web-based UI** (extending `platform/web`, no desktop
  packaging at all). Rejected: Phase 12 explicitly asks for a desktop
  application (tray icon, native window chrome, OS-level integration
  points like the Windows Agent) that a browser tab cannot provide.

## Tradeoffs

- Electron ships a bundled Chromium + Node runtime, which is heavier
  than a native shell — exactly the overhead §20 named as its reason to
  avoid Electron. This is a real, acknowledged cost, accepted here in
  exchange for a genuinely working, genuinely-integrated-with-real-Core
  application being deliverable and verifiable _at all_ in this phase,
  versus three unverifiable native stubs.
- The eventual multi-OS-native-shell vision in §20/§14 is not advanced
  by this phase. It remains open technical debt, recorded in `docs/
PROJECT_STATE.md`'s known-gaps list, not silently abandoned.

## Migration Impact

None for `core/*` — every Core package is consumed via its existing
public API (`@ryper/*` imports), unmodified. `platform/desktop/{windows,
macos,linux}` are untouched. The new `platform/desktop-app` package is
additive.
