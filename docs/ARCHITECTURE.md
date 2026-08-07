# RYPER AI OS — Phase 1 Architecture

**Status:** Pre-implementation design. No application code in this phase, per project rules.
**Scope:** PRD → Roadmap, as specified. Each section is written to be independently reviewable and independently testable once implementation begins.

---

## 1. Product Requirements Document (PRD)

**Vision:** One assistant, one continuity of context, present natively on Windows, macOS, Linux, Android, iOS/iPadOS, and the web — choosing local or cloud inference per-task without ever making cloud mandatory.

**Primary user problems solved:**

- Assistants today reset context per device and per app.
- "Do it for me" tasks (files, docs, images, home automation) require leaving the chat.
- Privacy-conscious users have no assistant that is offline-capable by default.

**Target users:** power users and prosumers first (dev tools, automation, document work), enterprise/privacy-sensitive teams second (offline mode, audit logs, plugin sandboxing), casual users third (voice, smart home, quick tasks).

**Out of scope for v1:** general-purpose autonomous computer-use agents that click arbitrarily inside third-party apps without an explicit user-approved automation recipe; anything that bypasses OS/app permission models (see Security Architecture — this is a hard constraint, not a v1-only one).

**Success metrics:** cross-device context continuity rate, % of tasks completed fully offline, plugin marketplace adoption, p50/p95 assistant response latency (local vs. cloud), crash-free session rate.

---

## 2. Functional Requirements

| Domain       | Must have (v1)                                                 | Should have (v2)                               | Could have (later)                                           |
| ------------ | -------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| Conversation | Streaming chat, tool calling, RAG over local KB                | Multi-agent orchestration                      | Fully autonomous multi-app workflows                         |
| Memory       | Short-term + long-term + preferences, encrypted, user-editable | Knowledge graph, episodic memory               | Cross-user shared team memory                                |
| Voice        | Wake word (where OS allows), STT/TTS streaming, interruption   | Voice cloning (opt-in)                         | Real-time translation in voice calls                         |
| Desktop      | File ops, clipboard, screenshot, terminal integration          | Window management, mouse/keyboard automation   | Full RPA-style automation                                    |
| Mobile       | Widgets, notifications, offline AI, Shortcuts (iOS)            | Live Activities, quick settings tile (Android) | Background wake word on iOS (not possible — see constraints) |
| Documents    | PDF/DOCX/XLSX/PPTX read, OCR, summarize, chat-with-doc         | Merge/split/watermark/forms                    | E-signature workflows                                        |
| Images       | Background removal, upscaling, OCR, batch edit                 | Generative fill (cloud)                        | Local generative diffusion                                   |
| Automation   | Visual IF/THEN builder, file/calendar/schedule triggers        | Smart-home scenes                              | Cross-plugin composite workflows                             |
| Plugins      | Sandboxed SDK, permissioned, signed                            | Marketplace, hot reload                        | Revenue sharing / billing                                    |
| Sync         | Opt-in encrypted cross-device conversation sync                | Selective sync (per-project)                   | Peer-to-peer sync without cloud relay                        |

Each row must ship with its own test plan before merge (see §17).

---

## 3. Non-Functional Requirements

- **Privacy-first:** local inference is the default path; any request that would leave the device (web search, cloud model, cloud sync) is either user-configured in advance or confirmed at point of use. No silent egress.
- **Performance targets:** cold start < 2s desktop / < 1.5s mobile; local LLM first-token latency < 800ms on reference hardware (defined in §Technology Selection); UI at 60fps including glass/blur effects, degrading gracefully on integrated GPUs.
- **Reliability:** offline core features (wake word, STT/TTS, local LLM, file ops, document/image tools) must have zero hard dependency on network reachability.
- **Security:** least privilege by default; every plugin and OS-level capability (mic, camera, filesystem, accessibility APIs) is opt-in per capability, not blanket.
- **Portability:** shared business logic (memory, RAG, orchestration, plugin protocol) lives in a platform-agnostic core; only I/O, OS integration, and rendering are platform-specific.
- **Accessibility:** WCAG 2.2 AA for all first-party UI; full keyboard navigation; reduced-motion mode disables the liquid-glass displacement/parallax and physics animations without removing functionality.
- **Compliance:** platform policies are hard constraints, not suggestions — e.g., no attempt to run persistent background wake-word listening on iOS beyond what Apple's APIs permit, no accessibility-API abuse for automation on any platform.

