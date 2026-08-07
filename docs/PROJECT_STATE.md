# RYPER AI OS — Project State

Last updated: Release Candidate 1 (production readiness, monorepo
finalization & repository certification — explicit `exports` maps added
to every package). This
document is the single place to check what's built, where it lives, and
what its public API looks like, before starting a new phase — update it
at the end of every phase.

## Completed phases

| Phase | Name                                                                                         | Delivered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Architecture                                                                                 | `docs/ARCHITECTURE.md` — PRD through tech selection, the approved source of truth.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2     | Project Foundation                                                                           | Monorepo scaffold: npm workspaces, TypeScript project references, ESLint/Prettier, Vitest, CI/CD (GitHub Actions), the first Core packages (`event-bus`, `logging`, `security`, `model-router`, `memory`, `rag`, `automation`, `documents`, `media`, `sync`, `plugin-runtime`, `conversation`), the plugin SDK + example plugin, `ui/design-system` + `ui/components`, `platform/web`, `infra/telemetry`, native shell scaffolds for desktop/mobile.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 3     | Core AI Engine                                                                               | `core/ai-engine` — the orchestrator every module talks to: provider adapters (OpenAI/Anthropic/Google/local-compatible), tool calling, context/token/prompt management, streaming, error recovery, configuration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 4     | Local AI Runtime & Model Management                                                          | `core/local-runtime` — on-device inference: model registry/discovery/download/verification/versioning/cache/management, runtime adapters (llama.cpp/Ollama/ONNX/MLX), scheduling, health monitoring, capability detection, and the `toAIProvider()` integration point into `core/ai-engine`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 5     | Memory System                                                                                | `core/memory-system` — the permanent brain: 16 memory types, store/index/search/ranking/embeddings, dedup/conflict/compression/expiration, encryption/audit/version history/backup, sync, and the `MemoryManager` facade.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 6     | Voice Engine & Audio Platform                                                                | `core/voice-engine` — wake word, audio device/mic/speaker management, VAD/noise-suppression/echo-cancellation, streaming STT/TTS (local + cloud), the full wake-word → AI Engine → TTS pipeline with cancellation/retry/interruption, voice command routing, settings, diagnostics, local-only analytics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 7     | Agent Planner & Task Orchestration Engine                                                    | `core/planner` — the intelligence layer that turns natural language into executable plans: intent parsing (simple/multi-step/conditional/scheduled/parallel/recursive), goal analysis, abstract task generation across 19 task types, DAG dependency analysis + parallel/sequential execution planning, capability/permission resolution with graceful degradation, retry/recovery, cancellation/progress via the event bus, a scheduler for recurring plans, plan optimization (dedup + transitive dependency reduction), memory-backed defaults/recall, conversational (voice) planning, and dynamic plugin task-type discovery — all behind the stable `PlannerEngine` facade. Never executes a task itself.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 8     | Universal Tool Calling Framework                                                             | `core/tool-framework` — the execution layer between the Agent Planner and every future capability (`User → Planner → Tool Calling Framework → Platform Adapter → Execution`): a tool registry/discovery covering 24 extensible categories, a dependency-free JSON-schema-subset validator, capability/temporary-permission checks via the security broker, an executor running the full validate → permission-check → execute/stream → validate-output → retry pipeline with unified timeout/cancellation, a priority concurrency-limited queue plus a scheduler built on the Planner's clock contract, bounded diagnostics/metrics/logging, plugin tool registration that delegates to `PluginRuntime.invoke()`, memory-backed usage history/favorites/settings, a real `VoiceCommandHandler`, and a bridge that drives an `@ryper/planner` `ExecutionQueue` end-to-end — all behind the stable `ToolManager` facade. Never contains platform-specific code itself.                                                                                                                                                                                                                                                                                                                                                                                                 |
| 9     | Plugin SDK & Extension Platform                                                              | `plugins/sdk` (extended, backward-compatible) + `core/plugin-platform` — the official extension system: a versioned `ExtensionManifest` (dependencies, SDK version range, supported platforms, settings schema) with a manifest/dependency validator, a resource-limited `PluginSandbox`, a full lifecycle state machine (install/load/initialize/enable/disable/suspend/resume/reload/update/uninstall) with per-plugin hooks, a `PluginPermissionManager` (groups + audit trail) layered on the security broker, per-plugin settings/diagnostics/metrics/logging, an 8-category event bridge, a Plugin Store package format with real HMAC signing and version-compatibility/update checks (no online store client), and a `PluginLoader`/`PluginInstaller` that cross-registers a plugin's tools and planner task schemas with the Tool Framework and Planner — all behind the stable `PluginManager` facade. See `docs/adr/0001`–`0005` for this phase's significant design decisions.                                                                                                                                                                                                                                                                                                                                                                           |
| 10    | Platform Capability Layer (PCL)                                                              | `core/platform-capability` (+ small additive extensions to `@ryper/planner` and `@ryper/plugin-sdk`) — the common capability layer everything above it (AI Engine, Planner, Tool Framework, Plugins) must go through instead of ever calling a Windows/Android/iOS/macOS/Linux API directly: an open, extensible `CapabilityDomain` set covering the brief's 40 domains, a stable `PlatformAdapter` contract for the six platforms (Windows/macOS/Linux/Android/iOS/Browser — contracts and registration only, no OS-specific logic yet, per the brief) backed by a real zero-capability `NullPlatformAdapter` fallback, dynamic adapter-driven capability resolution with fallback-alternative suggestions, a full discovery report (supported/unsupported domains, permissions, device info, runtime limitations), permission integration via the security broker, bounded diagnostics/metrics, and Planner/Tool-Framework/Plugin integration bridges — all behind the stable `CapabilityManager` facade. See `docs/adr/0006`–`0008` for this phase's significant design decisions.                                                                                                                                                                                                                                                                                |
| 11    | Windows Platform Agent                                                                       | `core/windows-agent` — the first production implementation of the Platform Capability Layer's `PlatformAdapter` contract: a `WindowsAdapter` (async-constructed to detect the Windows version up front), sixteen manager classes covering every brief-required module (Process/Window/Application/File/Clipboard/Notification/Audio/Display/Device/Permission/Registry/Service managers, an Event Monitor, a Performance Monitor, a Diagnostics Manager, a Windows Version Detector), a single injectable `WindowsSystemApi` seam with a real in-memory reference implementation (default; exercised by every test) and a real PowerShell/WMI-command-building production implementation (honestly non-functional in this sandbox — no native Windows toolchain), Windows 10/11 detection with graceful per-operation degradation, a deny-by-default destructive-action confirmation gate and UAC-elevation gate, a plugin capability-extension registry (add Windows capabilities without touching the core adapter), and full wiring into a real `CapabilityManager`/`PlannerEngine`/`ToolManager` via `bootstrapWindowsPlatformAgent()`/`createPlannerCapabilitySource()`/`createCapabilityTool()` — all behind the stable `WindowsAdapter` + `bootstrapWindowsPlatformAgent()` facade. See `docs/adr/0009`–`0010` for this phase's significant design decisions. |
| 11.5  | Monorepo Integration, Validation & Stabilization                                             | No new package, no new feature, no API change. A full repository-wide audit (dependency graph, circular-dependency check, `tsconfig`/project-reference consistency, `package.json` field/script consistency, workspace-symlink resolution, Vitest glob coverage, `main`/`types` output-path validation) found the monorepo's integration already sound — see "Monorepo integration validation" below for the full report — with exactly one confirmed defect: `core/planner`'s `PlannerScheduler` test suite had a timezone-dependent assertion that only passed when the host machine's local timezone happened to be UTC. Root-caused and fixed (test-only change; the scheduler's local-time semantics were correct all along) — see `docs/adr/0011`. Verified deterministic by running the full 908-test suite under both the default UTC sandbox and `TZ=Pacific/Marquesas` (UTC−09:30).                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 11.6  | Workspace Resolution, Monorepo Linking & Test Infrastructure Stabilization                   | No new package, no new feature, no API/config change — a re-verification pass. Re-ran the full pipeline from a completely cold state (removed every `node_modules`/`dist`/`*.tsbuildinfo`, then `npm ci` — the strict, lockfile-drift-intolerant install mode — followed by `npm run build`, `npm test`, `npm run lint`, `npm run format:check`) plus checks this phase's brief specifically named that Phase 11.5 hadn't already covered: external dependency version-conflict detection across all 27 packages (0 found), `"type"` field (ESM) consistency (all 27 packages uniformly `"module"`), and `peerDependencies` usage (none declared, none needed). Result: 0 module-resolution errors, 0 "failed to resolve entry" errors, 0 broken workspace links, `npm ci` succeeds (proving the lockfile is in sync with every `package.json`), and the full 908-test suite passes with 0 failures — the same clean result Phase 11.5 already established. No code, config, or dependency changes were made; none were justified by any reproducible failure. `exports` map fields remain intentionally unused (all 27 packages resolve via `main`/`types` only, which works correctly for a private, unpublished monorepo — see "Monorepo integration validation" below).                                                                                          |
| 11.7  | Monorepo Stabilization, Package Resolution & Complete Test Recovery                          | Fixed a real, reproduced defect: Vitest could not resolve any `@ryper/*` workspace package (`Failed to resolve entry for package "@ryper/planner"`, via Vite's `vite:import-analysis` plugin) whenever `dist/` hadn't been built yet for that package — a clean checkout, an isolated `npm test` inside one package, or a CI job that runs `build`/`test` as separate steps would all hit this. Root cause: every package's `main`/`types` point at `./dist/...`, which is correct for real consumers and for `tsc --build`'s own project-reference graph, but Vite's own module resolution reads `main` directly off the filesystem with no awareness that a build step exists. Fix: `vitest.config.ts` now sets a `resolve.alias` mapping every `@ryper/<name>` to `<packageDir>/src/index.ts`, generated at config-load time from each package's own `package.json` (not hand-maintained), decoupling Vitest entirely from `dist/`'s existence. No package's `main`/`types`/`exports`, no source code, and no public API changed. Verified by running the full 908-test suite three ways: with zero `dist/` output anywhere in the repo, after a normal `npm run build`, and via `npm run lint`/`npm run format:check` — all clean. See `docs/adr/0012`.                                                                                                          |
| RC1   | Release Candidate 1 — Production Readiness, Monorepo Finalization & Repository Certification | Every one of the 27 workspace packages now has an explicit, production-quality `exports` map (`"."` -> `{ types, import }` + `"./package.json"`), replacing reliance on implicit `main`/`types`-only resolution — `main`/`types` were kept as a fallback, not removed. Verified against zero deep imports anywhere in the repo (so `"."`-only exports break nothing) and against a real, cold `tsc --build` (NodeNext resolution accepts every map; every target file exists on disk post-build). `"files"` and legacy `"module"` fields were deliberately NOT added (dead configuration for `private: true`, never-published packages, and superseded by the new `exports` map, respectively) — see `docs/adr/0013` for the full reasoning. Full certification pipeline (`npm ci` -> `npm run build` -> `npm test` -> `npm run lint` -> `npm run format:check`) passes with zero failures; the Phase 11.7 Vitest alias (zero-`dist/`-required testing) and the new real `exports`-map resolution were verified working both together and independently (alias temporarily disabled to force genuine `exports` resolution: 908/908 still passing). No feature work, no architecture changes, no new modules.                                                                                                                                                         |

Every phase above is build-verified (`npm run build`), test-verified
(`npm test`), lint-clean (`npm run lint`), and format-clean
(`npm run format:check`) as of this document's last update — see each
phase's own package README for narrower detail than this summary.

## Monorepo integration validation (Phase 11.5, re-verified Phase 11.6, fixed Phase 11.7)

A full repository audit was performed before any fix was made, per the
Phase 11.5 brief. Method and results below; treat this as current
through Phase 11.7 and re-verify if the package graph changes
significantly in a later phase.

**Phase 11.6 addendum:** re-ran this validation from a fully cold state
(`node_modules`/`dist`/`*.tsbuildinfo` all removed, then `npm ci` instead
of `npm install` — `npm ci` fails hard on any `package-lock.json` drift,
so its success is itself a lockfile-consistency proof) and additionally
checked, repo-wide: external dependency version conflicts (0 across all
27 packages' `dependencies`/`devDependencies`), `"type"` field
consistency (all 27 packages are uniformly `"type": "module"`), and
`peerDependencies` usage (none declared anywhere, so nothing to
reconcile). All results below still hold; no code or configuration
change was made in Phase 11.6.

**Phase 11.7 addendum:** found and fixed one real defect Phase 11.5/11.6's
checks didn't cover: Vitest (specifically Vite's `vite:import-analysis`
resolution) could not resolve any `@ryper/*` package whenever that
package's `dist/` hadn't been built yet, because `main`/`types` point at
`./dist/...` and Vite resolves that directly against the filesystem with
no knowledge of `tsc --build`'s project-reference graph or ordering.
Fixed via a generated `resolve.alias` in `vitest.config.ts` routing every
`@ryper/*` import to its `src/index.ts` instead — see `docs/adr/0012`
for the full root cause, decision, and alternatives considered. Verified
by running the entire 908-test suite with zero `dist/` output anywhere
in the repo (previously impossible), and again after a normal
`npm run build` (no regression).

### Package/dependency graph

27 workspace packages, 0 circular dependencies, 12 topological layers
(each package only depends on packages in strictly earlier layers):

```
Layer  0: @ryper/design-system, @ryper/logging
Layer  1: @ryper/components, @ryper/documents, @ryper/event-bus, @ryper/media, @ryper/security, @ryper/telemetry
Layer  2: @ryper/automation, @ryper/memory, @ryper/model-router, @ryper/plugin-runtime, @ryper/sync
Layer  3: @ryper/memory-system, @ryper/rag
Layer  4: @ryper/ai-engine, @ryper/conversation
Layer  5: @ryper/local-runtime, @ryper/web-shell
Layer  6: @ryper/voice-engine
Layer  7: @ryper/planner
Layer  8: @ryper/tool-framework
Layer  9: @ryper/plugin-sdk
Layer 10: @ryper/example-plugin, @ryper/platform-capability, @ryper/plugin-platform
Layer 11: @ryper/windows-agent
```

(Generated by resolving each package's `dependencies` field for
`@ryper/*` entries and topologically sorting; `devDependencies`-only
edges, e.g. `@ryper/example-plugin`'s test-only imports of
`@ryper/event-bus`/`@ryper/plugin-runtime`/`@ryper/security`, are
intentionally excluded from this graph — see "Known issues considered
and not fixed" below for why those don't need a `tsconfig.json`
project reference.)

### Workspace validation

- Root `package.json`'s `workspaces` glob and root `tsconfig.json`'s
  `references` list both cover exactly the 27 packages that have a
  `package.json` + `tsconfig.json` — verified programmatically (set
  difference in both directions is empty).
- Every one of the 27 packages has `name`, `version`, `private`,
  `main`, `types`, and both a `build` and `test` script — verified
  programmatically.
- Every workspace package resolves via a real `node_modules/@ryper/*`
  symlink (or nested equivalent for `plugins/examples/*`) — verified
  programmatically; none were missing or broken.

### Build validation

- `npm run build` (`tsc --build tsconfig.json`) passes with 0 errors
  from a clean state.
- Every package's `main` and `types` field points to a file that
  actually exists after that build — verified programmatically for all
  27 packages.
- Every package's `tsconfig.json` `references` list was checked against
  its actual `@ryper/*` `dependencies` (not `devDependencies`) for
  missing project references; none were missing.

### TypeScript validation

- Root `tsconfig.json`'s reference graph matches the real package
  graph (see above).
- All 27 packages share `tsconfig.base.json`'s compiler options
  (composite builds, declaration output, strict mode, module
  resolution); no package overrides diverge in a way that broke the
  build.
- `tsconfig.eslint.json` (used only by ESLint's type-aware linting, not
  by `tsc --build`) covers the same package set.

### Vite / Vitest validation

- This repository does not use Vite as a bundler anywhere yet (no
  `vite.config.*` exists) — only Vitest, for running tests directly
  against TypeScript source via esbuild transforms. This is consistent
  with every phase through 11; not a gap introduced or found by this
  phase.
- The single root `vitest.config.ts`'s `include` globs were checked
  against every actual `test/` directory in the repo (`find . -type d
-name test`); coverage is exact — no test directory is silently
  excluded, and no glob entry matches zero directories.

### Import/export validation

Every import across all 27 packages type-checks under `tsc --build`'s
full project-reference graph, which is authoritative: a broken import,
a broken barrel re-export, or an invalid path mapping would fail that
build. It doesn't. No manual per-file import audit found anything
`tsc --build` didn't already catch.

### Test validation

Full suite: **171 test files, 908 tests, 908 passed, 0 failed, 0
skipped** — run twice, once under the sandbox's default `TZ` (UTC) and
once under `TZ=Pacific/Marquesas` (UTC−09:30, chosen to maximize the
chance of exposing any remaining timezone-sensitive assertion anywhere
in the repo). Both runs: 908/908.

**One defect found and fixed:** `core/planner/test/scheduler.test.ts`
had a timezone-dependent assertion (string-matching a UTC-rendered ISO
timestamp against a local-time expectation) that only passed on a host
whose local timezone happened to be UTC. Root cause, fix, and why the
_implementation_ (`computeNextRun`, `ScheduleSpec.atTime`) was correct
and left unchanged are recorded in `docs/adr/0011`.

### Known issues considered and not fixed (not defects)

- `@ryper/example-plugin`'s `tsconfig.json` doesn't reference
  `core/event-bus`, `core/plugin-runtime`, or `core/security` even
  though its `devDependencies` list them. Not a bug: those three are
  imported only from its `test/` files, and its `tsconfig.json`
  deliberately scopes `include` to `["src"]` only (the same pattern 26
  of the 27 packages in this repo use) — Vitest runs tests directly via
  esbuild and doesn't consult `tsc --build`'s project-reference graph at
  all, so this doesn't affect building, testing, or consuming the
  package.
- `platform/desktop/*` and `platform/mobile/*` have no `package.json`
  and are excluded from ESLint's `ignores` list. Not a gap this phase
  introduced or is scoped to fix — they're empty placeholder
  directories with no code yet, consistent with the "no platform shell
  wires up windows-agent yet" gap already recorded below from Phase 10
  and 11.

### `core/logging` — `@ryper/logging`

Structured leveled logger every other package logs through.
**API:** `createLogger(scope, options?)`, `Logger` (`.debug/.info/.warn/.error`, `.child(scope)`), `LogLevel`, `LogRecord`, `LogSink`, `jsonConsoleSink`.

### `core/event-bus` — `@ryper/event-bus`

In-process typed pub/sub, the backbone for automation and cross-module reactions.
**API:** `createEventBus()`, `EventBus` (`.on`, `.subscribe`, `.emit`, `.listenerCount`), `RyperEvent`, `EventHandler`, `EventFilter`, `Unsubscribe`.

### `core/security` — `@ryper/security`

The capability broker every OS-level access is mediated through.
**API:** `createCapabilityBroker(promptForConsent)`, `CapabilityBroker` (`.requestCapability`, `.hasGrant`, `.revoke`, `.assertGranted`, `.getAuditLog`), `Capability`, `CapabilityRequest`, `CapabilityGrant`, `ConsentPrompt`.

### `core/model-router` — `@ryper/model-router`

Local-vs-cloud routing decision engine (transparent, reasoned decisions).
**API:** `createModelRouter(eventBus?)`, `ModelRouter` (`.registerProvider`, `.decide`, `.route`), `RoutingHint`, `RoutingRequest`, `RoutingDecision`, `DeviceState`, `ModelProvider`.

### `core/memory` — `@ryper/memory`

Foundational short-term and long-term memory primitives (Phase 1/2). Still
the basis for `ShortTermMemory` reuse in `@ryper/ai-engine` and
`@ryper/memory-system`; `LongTermMemory`/`KnowledgeGraph` remain available
for any module that only needs the original, simpler shape.
**API:** `ShortTermMemory`, `estimateTokens`, `ConversationTurn`; `LongTermMemory`, `MemoryItem`, `MemoryCategory`; `KnowledgeGraph`, `Entity`, `Relation`.

### `core/rag` — `@ryper/rag`

Document chunking + hybrid vector/keyword retrieval.
**API:** `chunkText`, `createVectorStore(embed)`, `VectorStore` (`.addDocument`, `.search`, `.size`), `EmbedFn`, `DocumentChunk`, `RetrievedChunk`.

### `core/automation` — `@ryper/automation`

Event-triggered, capability-gated rule engine.
**API:** `AutomationEngine` (`.registerRule`, `.unregisterRule`, `.listRules`, `.dispose`), `AutomationRule`, `AutomationAction`.

### `core/documents` / `core/media` — `@ryper/documents`, `@ryper/media`

Transform-pipeline registries for document/image/video/audio operations (foundation only — real transforms land in a later phase).
**API:** `createDocumentEngine()`, `DocumentEngine` (`.register`, `.run`, `.listTransforms`); `createMediaEngine()`, `MediaEngine` (`.register`, `.run`, `.estimateCost`).

### `core/plugin-runtime` — `@ryper/plugin-runtime`

Sandboxed, capability-gated, signature-checked plugin loader/invoker.
**API:** `createPluginRuntime(broker, eventBus, allowUnsigned?)`, `PluginRuntime` (`.register`, `.unregister`, `.invoke`, `.listPlugins`), `PluginLoadError`, `PluginManifest`, `PluginAction`.

### `core/sync` — `@ryper/sync`

Last-write-wins CRDT store for cross-device state.
**API:** `createSyncStore(deviceId, eventBus?)`, `SyncStore<T>` (`.set`, `.get`, `.merge`, `.snapshot`), `SyncedRecord<T>`.

### `core/conversation` — `@ryper/conversation`

Phase 1/2's conversation orchestration (predates and is simpler than `@ryper/ai-engine`'s `AIOrchestrator`; still used by `platform/web`'s current wiring).
**API:** `ConversationEngine` (`.sendMessage`, `.getShortTermMemory`), `SendMessageOptions`, `AssistantReply`.

### `core/ai-engine` — `@ryper/ai-engine` (Phase 3)

The Core AI Engine — see `core/ai-engine/README.md` for the full integration contract.
**Key exports:** `AIOrchestrator`/`createAIOrchestrator`, `ProviderRegistry`/`createProviderRegistry`, `createOpenAICompatibleProvider`, `createAnthropicCompatibleProvider`, `createGoogleCompatibleProvider`, `createOllamaCompatibleProvider`, `ModelSelectionEngine`, `ContextManager`, `TokenBudgetManager`, `PromptBuilder`, `SessionManager`, `ToolRegistry`, `currentTimeTool`, `retryWithBackoff`, `runWithFallback`, `loadEngineConfig`, `HttpFetch`/`parseSSEStream`/`parseNDJSONStream`, `StreamEvent`/`ChatMessage`/`ToolSpec`/`ToolCallRequest`.

### `core/local-runtime` — `@ryper/local-runtime` (Phase 4)

The Local AI Runtime & Model Management system — see `core/local-runtime/README.md`.
**Key exports:** `LocalRuntimeManager`/`createLocalRuntimeManager` (incl. `.toAIProvider()`), `ModelRegistry`, `ModelDiscoveryService`, `ModelDownloadManager`, `ModelVerifier`, `VersionManager`, `ModelCache`, `ModelManager`, `RuntimeHealthMonitor`, `InferenceQueue`, `ModelSelector`/`defaultModelSelectionPolicy`, `DeviceCapabilityDetector`, `OfflineStatusDetector`, `createLlamaCppProvider`, `createOllamaRuntimeProvider`, `createOnnxRuntimeProvider`, `createMlxRuntimeProvider`, `MissingModelError`/`AllProvidersFailedError`.

### `core/memory-system` — `@ryper/memory-system` (Phase 5)

The Memory System — see `core/memory-system/README.md`.
**Key exports:** `MemoryManager`/`createMemoryManager` (the facade — `.createMemory`, `.createMemoryAuto`, `.getMemory`, `.updateMemory`, `.deleteMemory`, `.purgeMemory`, `.archiveMemory`, `.restoreMemory`, `.pinMemory`/`.unpinMemory`, `.tagMemory`, `.mergeMemories`, `.splitMemory`, `.searchMemories`, `.filterMemories`, `.findRelated`, `.findDuplicates`/`.resolveDuplicates`, `.findConflicts`, `.compressOldMemories`, `.runMaintenance`, `.exportMemories`/`.importMemories`, `.backup`/`.restore`, `.getStatistics`, `.getAuditLog`, `.getVersionHistory`, `.enable`/`.disable`, `.getShortTermMemory`), `MemoryStore`, `MemoryIndex`, `EmbeddingService`, `SemanticSearchEngine`, `MemoryRankingEngine`, `ImportanceScorer`, `MemoryCategorizer`, `MemoryDeduplicator`, `ConflictResolver`, `MemoryCompressor`, `MemoryExpirationManager`, `MemoryEncryption`/`SecureKeyStore`, `MemoryAuditLog`, `MemoryVersionHistory`, `MemoryBackupService`, `MemoryPermissions`, `MemorySyncService`/`excludeTypes`, `MemoryStatistics`, `MemoryType`/`MemoryRecord`/`CreateMemoryInput`/`UpdateMemoryInput`/`RetentionPolicyMap`.

### `core/voice-engine` — `@ryper/voice-engine` (Phase 6)

The Voice Engine & Audio Platform — see `core/voice-engine/README.md`.
**Key exports:** `AudioPipelineManager`/`createAudioPipelineManager` (the full wake-word → VAD → STT → intent → context → AI Engine → TTS → speaker pipeline, `.runTurn()`/`.interrupt()`), `WakeWordEngine`, `AudioDeviceManager`, `MicrophoneManager`, `SpeakerManager`, `EnergyVoiceActivityDetector`, `BasicNoiseSuppressor`, `NlmsEchoCanceller`, `SpeechRecognitionRegistry`/`createLocalSpeechRecognitionProvider`/`createCloudSpeechRecognitionProvider`, `SpeechSynthesisRegistry`/`createLocalSpeechSynthesisProvider`/`createCloudSpeechSynthesisProvider`/`VoiceCache`, `IntentDetector`, `VoiceCommandRouter`/`notYetImplementedHandler`, `VoiceContextManager`, `VoiceSessionManager`, `VoiceSettingsManager`, `VoiceDiagnostics`, `VoiceAnalytics`.

### `core/planner` — `@ryper/planner`

The Agent Planner & Task Orchestration Engine — see `core/planner/README.md`.
Natural language in, a validated `ExecutionPlan` (DAG of abstract `TaskNode`s) out; never executes a task itself.
**Key exports:** `PlannerEngine`/`createPlannerEngine` (`.plan()`, `.buildExecutionQueue()`, `.registerPluginTaskSchema()`, `.recordSuccessfulPlan()`, `.diagnostics`, `.pluginRegistry`), `IntentParser`, `GoalAnalyzer`, `TaskGenerator`, `TaskGraph`/`DependencyAnalyzer`/`computeExecutionLevels`/`detectCycles`, `ParallelExecutionPlanner`, `SequentialExecutionPlanner`, `ExecutionQueue`, `CapabilityResolver`, `PermissionValidator`, `ContextResolver`/`getPreference`/`rememberPreference`, `ToolSelector`, `RetryPlanner`, `RecoveryPlanner`, `CancellationManager`, `ProgressTracker`, `PlannerScheduler`/`computeNextRun`, `PlanOptimizer`/`dedupeTasks`/`reduceRedundantDependencies`, `PlannerMemoryIntegration`, `ConversationalPlanningSession`/`createPlannerVoiceCommandHandler`, `PlannerPluginRegistry`, `loadPlannerConfig`, `PlannerDiagnostics`.

### `core/tool-framework` — `@ryper/tool-framework`

The Universal Tool Calling Framework — see `core/tool-framework/README.md`.
The execution layer between the Planner and every platform adapter (`User → Planner → Tool Calling Framework → Platform Adapter → Execution`); never contains platform-specific code itself.
**Key exports:** `ToolManager`/`createToolManager` (`.registerTool()`, `.unregisterTool()`, `.updateTool()`, `.discover()`, `.invoke()`, `.cancel()`, `.registry`, `.diagnostics`, `.metrics`, `.logger`, `.pluginBridge`, `.memoryIntegration`), `ToolRegistry`, `ToolDiscovery`, `ToolValidator`, `ToolExecutor`, `ToolPermissionManager`, `buildToolContext`, `buildToolResult`/`FRAMEWORK_ERROR_CODES`, `ToolRetryPlanner`, `ToolRecoveryPlanner`, `consumeToolStream`/`collectStreamData`, `ToolQueue`, `ToolScheduler`, `ToolCancellationRegistry`, `ToolDiagnostics`, `ToolMetrics`, `ToolInvocationLogger`, `loadToolFrameworkConfig`, `ToolPluginBridge`, `ToolMemoryIntegration`, `createToolVoiceCommandHandler`, `PlannerToolBridge`/`createPlannerToolBridge`, `builtinTools` (`getCurrentTimeTool`, `textTransformTool`, `textEchoStreamTool`).

### `ui/design-system`, `ui/components` — `@ryper/design-system`, `@ryper/components`

Design tokens + liquid-glass presets; framework-agnostic component view-models.

### `plugins/sdk`, `plugins/examples/example-plugin` — `@ryper/plugin-sdk`, `@ryper/example-plugin`

Third-party plugin SDK (`definePlugin`, `defineAction`) and a worked reference plugin.
**Phase 9 additions (fully backward-compatible — `definePlugin`'s original `manifest`/`actions` shape is unchanged):** optional `extended` metadata (`author`, `description`, `dependencies`, `minSdkVersion`/`maxSdkVersion`, `supportedPlatforms`, `settingsSchema`, `pluginType`, `toolRegistrations`, `plannerTaskSchemas`) and optional `lifecycle` hooks (`initialize`/`onEnable`/`onDisable`/`onSuspend`/`onResume`/`onUninstall`), plus the host-injected `PluginContext` interface family (`PluginToolAccess`, `PluginMemoryAccess`, `PluginPlannerAccess`, `PluginVoiceAccess`, `PluginSettingsAccess`, `PluginEventAccess`, `PluginLoggingAccess`, `PluginDiagnosticsAccess`, `PluginNotificationsAccess`) — see `docs/adr/0001` and `0002`.

### `core/plugin-platform` — `@ryper/plugin-platform`

The Plugin SDK & Extension Platform (host side) — see `core/plugin-platform/README.md`.
**Key exports:** `PluginManager`/`createPluginManager` (`.install()`, `.update()`, `.uninstall()`, `.enable()`/`.disable()`/`.suspend()`/`.resume()`/`.reload()`, `.invokeAction()`, `.registry`, `.metrics`, `.diagnostics`, `.permissions`, `.sandbox`), `createExtensionManifest`/`toPluginManifest`, `PluginManifestValidator`, `PluginDependencyResolver`, `PluginSandbox`, `PluginPermissionManager`/`BUILTIN_PERMISSION_GROUPS`, `PluginConfigurationManager`, `PluginDiagnostics`/`PluginMetrics`, `PluginLoggerFactory`, `PluginEventBridge`, `PluginPlatformRegistry`, `PluginLifecycleManager`, `signPackage`/`verifyPackageSignature`/`checkVersionCompatibility`/`isValidUpdate`, `PluginLoader`, `PluginInstaller`, `loadPluginPlatformConfig`, `compareVersions`/`isWithinRange` (semver), `BUILTIN_PLUGIN_TYPES`.

### `core/platform-capability` — `@ryper/platform-capability`

The Platform Capability Layer (PCL) — see `core/platform-capability/README.md`.
The only interface the AI Engine, Planner, Tool Framework, and Plugins are allowed to use for anything OS/hardware-touching; adapters are contracts only in this phase (no real Windows/macOS/Linux/Android/iOS/Browser logic yet).
**Key exports:** `CapabilityManager`/`createCapabilityManager` (`.registerCapability()`, `.registerAdapter()`, `.resolve()`/`.resolveAll()`, `.discover()`, `.invoke()`, `.activeAdapter()`, `.registry`, `.adapters`, `.permissions`, `.diagnostics`, `.metrics`), `CapabilityRegistry`, `AdapterRegistry`, `PlatformResolver`, `createNullAdapter`, `CapabilityResolver`, `CapabilityValidator`, `CapabilityPermissions`, `CapabilityDiscovery`, `CapabilityDiagnostics`/`CapabilityMetrics`, `loadPlatformCapabilityConfig`, `BUILTIN_CAPABILITY_DOMAINS`, `createPlannerCapabilitySource` (Planner integration — see ADR 0006), `createCapabilityTool` (Tool Framework integration — see ADR 0008), `createPluginCapabilityContext` (Plugin integration).
Also extends, additively and backward-compatibly: `@ryper/planner`'s `CapabilityResolver` (injectable `PlatformSupportSource`, ADR 0006) and `@ryper/plugin-sdk`'s `PluginContext` (optional `capabilities: PluginCapabilityAccess`).

### `core/windows-agent` — `@ryper/windows-agent`

The Windows Platform Agent — the first production `PlatformAdapter` — see `core/windows-agent/README.md`.
Every Windows-touching operation routes through one injectable `WindowsSystemApi` seam; nothing outside this package calls a Windows API directly, and nothing outside `CapabilityManager.invoke()` calls this package's `WindowsAdapter.invoke()` directly.
**Key exports:** `WindowsAdapter`/`createWindowsAdapter` (`.create()` async factory, `.supports()`, `.describeCapability()`, `.invoke()`, `.getDeviceInfo()`, `.getRuntimeLimitations()`, plus every manager as a public property), `bootstrapWindowsPlatformAgent`/`createLaunchApplicationTool` (wiring helpers), `WindowsSystemApi` (the injection interface), `InMemoryWindowsSystemApi`/`createInMemoryWindowsSystemApi` (real, stateful, default), `PowerShellWindowsSystemApi`/`createPowerShellWindowsSystemApi`/`unavailableShellExec` (production shape, needs an injected `ShellExec`), `WindowsVersionDetector`/`createWindowsVersionDetector`/`isSupportedOnRelease`, `ProcessManager`, `WindowManager`, `ApplicationManager`, `FileManager`, `ClipboardManager`, `NotificationManager`, `AudioManager`, `DisplayManager`, `DeviceManager`, `PermissionManager`, `RegistryInterface`, `ServiceManager`, `EventMonitor`, `PerformanceMonitor`, `DiagnosticsManager`, `DestructiveActionGate`/`createDestructiveActionGate`/`denyAllConfirmer`, `WindowsPluginCapabilityRegistry`/`createWindowsPluginCapabilityRegistry`, `WINDOWS_CAPABILITY_DESCRIPTORS`/`registerWindowsCapabilityDescriptors`.

### `platform/web` — `@ryper/web-shell`

Real, tested web shell bootstrap wiring Core services together (currently wired to `@ryper/conversation`; migrating to `@ryper/ai-engine`'s `AIOrchestrator` is a natural next step, not yet done).

### `infra/telemetry` — `@ryper/telemetry`

Opt-in, disabled-by-default telemetry client.

### `platform/desktop/*`, `platform/mobile/*`

Native shell scaffolds (WinUI/C#, AppKit+Swift, GTK4+Rust, Jetpack Compose/Kotlin, SwiftUI) — real, valid project files, not yet build-verified (no native toolchain in this build environment). See each shell's own README.

## Known integration gaps (accurate as of Phase 10 — not yet wired)

These are honestly not done yet, so a future phase doesn't have to guess:

- `@ryper/ai-engine`'s `ContextManager` still reads/writes `@ryper/memory`'s
  `LongTermMemory` directly (from Phase 3), not yet `@ryper/memory-system`'s
  `MemoryManager`. Wiring that switch is a good candidate for the next
  phase that touches the Core AI Engine.
- `@ryper/local-runtime`'s embedding output (`LocalRuntimeManager.embed()`)
  is not yet wired as the default `EmbedFn` for `@ryper/memory-system`'s
  `EmbeddingService` or `@ryper/rag`'s `VectorStore` — both still expect the
  caller to inject one.
- `platform/web` still boots `@ryper/conversation`'s simpler
  `ConversationEngine` rather than `@ryper/ai-engine`'s `AIOrchestrator`.
- No platform shell yet calls `@ryper/memory-system`'s `MemoryManager` for
  a real Memory Viewer UI, or wires a real `MemoryPersistence`/`FileSystemLike`
  backed by encrypted SQLite (both packages currently ship only in-memory
  reference implementations for their own tests, by design — see each
  package's README).
- `@ryper/voice-engine` has no platform shell wiring yet: no real
  `AudioDeviceSource`/`AudioCaptureSource`/`AudioPlaybackSink`, no real
  `WakeWordProvider` (Porcupine or platform-native), and no desktop/mobile
  shell calls `AudioPipelineManager` yet. Every injection point is
  interface-complete and unit-tested against fakes, per
  `core/voice-engine/README.md`'s "honest limitations" section — the next
  phase that touches a specific platform shell is the natural place to
  supply the first real implementations.
- Local STT/TTS via `@ryper/voice-engine`'s local providers are single-shot
  (buffer-then-respond) because `@ryper/local-runtime`'s `transcribe()`/
  `synthesizeSpeech()` are single-shot (a Phase 4 limitation, not new to
  Phase 6) — true incremental local streaming needs a future
  `@ryper/local-runtime` runtime adapter upgrade.
- `@ryper/voice-engine`'s `VoiceCommandRouter` currently only has one
  real example handler wired in tests (`create_note`-shaped); the
  brief's other example commands (open application, edit PDF/image,
  summarize document, smart home, run automation, open website) are
  detected correctly by `IntentDetector` but have no real handler yet —
  register them with `notYetImplementedHandler` today, replace with real
  handlers as their owning modules (Desktop Agent, Documents, Automation
  Engine, ...) are built.
- `@ryper/planner` has no platform agent consuming its `ExecutionPlan`s
  yet — `PlannerEngine.buildExecutionQueue()` produces a real, runnable
  `ExecutionQueue`, but nothing currently calls `.dequeueReady()` /
  `.markSucceeded()` / `.markFailed()` against it outside tests. The next
  phase that builds a Desktop/Android/iOS/Browser/Automation/Cloud agent
  is the natural place to start driving it for real.
- `@ryper/planner`'s `createPlannerVoiceCommandHandler` is a real
  `VoiceCommandHandler`, but it isn't registered with
  `@ryper/voice-engine`'s `VoiceCommandRouter` by any platform shell yet
  — conversational planning is fully implemented and unit-tested
  end-to-end (see `core/planner/test/voice-integration.test.ts`) but not
  wired into a live voice pipeline.
- `@ryper/planner`'s `PlannerPluginRegistry` is a second, planner-facing
  registration point plugins must call in addition to
  `PluginRuntime.register()`, because `PluginRuntime` only exposes plugin
  _manifests_ publicly (`listPlugins()`), not per-action schemas. No
  existing plugin (including `plugins/examples/example-plugin`) registers
  with it yet. If a future phase adds schema introspection to
  `@ryper/plugin-runtime` itself, this two-registration step can likely
  collapse into one.
- `@ryper/planner`'s `taskTypeToCapability` map only covers 7 of the 19
  task types, because `@ryper/security`'s `Capability` union doesn't
  define capabilities for the rest (note, calendar, message, application,
  smart_home, call, ai, memory, platform) — those tasks are planned and
  routed but never permission-gated. Extending `Capability` is
  `@ryper/security`'s call, not something this phase did unilaterally.
- `@ryper/planner`'s `TaskCondition` evaluation only understands three
  fixed keywords (`always`/`on_success`/`on_failure`) against the
  immediate upstream task's terminal state — it has no channel to real
  device/app state (e.g. actually checking Wi-Fi connectivity for "if
  Wi-Fi disconnects, notify me"). That channel belongs to whichever
  platform agent owns the relevant state.
- `@ryper/planner`'s `PlannerScheduler` ships only an in-process
  `setTimeout`-backed `SchedulerBackend` (no native toolchain in this
  build environment, same constraint as Phase 6's audio hardware). A
  platform shell needs to supply a real OS-timer/background-task/
  push-notification-backed `SchedulerBackend` for "every morning at 7 AM"
  to survive an app restart or actually notify the user.
- `@ryper/tool-framework`'s `ToolManager` only has three registered tools
  (`system.get_current_time`, `system.text_transform`,
  `system.text_echo_stream`) — genuinely functional but deliberately
  hardware-free, exactly like `@ryper/ai-engine`'s `currentTimeTool`. No
  filesystem/browser/document/calendar/camera/smart-home/etc. tool exists
  yet; those are real platform-adapter integrations for a later phase.
- `@ryper/tool-framework`'s `PlannerToolBridge` requires a platform
  adapter (or bootstrap script) to manually call `registerRoute(taskType,
operation, toolId)` for every task shape it wants routed — nothing
  auto-derives a route from a tool's own `ToolSpec` yet.
- `@ryper/tool-framework`'s `createToolVoiceCommandHandler` is a real
  `VoiceCommandHandler` but isn't registered with
  `@ryper/voice-engine`'s `VoiceCommandRouter` by any platform shell yet
  — same "implemented and unit-tested, not yet wired into a live voice
  pipeline" gap as the Planner's voice integration.
- `@ryper/tool-framework`'s `ToolPermissionManager` layers temporary-grant
  expiry on top of `@ryper/security`'s `CapabilityBroker` by tracking
  expiry timestamps itself; anything that reads a grant directly from the
  broker (bypassing `ToolPermissionManager.checkAll()`) won't see a
  temporary grant auto-revoke. Extending `CapabilityBroker` itself with
  native expiry is `@ryper/security`'s call, not something this phase did
  unilaterally.
- `@ryper/tool-framework` and `@ryper/ai-engine`'s existing
  `tool-calling` module are intentionally separate today (see
  `core/tool-framework/README.md` for why) — no bridge lets an
  ai-engine-orchestrated model conversation invoke a `ToolManager`-registered
  tool yet. Unifying them would mean editing `ai-engine`, an existing
  unrelated package, which wasn't done here.
- `@ryper/tool-framework`'s `ToolValidator` implements a deliberately
  small JSON-schema subset (type, required, enum, length/numeric bounds,
  nested object/array) — no `$ref`, `oneOf`/`anyOf`, or format validators.
  Sufficient for every tool registered so far; a richer spec is a
  separate, deliberate upgrade if a future tool needs it.
- `@ryper/plugin-platform`'s `PluginSandbox` enforces resource limits
  (concurrency, timeout, payload size) around `PluginRuntime.invoke()`,
  not real OS-level process/isolate isolation — no native toolchain
  exists in this build environment. See `docs/adr/0003`.
- `@ryper/plugin-platform`'s package signing (`store-format.ts`) is
  HMAC-SHA256 (a shared-secret scheme), not asymmetric/PKI signing with a
  published trust root — adequate for first-party plugins, not yet an
  open multi-publisher store. See `docs/adr/0004`. No online store
  client, registry, or publish flow exists, per the brief's explicit
  instruction to design the architecture only.
- `@ryper/plugin-platform`'s `PluginDependencyResolver` requires an exact
  version match between a declared dependency and the installed plugin's
  version — no semver range grammar (`^1.2.0`, `>=1.0.0 <2.0.0`).
  `semver.ts` only implements comparison and inclusive-range checks.
- `@ryper/plugin-platform`'s `PluginInstaller.update()` only supports
  updating a plugin currently in the `"enabled"` or `"disabled"` state —
  a plugin stuck mid-lifecycle (`"suspended"`, `"initialized"`, etc.)
  must be disabled or enabled first. A real constraint of the lifecycle
  transition table (`docs/adr/0005`), not an oversight.
- No plugin in this repo (including `plugins/examples/example-plugin`)
  currently uses the Phase 9 `extended`/`lifecycle` fields or registers
  real tools/planner schemas/voice commands — the reference plugin still
  uses the original, simpler `definePlugin` shape. End-to-end usage is
  demonstrated only in `core/plugin-platform`'s own test suite
  (`test/plugin-loader.test.ts`, `test/plugin-manager.test.ts`).
- `@ryper/plugin-sdk`'s `PluginContext.voice.registerCommand` and
  `.plannerIntegration.registerTaskSchema` call straight through to a
  supplied `VoiceCommandRouter`/`PlannerPluginRegistry`, but no platform
  shell currently constructs a `PluginManager` with those wired in — the
  same "implemented and unit-tested, not yet wired into a live pipeline"
  gap noted for the Planner's and Tool Framework's own voice integrations.
- `@ryper/platform-capability` ships **no real platform adapter** —
  `createNullAdapter()` is the only implementation, and it honestly
  reports every capability as unsupported on every platform. Building
  real Windows/macOS/Linux/Android/iOS/Browser adapters against the
  `PlatformAdapter` contract is explicitly future-phase work, per this
  phase's own brief ("Do NOT implement the operating-system-specific
  logic yet"). See `docs/adr/0007`.
- No platform shell (`platform/desktop/*`, `platform/mobile/*`,
  `platform/web`) currently constructs a `CapabilityManager` or wires the
  Planner/Tool Framework/Plugin integration bridges
  (`createPlannerCapabilitySource`, `createCapabilityTool`,
  `createPluginCapabilityContext`) into a live pipeline — all three are
  implemented and unit/integration-tested in isolation
  (`core/platform-capability/test/`), including a full
  `PlannerEngine`-driven simulation, but nothing outside this package's
  own tests calls them yet.
- `@ryper/platform-capability`'s `defaultPlatformDetector` always returns
  `"browser"` — there is no real OS/hardware platform-detection logic in
  this build environment (no native toolchain, the same constraint every
  hardware-adjacent module since Phase 6 has documented). A real host
  must supply its own `PlatformDetector`.
- The `TaskType` → `CapabilityDomain` mapping
  (`TASK_TYPE_TO_DOMAIN` in `planner-integration.ts`) is a many-to-fewer,
  hand-picked mapping, not a precise 1:1 correspondence — see
  `docs/adr/0006` for why this is an accepted simplification rather than
  a gap to close immediately.
- `@ryper/windows-agent`'s `PowerShellWindowsSystemApi` cannot run in
  this build environment — no native Windows toolchain (`powershell.exe`,
  WMI, or Windows itself) exists in this sandbox, the same constraint
  every hardware-adjacent phase has documented since Phase 6. Its default
  `ShellExec` (`unavailableShellExec`) always rejects, explaining this
  plainly. It is exercised in tests via an injected fake `ShellExec` that
  verifies command construction and JSON-output parsing only — a real
  deployment must inject a real `ShellExec` and validate the generated
  commands against an actual Windows host before first production use.
  See `docs/adr/0009`.
- `@ryper/windows-agent`'s production API's `subscribeToEvents()` is an
  honest no-op (real-time Windows event subscription needs
  `Register-CimIndicationEvent`-style WMI event watching, which this
  phase doesn't implement) and its clipboard-history/media-transport
  operations are best-effort stubs that log a warning rather than
  silently fake data — the in-memory reference implementation is fully
  functional for all of these and is what every test runs against.
- No platform shell (`platform/desktop/*`, `platform/mobile/*`,
  `platform/web`) currently constructs a `WindowsAdapter` or calls
  `bootstrapWindowsPlatformAgent()` in a live pipeline — it is
  implemented and unit/integration-tested in isolation
  (`core/windows-agent/test/`, including a full
  `CapabilityManager`+`PlannerEngine`+`ToolManager` integration test),
  but nothing outside this package's own tests calls it yet, the same
  "implemented and verified, not yet wired into a live shell" gap noted
  for `@ryper/platform-capability` itself in Phase 10.
- `@ryper/windows-agent`'s `CapabilityDescriptor.requiredCapability`
  coverage is partial, same as `TASK_TYPE_TO_DOMAIN` above: only
  `notifications`, `filesystem` (mapped to the broader
  `filesystem.write`), `process_management`, `background_services`, and
  `registry` have a matching entry in `@ryper/security`'s `Capability`
  union today. Domains like `audio`, `window_management`, and `display`
  rely solely on this package's own `DestructiveActionGate`/
  `PermissionManager` gates rather than a `CapabilityBroker` grant,
  because `@ryper/security`'s `Capability` union has no entry for them
  yet — extending it is `@ryper/security`'s call, not something this
  phase did unilaterally. See `core/windows-agent/README.md`'s "Honest
  Limitations".
- `@ryper/windows-agent`'s toast notification action-button click
  handling is modeled in the type system (`NotificationSpec.actions`)
  and accepted by `InMemoryWindowsSystemApi`, but there is no wired-up
  callback path from a real Windows toast click back into this package
  — a `Windows.UI.Notifications`-level integration a future phase should
  add.

## Repository certification (Release Candidate 1)

Certification method: full pipeline (`npm ci` → `npm run build` → `npm
test` → `npm run lint` → `npm run format:check`) run to completion with
zero failures, plus the additional independent-resolution proofs
described in the RC1 row above and `docs/adr/0013`. Health scores below
are a qualitative summary of that evidence, not a separate scoring tool.

| Dimension           | Score   | Basis                                                                                                                                                                                                                       |
| ------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository health   | 100/100 | All five pipeline commands pass with zero errors/warnings from a cold state (`npm ci`, not just `npm install`)                                                                                                              |
| Workspace health    | 100/100 | 27/27 packages resolve via workspace symlinks; 0 circular dependencies; 0 missing `tsconfig.json` references; root `tsconfig.json`/`package.json` workspace globs cover exactly the real package set                        |
| Build health        | 100/100 | `tsc --build` 0 errors cold; every `main`/`types`/`exports` target file verified to exist on disk post-build (27/27)                                                                                                        |
| Test health         | 100/100 | 171 test files, 908/908 tests passing; verified passing both via the Phase 11.7 zero-`dist/` alias path and via genuine `exports`-map resolution with the alias disabled                                                    |
| Package health      | 100/100 | Every package: valid `name`/`version`/`private`/`type`/`main`/`types`/`exports`/`scripts`/`dependencies`; 0 deep imports bypassing any package's public barrel; 0 dependency-version conflicts; 0 `peerDependencies` needed |
| Architecture health | 100/100 | No redesign, no new modules, no removed tests across Phases 11.5–RC1; every ADR (0009–0013) documents a scoped, minimal, root-cause fix with alternatives considered                                                        |

**Production readiness assessment:** the repository builds, tests, and
lints cleanly from a completely cold clone (`npm ci` with no prior
state) using only the commands documented in this file and each
package's own `README.md`. Every workspace package has an explicit,
standards-compliant `exports` map in addition to legacy-compatible
`main`/`types` fields. No known module-resolution, workspace-linking, or
build-ordering defect remains open.

**Approved for Phase 12 (Desktop Shell & User Experience):** yes.
