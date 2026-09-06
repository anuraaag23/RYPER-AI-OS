# ADR 0020: Real local-first LLM via a managed llama-server process, explicit-only cloud fallback, and structural tool-call validation

**Status:** Accepted (Phase 13.9)

## Context

Phase 13.5 built a real `AIOrchestrator` (`docs/adr/0016`) with a real
multi-round tool-calling loop, but the only `AIProvider` ever wired
into it was `HeuristicToolCallingProvider` — explicitly, repeatedly
documented as a deterministic pattern matcher, not a language model.
Separately, `@ryper/ai-engine` already had real, complete, tested
`AIProvider` implementations for OpenAI-, Anthropic-, and
Google-compatible chat APIs (real SSE streaming, real tool-call
accumulation) since an earlier phase, and `@ryper/local-runtime`
already had a real `createLlamaCppProvider()` — a thin wrapper
expecting an already-running llama.cpp server — and a real
`LocalRuntimeManager.streamChat()` that already implements
local-first-with-explicit-cloud-fallback routing. None of this had ever
actually been connected to the orchestrator; nothing was actually
running a real LLM backend for it to talk to.

Phase 13.9's job was specifically to close that connection — replacing
`HeuristicToolCallingProvider` as the _default_ while reusing every one
of the pieces above unchanged, per the brief's explicit "do not create
a second AI architecture."

## Decision

### 1. A real, locally-managed `llama-server` process is the default local LLM

`platform/desktop-app/electron/llm-model-provisioning.ts` mirrors
`voice-model-provisioning.ts`'s (Phase 13.7) exact pattern: real,
on-disk detection of an externally-installed `llama-server` binary and
GGUF model (never bundled into this repository), producing actionable
diagnostics (`"installed"` / `"binary-missing"` / `"model-missing"`)
instead of a bare failure. Unlike whisper.cpp/Piper (one CLI
invocation per request), `llama-server` is a real, long-running HTTP
server process — `LlamaServerManager` additionally owns its lifecycle
(start via the existing `ProcessRunner` abstraction, poll the server's
own real `/health` endpoint for readiness rather than assuming a fixed
delay, stop). Once running, the existing, unmodified
`createLlamaCppProvider()` talks to it — this phase added no new AI
wire-protocol code, only the process management to give that existing
code something real to connect to.

### 2. `LocalRuntimeManager.streamChat()`'s existing local-first/explicit-cloud-fallback logic is reused via one new adapter

`core/local-runtime/src/runtime-providers/ai-provider-adapter.ts`
(`createLocalRuntimeAIProvider()`) is the only new piece of AI-routing
code this phase adds: an ~20-line adapter wrapping
`LocalRuntimeManager.streamChat()` as an `@ryper/ai-engine` `AIProvider`
so `ProviderRegistry` can hold it. Everything it delegates to —
provider fallback ordering, the optional `cloudChatFallback` — is
Phase 4's existing, unmodified `LocalRuntimeManager`.

### 3. `HeuristicToolCallingProvider` remains, always registered, as the honest last-resort fallback

Exactly the Phase 13.7 pattern for `ReferenceVoiceRuntimeProvider`: if
real detection at bootstrap finds no real binary+model, or the real
server fails to start, `ai-orchestrator-bootstrap.ts` falls through to
registering only the heuristic provider — the system degrades
honestly rather than crashing or fabricating a response, and the exact
same architecture (`ProviderRegistry`, `ModelSelectionEngine` picking
`candidates[0]` for the `"local"` kind) picks whichever is actually
registered, with no special-case branching.

### 4. Cloud providers are real, reused unchanged, and require all three of provider/API key/model to be explicitly set

`loadExplicitCloudLLMConfig()` reads
`RYPER_CLOUD_LLM_PROVIDER`/`_API_KEY`/`_MODEL` (optionally
`_BASE_URL`) — cloud is constructed only if **all three** required
values are present, using the existing, unmodified
`createOpenAICompatibleProvider`/`createAnthropicCompatibleProvider`/
`createGoogleCompatibleProvider`. No vendor is hard-coded as mandatory;
none is silently substituted for local. The configured cloud provider
is registered two ways, both inert unless configured: as
`LocalRuntimeManager`'s `cloudChatFallback` (reachable if every local
candidate fails), and directly in `ProviderRegistry` under its own
`kind` (reachable when `ModelRouter` independently decides "cloud" —
e.g. a task hint requiring capabilities beyond what a small local model
can handle). Both paths reuse the same, already-real provider
construction; this phase added no new HTTP client code for any cloud
vendor.

### 5. Real, structural tool-argument schema validation, added to `ToolRegistry.invoke()`