---

## 4. Architecture

### 4.1 High-level shape

RYPER is a **microkernel + plugin architecture** with a platform-agnostic **Core** and thin **Platform Shells**.

```
┌─────────────────────────────────────────────────────────────┐
│                        Platform Shells                       │
│  Windows | macOS | Linux | Android | iOS | Web               │
│  (native UI, OS integration, sensors, permissions)            │
└───────────────────────────┬───────────────────────────────────┘
                            │  gRPC / IPC (desktop) or in-process (mobile/web)
┌───────────────────────────▼───────────────────────────────────┐
│                          RYPER Core (shared)                  │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────┐  │
│  │ Conversation│ │  Memory   │ │  Model    │ │  Plugin       │  │
│  │  Engine    │ │  System   │ │  Router   │ │  Runtime      │  │
│  └───────────┘ └───────────┘ └───────────┘ └───────────────┘  │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────┐  │
│  │  RAG /     │ │  Event    │ │  Security │ │  Sync Engine  │  │
│  │  Vector KB │ │  Bus      │ │  / Sandbox│ │  (CRDT-based) │  │
│  └───────────┘ └───────────┘ └───────────┘ └───────────────┘  │
└───────────────────────────┬───────────────────────────────────┘
                            │
┌───────────────────────────▼───────────────────────────────────┐
│                     Model Backends                            │
│  Local runtime (llama.cpp/GGUF, ONNX, CoreML, NNAPI)           │
│  Cloud API (Anthropic API, pluggable providers)                │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Principles applied

- **Clean Architecture / DDD:** Core is organized into bounded contexts (Conversation, Memory, Automation, Documents, Media, Plugins), each with its own domain model, independent of transport or platform.
- **CQRS where it earns its cost:** memory writes (episodic/long-term) and reads (semantic retrieval) are split, since read patterns (ranked semantic search) and write patterns (append + periodic consolidation) differ enough to justify separate models. Not applied to simple settings/preferences.
- **Event-driven:** the Event Bus is the backbone for automation ("IF new PDF appears") and for cross-module reactions (memory consolidation triggered by conversation-end events) without tight coupling.
- **Repository pattern** isolates storage engines (SQLite/SQLCipher, vector store) behind interfaces so encryption or storage engine can change without touching domain logic.
- **MVVM/MVI** on each platform shell for UI, kept deliberately thin — shells contain no business logic, only presentation + OS bridging.

### 4.3 Model routing

The Model Router is a first-class Core component, not a UI toggle. Its inputs: connectivity state, battery/thermal state (mobile/desktop), declared privacy sensitivity of the request (from a lightweight on-device classifier, not from trusting free text), required capability (e.g., "needs web search" ⇒ cloud), and explicit user preference/override. Routing decisions are logged (locally, user-visible) so behavior is never a black box.

---

## 5. Folder Structure

```
ryper/
├── core/                      # platform-agnostic, no OS APIs
│   ├── conversation/
│   ├── memory/
│   │   ├── short_term/
│   │   ├── long_term/
│   │   └── knowledge_graph/
│   ├── model_router/
│   ├── rag/
│   ├── plugin_runtime/
│   ├── automation/
│   ├── documents/
│   ├── media/                 # image/video/audio engines
│   ├── security/
│   ├── sync/
│   └── event_bus/
├── platform/
│   ├── desktop/                # shared desktop shell logic
│   │   ├── windows/
│   │   ├── macos/
│   │   └── linux/
│   ├── mobile/
│   │   ├── android/
│   │   └── ios/
│   └── web/
├── ui/
│   ├── design-system/          # tokens, liquid-glass integration, motion
│   └── components/
├── plugins/
│   ├── sdk/
│   └── examples/
├── infra/
│   ├── ci/
│   └── telemetry/              # opt-in only, documented in Security
└── docs/
```

Rule: nothing under `core/` may import from `platform/` or `ui/`. Enforced via lint rule + CI check, not convention alone.

---

## 6. Module Design

Each Core module exposes a narrow interface and is independently testable/compilable:

- **Conversation Engine** — turn management, streaming, tool-call orchestration, context-window budget management (works with Memory's compression).
- **Memory System** — see §12.
- **Model Router** — see §4.3; pluggable provider interface (`ModelProvider`) so local/cloud backends are swappable.
- **RAG/Vector KB** — embedding pipeline, chunking, hybrid (keyword + vector) retrieval, source attribution.
- **Plugin Runtime** — see §11.
- **Automation Engine** — trigger registry, condition evaluator, action executor, all mediated through the Event Bus so triggers never call OS APIs directly (that's the platform shell's job, invoked via a permissioned action interface).
- **Documents/Media Engines** — stateless transform pipelines (input file/stream → output file/stream), each transform independently unit-testable with fixture files.
- **Security/Sandbox** — permission broker; every module and plugin call to an OS capability routes through here.
- **Sync Engine** — CRDT-based conversation/state sync so multi-device edits merge without a central write-lock; end-to-end encrypted, opt-in.

---

## 7. API Contracts

Core-to-shell and plugin-to-core communication uses a versioned schema (protobuf for desktop IPC/gRPC; equivalent typed contracts in-process on mobile/web). Representative contracts:

```protobuf
service ConversationService {
  rpc SendMessage(MessageRequest) returns (stream MessageChunk);
  rpc GetHistory(HistoryRequest) returns (HistoryResponse);
}

message MessageRequest {
  string conversation_id = 1;
  string content = 2;
  RoutingHint routing_hint = 3;   // user override: LOCAL_ONLY | CLOUD_OK | AUTO
}

service PluginHost {
  rpc RequestCapability(CapabilityRequest) returns (CapabilityGrant);
  rpc InvokeAction(ActionRequest) returns (ActionResult);
  rpc SubscribeEvents(EventFilter) returns (stream Event);
}

message CapabilityRequest {
  string plugin_id = 1;
  Capability capability = 2;      // FILESYSTEM_READ, MIC, CAMERA, NETWORK, ...
  string justification = 3;       // shown to user in the consent prompt
}
```

All contracts are additive-only post-v1 (no breaking field reuse), versioned via a `schema_version` field, validated in CI against stored golden schemas.

---

## 8. Database Schema (representative, local-first)

```sql
-- Encrypted at rest via SQLCipher; keys from platform secure storage (see §9)

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  device_origin TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id),
  role TEXT CHECK(role IN ('user','assistant','tool')),
  content TEXT,
  routing_used TEXT,          -- 'local' | 'cloud'
  created_at INTEGER
);

CREATE TABLE memory_items (
  id TEXT PRIMARY KEY,
  category TEXT,              -- preference | project | contact | fact | task
  content TEXT,
  importance REAL,
  embedding BLOB,              -- vector, indexed via companion vector store
  source_conversation_id TEXT,
  expires_at INTEGER NULL,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE plugins (
  id TEXT PRIMARY KEY,
  name TEXT,
  version TEXT,
  signature TEXT,
  granted_capabilities TEXT,   -- JSON array
  installed_at INTEGER
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT,                  -- 'user' | plugin_id | 'system'
  action TEXT,
  capability TEXT,
  result TEXT,
  created_at INTEGER
);
```

Vector embeddings for `memory_items` and the RAG document store live in a companion vector index (see Technology Selection) referenced by id, not duplicated across engines.

---

## 9. Security Architecture

- **Secrets:** never hardcoded; pulled from OS-native secure storage (Windows DPAPI/Credential Manager, macOS/iOS Keychain, Linux Secret Service, Android Keystore).
- **Encryption at rest:** SQLCipher (or platform equivalent) for the local DB; per-device keys, never transmitted in plaintext even during sync (sync payloads are end-to-end encrypted, server/relay is zero-knowledge).
- **Permission model:** capability-based, per-plugin, per-use justification shown to the user (see API Contracts §7); revocable at any time; a permission dashboard lists every grant and last-used timestamp.
- **Plugin sandboxing:** plugins run in an isolated runtime (separate process on desktop, restricted WebView/JS sandbox pattern where applicable) with no ambient authority — every OS capability call is mediated by the Security/Sandbox broker, never called directly.
- **Signing:** plugins and app updates are signed; unsigned plugins can only run in an explicit "developer mode" with a persistent warning banner.
- **Biometric support:** used to gate access to the memory viewer and sensitive automations, using each platform's native biometric APIs (no custom biometric handling).
- **Audit log:** append-only, user-visible, covers every capability grant/use and every plugin action.
- **Hard constraint:** RYPER never attempts to circumvent an OS's security or accessibility model (e.g., no undocumented API use to fake "always-on" background listening on iOS, no automation of arbitrary third-party UI via accessibility APIs without an explicit per-recipe user approval).

---

## 10. UI Architecture

**Design language: Premium Liquid Glass.** The uploaded `liquid-glass.js` module is adopted as the reference optics engine for the design system: it renders real edge refraction with chromatic fringe in Chromium-based surfaces (the Windows/Linux/Web shells, and Electron-equivalent surfaces) and automatically falls back to frosted blur elsewhere (Safari-based iOS/macOS WebViews). This maps cleanly onto our multi-platform reality — we treat the refraction as delight, never as a carrier of meaning or state, exactly as the module's own guidance recommends.

**Design system layers:**

- **Tokens:** color, radius, elevation, motion-duration/easing — shared JSON tokens consumed by every platform's native theming layer.
- **Glass component family:** Glass Dock, Floating Assistant panel, Voice Orb, side panels, widget cards — each is "material dressing" (CSS: gradient tint, inset highlights, shadow) around the shared optics module, per the library's own separation of "optics vs. dressing."
- **Native rendering per platform:** on native (non-WebView) surfaces — Win32/WinUI, AppKit, GTK/Qt, Jetpack Compose, SwiftUI — the same visual language is reproduced using each platform's native blur/material APIs (Acrylic/Mica, NSVisualEffectView, SwiftUI `.ultraThinMaterial`, Compose `Modifier.blur` + custom shader where available) rather than embedding a web view, since a full web-rendered glass layer is not appropriate as the primary surface on native platforms — `liquid-glass.js` itself is scoped to real DOM elements in a browser-class renderer.
- **Accessibility:** reduced-motion setting disables displacement/parallax entirely (module fallback path); all glass surfaces maintain a minimum contrast ratio for text regardless of backdrop, per the module's own "keep the interior legible" guidance — enforced via the `border`/`blur` parameters, never by covering interior tint.
- **Responsive layouts:** desktop (multi-pane + dock), tablet (adaptive split), phone (single-pane + bottom sheet), with the same token/component vocabulary throughout.

---

## 11. Plugin System

- **SDK:** typed interface for declaring triggers, actions, and required capabilities; plugins declare capabilities manifest-style (similar to a mobile app manifest) — no runtime capability escalation without a fresh user prompt.
- **Sandboxed runtime:** isolated process/execution context; IPC-only access to Core via the `PluginHost` contract (§7).
- **Marketplace-ready:** versioning, signed packages, staged rollout support, developer verification tier separate from "unverified/dev mode."
- **Hot reload:** supported in development mode only; production installs go through signature verification on every load.
- **Docs:** SDK reference, capability reference, and a sample plugin (file-watcher → summarize → rename → notify, matching the Automation Engine's own example) ship in `plugins/examples/`.

---

## 12. Memory System

- **Short-term (working) memory:** current conversation window, held in-process, subject to context-compression when approaching model context limits (summarize-and-compress, not silent truncation — user can always expand "what got compressed").
- **Long-term memory:** categorized (preference, project, contact, fact, task), each item has importance score, optional expiry, and full user edit/delete rights — memory is never a black box the user can't inspect or prune.
- **Episodic memory:** significant events/sessions summarized and linked to source conversation for traceability.
- **Semantic memory / knowledge graph:** entities and relations extracted from conversations and documents, used to improve retrieval, not to silently profile the user beyond what's needed for the assistant's stated function.
- **Retrieval:** hybrid vector + keyword search with ranking that weighs recency, importance, and relevance.
- **Storage:** encrypted (§9), with a dedicated Memory Viewer UI for search, edit, deletion, and backup/export — memory portability (export to a plain file) is a first-class feature, not an afterthought.

---

## 13. AI Pipeline

```
User input (text/voice/image/doc)
        │
        ▼
Input normalization (STT/OCR/parsing as needed)
        │
        ▼
Privacy/capability classifier ──► Model Router ──► Local model / Cloud model
        │                                              │
        ▼                                              ▼
RAG retrieval (local KB + conversation memory)   Tool calling (plugins,
        │                                         Core modules, web search
        ▼                                         only if cloud-eligible)
Context assembly (compression-aware)
        │
        ▼
Generation (streaming) ──► Response
        │
        ▼
Memory write-back (episodic summary, extracted facts) via Event Bus
```

Multi-agent orchestration (v2+) is layered on top of this pipeline as a planner that decomposes a task into sub-calls through the same Model Router and Tool-calling interface — it does not bypass routing or the capability broker.

---

## 14. Roadmap (phase-by-phase)

- **Phase 0 (this document):** architecture sign-off, schema freeze, API contract freeze.
- **Phase 1:** Core skeleton — Conversation Engine, Model Router (local-only backend first), Memory System (short+long term, no knowledge graph yet), Event Bus. Desktop shell (one OS first, e.g., Windows) as reference implementation.
- **Phase 2:** RAG + document engine (PDF/DOCX first), Security/Sandbox broker, encrypted storage, audit log, Memory Viewer UI.
- **Phase 3:** Plugin Runtime + SDK + one reference plugin (automation example). Second desktop OS (macOS or Linux).
- **Phase 4:** Voice engine (STT/TTS, wake word where OS permits), mobile shell #1 (Android).
- **Phase 5:** iOS shell (widgets/Shortcuts/Live Activities within platform constraints), cross-device sync engine (CRDT, encrypted).
- **Phase 6:** Web shell, image/video/audio engines, smart-home integration.
- **Phase 7:** Multi-agent orchestration, plugin marketplace hardening, knowledge graph.

Each phase ends with: passing unit + integration tests for new modules, a security review of new capability surfaces, and an update to this document if reality diverges from design.

---

## 15. Risk Analysis

| Risk                                                         | Impact                                 | Mitigation                                                                                                                                                 |
| ------------------------------------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS platform restrictions block "always listening" wake word | High (feature gap vs. desktop/Android) | Design lock-screen/voice UX around Siri Shortcuts + Live Activities instead of fighting the platform; document the gap honestly in-product                 |
| Local model quality gap vs. cloud on complex reasoning       | Medium                                 | Model Router transparently offers cloud escalation with a visible reason, never silently degrades quality without telling the user                         |
| Plugin sandbox escape                                        | Critical                               | Process isolation + capability broker + signing; security audit before marketplace launch                                                                  |
| Cross-device sync conflicts                                  | Medium                                 | CRDT-based merge, conflict surfaced to user only when semantically unresolvable (rare)                                                                     |
| Liquid-glass rendering cost on low-end GPUs                  | Low-Medium                             | Size-capped glass surfaces (per module's own guidance: avoid >~800px per side), automatic fallback to static frosted blur under a performance budget check |
| Scope creep given the breadth of this brief                  | High                                   | Strict phase gating (§14); no phase N+1 work starts before phase N tests pass                                                                              |

---

## 16. Deployment Strategy

Desktop: signed installers per OS (MSIX/Windows, notarized .app/macOS, AppImage+deb/rpm for Linux), auto-update via a signed delta-update channel. Mobile: standard store distribution (Play Store, App Store) plus enterprise/sideload channel for privacy-sensitive orgs where the platform allows it. Web: static shell + WASM core where feasible for offline-capable web mode.

## 17. Testing Strategy

Unit tests per Core module (isolated, no OS dependency). Integration tests per platform shell against a mocked Core. End-to-end tests on representative device matrix (low/mid/high-end per platform). Performance benchmarks tied to the NFR targets in §3, run in CI on every merge to `main`. Security-specific test suite for the capability broker (attempt-to-escalate tests, plugin-sandbox-escape tests).

## 18. CI/CD Pipeline

Monorepo with path-based triggers: changes under `core/` run the full cross-platform test matrix; changes scoped to one `platform/*` only run that shell's suite. Every merge to main: lint, type-check, unit tests, schema-compatibility check (§7), security static analysis, and a build of all shells. Release branches require the full device-matrix E2E suite green plus a security sign-off.

## 19. Coding Standards

Strict typing everywhere (TypeScript strict mode / Kotlin / Swift / Rust, per shell). 100% public-API documentation coverage enforced in CI (doc-lint). No `any`/untyped escape hatches in Core. All Core public interfaces require an accompanying unit test before merge — no placeholder or stub implementations pretending to be complete.

## 20. Technology Selection (with rationale)

| Concern                | Choice                                                                                                                                                                               | Why                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop framework      | Native shells per OS (WinUI/Win32, AppKit, GTK/Qt) over Electron                                                                                                                     | Meets the perf/NFR bar and native materials (Mica/Acrylic, NSVisualEffectView) for the glass UI; a shared Rust/C++ Core avoids Electron's overhead |
| Mobile framework       | Native (Jetpack Compose / SwiftUI) over cross-platform UI frameworks                                                                                                                 | Deepest, most compliant access to widgets, Live Activities, Shortcuts, accessibility APIs                                                          |
| Core language          | Rust (or C++ where Rust bindings are impractical)                                                                                                                                    | Memory safety, single Core reusable via FFI across every shell                                                                                     |
| Local AI runtime       | llama.cpp/GGUF (desktop/Linux/Android), Core ML (iOS/macOS), ONNX Runtime as a cross-platform fallback                                                                               | Best-supported, actively maintained, hardware-accelerated on each platform                                                                         |
| Vector DB              | Embedded (e.g., a local HNSW-based store) rather than a server-mode vector DB                                                                                                        | Must work fully offline, per-device                                                                                                                |
| Speech recognition/TTS | Platform-native where excellent (on-device Speech framework on Apple, on-device speech APIs on Android) + a portable open model (e.g., Whisper-class) as the cross-platform baseline | Balances offline quality with consistency across platforms                                                                                         |
| OCR                    | Platform-native OCR APIs (Vision framework, ML Kit) + a portable OCR engine for Windows/Linux                                                                                        | Same rationale as speech                                                                                                                           |
| Sync                   | CRDT library (e.g., Automerge/Yjs-class) over a custom conflict system                                                                                                               | Proven approach for offline-first multi-device merge                                                                                               |
| Auth                   | OAuth2/OIDC for any cloud account linking, platform secure enclave for local secrets                                                                                                 | Standard, auditable                                                                                                                                |
| Packaging/updates      | Per-OS native installer + signed delta updates                                                                                                                                       | Matches each platform's trust model                                                                                                                |

---

_This document is the Phase 1 deliverable. No implementation code is included, per the project's own sequencing rule — the folder structure, API contracts, and schema above are the contract that Phase 1 code will be written against._