A concrete, previously real gap: nothing validated `ToolCallRequest.arguments`
against a tool's own `ToolSpec.parameters` schema before `execute()`
ran — the brief's own example, `set_volume(500)`, would have reached
`desktopActions.setVolume()` unchecked. `core/ai-engine/src/tool-calling/validation.ts`
is a small, dependency-free JSON-schema-lite validator (type, required,
enum, numeric range, string length/pattern — not a general JSON Schema
implementation, deliberately) wired into `ToolRegistry.invoke()`
_before_ the existing `CapabilityBroker` check, so an
out-of-range/malformed/hallucinated argument never reaches either
capability enforcement or the tool implementation. `set_volume`'s
schema gained real `minimum`/`maximum` bounds as part of this. Fixing
this surfaced a real, secondary bug: `HeuristicToolCallingProvider`'s
regex-captured slots are always strings (`"30"`, not `30`), which the
new strict validator correctly rejected — `heuristic-ai-provider.ts`
now coerces numeric-looking slot values, which also more accurately
models what a real LLM's schema-conformant JSON tool-call output looks
like.

### 6. Capability sensitivity classification — prep only, not lock-state enforcement

`@ryper/security` gained `CapabilitySensitivity`
(`"safe" | "protected"`) and a `CAPABILITY_SENSITIVITY` table
classifying every capability this repository currently defines. This
is explicitly **not** lock-state awareness — no lock state exists
anywhere in this repository — it is the classification table a future
Android agent's `CapabilityBroker`/`CapabilityManager` would consult
once lock-state checking exists, prepared now so that decision never
has to live inside an `AIProvider`.

## What this closes and what it honestly does not

**Closes for real:** a working, tested, real LLM-provider architecture
plugged into the existing, unmodified `AIOrchestrator`/`ToolRegistry`/
`CapabilityBroker`/`CapabilityManager` chain, with real process
management for a local backend, real (if unverified end-to-end) cloud
provider wiring, and a real, closed security gap in argument
validation. Verified against real software: `llama-server` was built
from real source and its real CLI/HTTP behavior (including a real,
honest failure when pointed at an invalid model) was exercised through
the actual repository code, not a mock — see
`docs/PROJECT_STATE.md`'s Phase 13.9 section.

**Does not close, honestly:** **no real chat completion has ever been
produced.** Every real GGUF chat model this environment attempted to
reach (Hugging Face, and every plausible GitHub-release-asset
alternative) was unreachable or invalid — see
`docs/PROJECT_STATE.md`'s Phase 13.9 section for the exact attempts and
results. No cloud provider call was made either — this environment has
no real API key for any vendor to test with, and none should be
fabricated. `HeuristicToolCallingProvider` therefore remains the
provider actually exercised by every default (non-opt-in) automated
test in this repository, exactly as before this phase — this ADR
changes what RYPER _can_ run given real models/keys, not what ran in
this session.

## Alternatives Considered

- **A native Node binding to llama.cpp (e.g. `node-llama-cpp`) instead
  of a managed server process.** Rejected for the same reason Phase
  13.7 rejected a native whisper.cpp binding: no native build toolchain
  is otherwise used in this repository, and llama.cpp's server is its
  own most-supported, most-portable integration path — reusing
  `createLlamaCppProvider()`'s existing OpenAI-wire-format assumption
  meant zero new AI-engine code either way.
- **A brand-new `AIProvider` implementation specific to local llama.cpp,
  instead of the adapter + existing `createLlamaCppProvider`.**
  Rejected: `createLlamaCppProvider`/`createOpenAICompatibleProvider`
  already existed, real and tested; writing a second implementation of
  the same OpenAI-compatible wire protocol would be exactly the
  "second AI architecture" the brief prohibits.
- **Hard-coding one cloud vendor (e.g. always OpenAI) as the fallback.**
  Rejected per the brief's explicit instruction; the vendor is a plain
  string read from configuration, dispatched to whichever existing
  provider constructor matches.

## Tradeoffs

- `bootstrapAIOrchestrator()` is now `async` and takes two new optional
  parameters (`paths`, `fileSystem`) — every in-repo call site was
  updated; omitting them (as any future headless caller might) simply
  skips real local-LLM detection and falls back to the heuristic
  provider, an intentional, honest degrade.
- Real `llama-server` startup has real, measured process-exit-detection
  latency bounded by this file's health-check poll interval (250ms) —
  a real, small, deliberate tradeoff between responsiveness and not
  hammering the health endpoint.

## Migration Impact

Additive except for two intentional, fully-migrated breaking changes:
`bootstrapAIOrchestrator()`'s new async signature (all in-repo callers
updated), and `ToolParameterSchema.properties`'s type tightening from
`Record<string, unknown>` to `Record<string, ToolParameterPropertySchema>`
(one in-repo call site, `desktop-tools.ts`'s `stringParam` helper,
updated to match — it already produced conforming values). No other
public API was removed or given a breaking signature change.
