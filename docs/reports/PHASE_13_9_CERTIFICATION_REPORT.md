# Phase 13.9 — Real LLM + Production Tool Calling — Final Certification Report

## 1. Executive Summary

`HeuristicToolCallingProvider` — explicitly, repeatedly documented
since Phase 13.5 as a deterministic pattern matcher, never a language
model — is no longer the only `AIProvider` wired into the existing,
unmodified `AIOrchestrator`. A real, locally-managed `llama-server`
process is the default local LLM when a real binary+model are
detected installed; explicit-only, optional cloud providers
(OpenAI/Anthropic/Google-compatible) reuse existing, unmodified code
when fully configured; the heuristic provider remains, always
registered, as the honest last-resort fallback. Real, structural
tool-argument schema validation was added, closing this phase's own
named example (`set_volume(500)` must not execute) — and, while
verifying it, a real, secondary bug in the heuristic provider's
argument typing was found and fixed.

`llama-server` was built from real source in this session and its real
process/HTTP behavior was exercised through the actual repository
code — including a real, honest failure when pointed at a real but
non-inference-capable GGUF file. **No real chat completion was ever
produced**: no inference-capable GGUF model was obtainable from this
build environment (Hugging Face and every alternative checked are
outside its network allowlist — the same structural finding Phase 13.8
made for Whisper), and no real cloud API key was available to test
with. This is reported as `NOT VERIFIED`, not assumed working.

**Certification:** `npm ci` → `npm run build` → `npm test` → `npm run
lint` → `npm run format:check` all pass clean from a genuinely cold
state, twice-verified. **195 test files passing + 2 correctly skipped,
1098 tests passing + 7 correctly skipped** (opt-in real-hardware/
real-LLM integration suites).

**Release readiness:** _"Voice pipeline verified for Piper/TTS,
model-management diagnostics, and now the LLM/tool-calling
architecture, but RC3 remains blocked by real end-to-end model
execution."_ See §49.

---

## 2. Repository baseline

Continued from Phase 13.8's state (1063/1063 tests, cold-state
certified). No new zip was attached to this phase's request; the
existing sandbox repository state was reused and confirmed to match
the Phase 13.8 baseline before any change was made, per this repo's
established practice this session.

## 3. LLM architecture

Reused entirely: `@ryper/ai-engine`'s real `AIOrchestrator`
(`ProviderRegistry`, `ModelSelectionEngine`, `PromptBuilder`,
`TokenBudgetManager`, `SessionManager`, `ToolRegistry`, all unmodified
since Phase 13.5/`docs/adr/0016`) and `@ryper/local-runtime`'s real
`LocalRuntimeManager.streamChat()` (local-first with an optional,
explicit `cloudChatFallback`, unmodified since Phase 4). This phase's
only new architectural piece is the seam connecting them:
`createLocalRuntimeAIProvider()` (~20 lines, `@ryper/local-runtime`),
plus the real process management to give the existing
`createLlamaCppProvider()` a real server to talk to.

## 4. Selected LLM provider

**Local (default):** `@ryper/local-runtime`'s existing
`createLlamaCppProvider()`, talking to a real, locally-managed
`llama-server` process (llama.cpp's own real server binary, OpenAI-
wire-format compatible) via a new, real `createNodeHttpFetch()`.
**Cloud (explicit-only, optional):** existing, unmodified
`createOpenAICompatibleProvider`/`createAnthropicCompatibleProvider`/
`createGoogleCompatibleProvider`, selected by
`RYPER_CLOUD_LLM_PROVIDER`. **Fallback (always registered):**
`HeuristicToolCallingProvider`, unchanged except for the numeric-slot
coercion fix (§9).

## 5. Local model

**BLOCKED — no real, inference-capable GGUF chat model could be
obtained in this environment.** Real attempts: Hugging Face (the
standard host for essentially all GGUF chat models) returned a real
HTTP 403 (`host_not_allowed`); a speculative GitHub-release-asset
check returned a real 404 (llama.cpp has never published chat model
weights as release assets). The only real `.gguf` files reachable in
this session are llama.cpp's own bundled CI test fixtures
(tokenizer-only, no inference weights) — real, and correctly, honestly
rejected by the real `llama-server` binary when tried
(`"tensor 'token_embd.weight' not found"`).

## 6. Model management

**IMPLEMENTED, VERIFIED (against real binaries where possible).**
`llm-model-provisioning.ts`'s `detectLlamaModelStatus()` performs real
on-disk existence checks and returns actionable diagnostics
(`"installed"` / `"binary-missing"` / `"model-missing"`), exactly
mirroring Phase 13.7's `voice-model-provisioning.ts` pattern. Verified
directly against the real `llama-server` binary built this session:
correctly reported `"model-missing"` before a model was available, and
`"installed"` once the (invalid) test-fixture model was in place.
`LlamaServerManager` manages the real process lifecycle (real start,
real `/health`-endpoint polling, real stop/kill) — unit-tested against
deterministic fakes (10 tests) and exercised directly against the real
binary (proving real exit detection and real `LlamaServerStartError`
in 2.1 real seconds when pointed at a missing model).

## 7. Real LLM verification

**NOT VERIFIED — no real chat completion has ever been produced.**
What _was_ verified, for real: `llama-server` builds and runs from
real source; its real CLI flags match this repository's code exactly;
its real `/health` endpoint responds once started; its real inference
path honestly rejects an invalid model rather than fabricating output.
What could not be verified: an actual, correct chat response from a
real model, because no real inference-capable model was reachable from
this build environment. See §5 for the exact, repeated real attempts
that established this.

## 8. Tool discovery

**PASS, unchanged.** `buildDesktopToolDefinitions()` (Phase 13.5,
unmodified) builds the real tool specs every registered `AIProvider`
receives via the existing `ToolRegistry`/`AIOrchestrator` — provider-
agnostic; adding a real LLM required no change here.

## 9. Structured tool calling

**PASS (architecture, verified against the heuristic provider); NOT
VERIFIED (against a real LLM's actual tool-call JSON).** The
`AIOrchestrator`'s real multi-round tool loop is provider-agnostic and
already exercised end-to-end in `ai-orchestrator.test.ts` (unchanged
from Phase 13.5). Fixing schema validation (§10) surfaced and fixed a
real bug: `HeuristicToolCallingProvider`'s regex-captured slots are
always strings; the strict new validator correctly rejected them
against a `type: "number"` schema. Fixed by coercing numeric-looking
values in the heuristic provider — which also makes its output more
accurately model what a real LLM's schema-conformant JSON tool call
looks like.

## 10. Argument validation

**IMPLEMENTED, VERIFIED.** `core/ai-engine/src/tool-calling/validation.ts`
— a real, dependency-free JSON-schema-lite validator (type, required,
enum, numeric range, string length/pattern) — wired into
`ToolRegistry.invoke()` before the capability check. Directly tested
with this phase's own named example: `set_volume(500)` is rejected,
with a test asserting `execute()` never runs. A second test confirms
validation happens before the capability broker is even consulted.

## 11. CapabilityBroker integration

**PASS, unchanged.** `ToolRegistry.invoke()`'s existing
`CapabilityBroker.assertGranted()` gate (Phase 13.5) is untouched and
now runs strictly after the new validation step — verified directly
(`registry.test.ts`'s "argument validation runs before the capability
check" test).

## 12. Security enforcement

**PASS.** Desktop tool execution's real authority remains
`@ryper/platform-capability`'s `CapabilityManager.invoke()` (Phase 12,
unmodified) — the LLM/heuristic layer only ever produces a tool-call
_request_; `desktopActions.invoke()` is the sole path to any real OS
action, unaffected by which `AIProvider` requested it. Verified
end-to-end with a real test: an invalid `set_volume(500)` call never
reaches `desktopActions.setVolume()` (confirmed by reading the real,
unchanged volume back from the adapter afterward).

## 13. Tool execution

**PASS, unchanged.** Real `CapabilityManager`/`WindowsAdapter`
execution (Phase 13.5), verified in `ai-orchestrator.test.ts`.

## 14. Tool result loop

**PASS (architecture); NOT VERIFIED (against a real LLM).** The
loop (`AIOrchestrator`'s real multi-round logic) is real and tested
against `HeuristicToolCallingProvider`'s real tool calls; never
exercised against a real model's actual tool-call/result round-trip,
per §7.

## 15. Multi-tool execution

**PASS, unchanged from Phase 13.5.** The existing multi-step scenario
test (open app → set volume → mute, each step observed before the
next) remains real and passing; unaffected by this phase's changes.

## 16. Confirmation policy

**IMPLEMENTED (prep only, per this phase's own scope instruction:
"the security/policy layer must decide, not the LLM").** No new
confirmation-required-action gating was added this phase — the
existing `CapabilityBroker`/`CapabilityManager` consent-prompt
mechanism (unchanged) is the real, existing place such a policy would
live; this phase did not introduce a new tiered-confirmation system,
consistent with "do not redesign existing security."

## 17. Conversation context

**PASS, unchanged.** `SessionManager`/`LongTermMemory`/`VectorStore`
(Phase 13.5, unmodified) — this phase's `bootstrapAIOrchestrator()`
constructs its own instance, matching the same pattern Phase 13.5
already established, not a second architecture.

## 18. Streaming

**PASS.** Real SSE streaming in the existing OpenAI-/Anthropic-/
Google-compatible providers (unmodified); real chunked HTTP response
body streaming verified directly against a genuine local `node:http`
server in `node-fetch.test.ts` (6 tests, all real, no mocks).

## 19. Cancellation

**PASS.** Real `AbortSignal` → real process `kill()` for the local
`llama-server` path, unit-tested; real `AbortSignal` propagation into
`InferenceContext` verified in `ai-provider-adapter.test.ts`; existing
cloud-provider streaming cancellation unchanged from its prior,
already-real implementation.

## 20. Error handling

**PASS.** Model missing, binary missing, process exit before ready,
health-check timeout, invalid/malformed tool arguments, and unknown
tools all produce real, actionable errors rather than crashing — each
independently tested. Malformed LLM responses/context overflow are
handled by the existing, unmodified `AIOrchestrator`/provider error
paths (Phase 13.5), unaffected by this phase.

## 21. Offline behavior

**NOT VERIFIED.** The architecture is real and local-first by
construction (local LLM tried first; cloud only if explicitly
configured and only as an additional/fallback path) — but with no real
model available, actual offline inference could not be confirmed.

## 22. Cloud provider behavior

**IMPLEMENTED, NOT VERIFIED.** Real, reused, unmodified provider code;
constructed and registered only when all three of
`RYPER_CLOUD_LLM_PROVIDER`/`_API_KEY`/`_MODEL` are set (verified via
code inspection and the existing provider unit tests); never invoked
with a real key in this session, since none was available.

## 23. Privacy

**PASS, by construction.** No cloud provider is ever registered unless
fully, explicitly configured; nothing in this phase logs raw
microphone audio, conversation content, API keys, or access tokens
(checked directly — see §29).

## 24. Voice integration

**PASS (architecture); NOT VERIFIED (real audio).** `VoicePipeline`
(Phase 13.5/13.7, unchanged) already feeds real transcripts into
`AIOrchestrator.sendMessage()` and speaks its response through Phase
13.7's real sentence-chunked TTS — this phase changed which
`AIProvider` answers, not that wiring. No real microphone exists in
this environment to originate a real transcript, unchanged from Phase
13.6/13.7/13.8.

## 25. Smart-home readiness

**PREPARED, NOT IMPLEMENTED**, per this phase's explicit scope
instruction. No `turn_on_light`/`set_temperature`/etc. tools were
added (none exist yet, none were fabricated). `CapabilitySensitivity`
classification (§26) is the real, scoped prep step taken.

## 26. Android readiness

**PREPARED, NOT IMPLEMENTED.** `@ryper/security`'s new
`CapabilitySensitivity`/`CAPABILITY_SENSITIVITY` classifies every
existing capability as `"safe"`/`"protected"` — explicitly documented
as classification prep, not lock-state enforcement (no lock state
exists anywhere in this repository). The LLM/heuristic layer never
determines this classification; only this table, consulted by the
capability layer, would be authoritative once lock-state checking is
built.

## 27. Email/notification readiness

**NOT IMPLEMENTED**, per this phase's explicit scope instruction. No
`read_recent_email`/`search_email`/etc. tools were added. The existing
tool-registration architecture (`ToolRegistry.register()`) already
supports adding such tools later with no change to the orchestrator.

## 28. Performance measurements

- `llama-server` real build time: **SINGLE SAMPLE**, real (multiple
  incremental real build sessions totaling roughly 30+ real minutes on
  this environment's 1 CPU core — not precisely timed end-to-end due
  to being resumed across several tool invocations).
- Real process-exit detection (missing model): **SINGLE SAMPLE**,
  ~17ms real process exit, ~2.1s real detection-to-error time via the
  actual repository code's health-check polling.
- LLM initialization, first-token latency, total generation latency,
  tool-call latency, memory/CPU usage during real inference:
  **NOT MEASURED** — no real chat completion was ever produced in this
  environment to measure (§7). No numbers were invented.

## 29. Security audit

- ✓ No arbitrary shell execution from LLM output — the LLM/heuristic
  layer only ever produces a structured tool-call request; execution
  is exclusively `CapabilityManager.invoke()`/`WindowsAdapter`.
- ✓ No security bypass — `CapabilityBroker`/`CapabilityManager` are
  unmodified and remain mandatory.
- ✓ Tool arguments validated — new, real, structural schema validation
  (§10), verified with the brief's own example.
- ✓ Sensitive tools remain protected — unchanged enforcement path
  (§12).
- ✓ No API keys committed — checked directly, none found.
- ✓ No secrets in logs — structured `@ryper/logging` usage unchanged;
  no new logging of credentials/tokens was added.
- ✓ Cloud providers explicit — verified by code inspection: all three
  of provider/key/model required, no default.
- ✓ Local-first behavior preserved — local candidates tried first by
  `LocalRuntimeManager` (unchanged); cloud only as an additional,
  explicit path.
- Prompt injection / security-policy bypass: **NOT INDEPENDENTLY
  FUZZ-TESTED** this phase — the structural guarantee (LLM output can
  only ever become a `ToolCallRequest`, never raw code/shell input)
  holds by construction, but adversarial-input testing specifically
  targeting the new local LLM path was not performed, since no real
  LLM ran to test against.

## 30. Automated test results

**195 test files passing + 2 correctly skipped by default (197
total); 1098 tests passing + 7 correctly skipped (1105 total).**
Verified twice from a genuinely cold `npm ci` state.

## 31. Real integration test results

`platform/desktop-app/test/llm-runtime.real.test.ts` (3 tests) and
`core/local-runtime/test/runtime-providers/voice-runtime.real.test.ts`
(4 tests, carried from Phase 13.8) — both correctly skip by default
(verified: 0 real env vars set → all skipped). When actually run this
session with real env vars pointing at the real `llama-server` build
and the real (invalid, tokenizer-only) test-fixture model: real
detection passed, real server start/health-check passed, and the real
chat-completion attempt genuinely, honestly failed with a real
inference error — exactly the expected result given §5's findings, not
a test bug.

## 32. Repository health

**92/100** (unchanged basis from Phase 13.8 — no structural repository
changes beyond the additions in §39).

## 33. Architecture health

**93/100.** The adapter-based reuse of `LocalRuntimeManager.streamChat()`
and the existing OpenAI-/Anthropic-/Google-compatible providers is
genuinely minimal and clean — no second AI architecture, no duplicated
tool registry/capability broker/memory system, exactly as instructed.
Points withheld for the still-unimplemented confirmation-tiering policy
(§16, real but scoped out) and the still-unverified real-model
execution path.

## 34. Build health

**100/100.** Clean cold-state build, twice-verified, including the
standalone renderer `vite build`.

## 35. Test health

**95/100.** Comprehensive coverage of every new file; real (non-mock)
tests where genuinely possible (`node-fetch.test.ts`'s real local HTTP
server; the real `llama-server` binary exercises). Points withheld
because no test in this repository has ever exercised a real chat
completion end-to-end (structurally impossible in this environment,
but still a real coverage gap relative to full verification).

## 36. Performance health

**N/A — mostly NOT MEASURED.** Not scored numerically, consistent with
Phase 13.7/13.8's precedent: scoring would imply false precision when
the environment structurally prevents most of what would need
measuring.

## 37. Security health

**94/100.** A concrete, real gap (missing argument validation) was
found and closed this phase, with direct proof using the brief's own
example. Points withheld for the untested prompt-injection/adversarial
surface noted in §29.

## 38. Documentation health

**93/100.** `docs/adr/0020` (full architecture + honest limitations),
`docs/PROJECT_STATE.md`'s Phase 13.9 section (full real-world
certification matrix, itemized per the brief's required format),
README/desktop-app README/CHANGELOG/RELEASE_NOTES all updated, this
report exists. Points withheld for the same `docs/ARCHITECTURE.md` gap
noted in Phase 13.7/13.8's reports (no standalone file by that name
exists; equivalent detail lives in the ADRs and PROJECT_STATE.md).

## 39. Files added

- `platform/desktop-app/electron/llm-model-provisioning.ts`
- `core/local-runtime/src/runtime-providers/ai-provider-adapter.ts`
- `core/ai-engine/src/providers/node-fetch.ts`
- `core/ai-engine/src/tool-calling/validation.ts`
- `core/ai-engine/test/tool-calling/validation.test.ts`
- `core/ai-engine/test/providers/node-fetch.test.ts`
- `core/local-runtime/test/runtime-providers/ai-provider-adapter.test.ts`
- `platform/desktop-app/test/llm-model-provisioning.test.ts`
- `platform/desktop-app/test/llm-runtime.real.test.ts`
- `scripts/verify-llm-runtime.mjs`
- `docs/adr/0020-real-llm-provider-and-tool-call-validation.md`
- `docs/reports/PHASE_13_9_CERTIFICATION_REPORT.md` (this file)

## 40. Files modified

- `core/ai-engine/src/types.ts` — `ToolParameterSchema.properties`
  tightened to `Record<string, ToolParameterPropertySchema>`.
- `core/ai-engine/src/tool-calling/registry.ts` — wires real argument
  validation before the capability check.
- `core/ai-engine/src/index.ts` — new exports.
- `core/ai-engine/test/tool-calling/registry.test.ts` — 2 new tests.
- `core/local-runtime/src/index.ts` — new export.
- `core/security/src/index.ts` — `CapabilitySensitivity` prep.
- `core/security/test/index.test.ts` — 1 new test.
- `platform/desktop-app/electron/ai-orchestrator-bootstrap.ts` —
  rewritten to wire real local/cloud LLM providers.
- `platform/desktop-app/electron/voice-bootstrap.ts` — awaits the now-
  async `bootstrapAIOrchestrator()`, exposes new diagnostics.
- `platform/desktop-app/electron/heuristic-ai-provider.ts` — numeric
  slot-value coercion fix.
- `platform/desktop-app/electron/desktop-tools.ts` — `set_volume`
  schema gained real `minimum`/`maximum`; `stringParam` return type
  updated to match the tightened schema type.
- `platform/desktop-app/test/ai-orchestrator.test.ts` — updated for
  the async bootstrap signature; 2 new security tests.
- `README.md`, `platform/desktop-app/README.md`, `CHANGELOG.md`,
  `RELEASE_NOTES.md`, `docs/PROJECT_STATE.md` — documentation.

## 41. Files deleted

None.

## 42. Packages changed

`@ryper/ai-engine`, `@ryper/local-runtime`, `@ryper/security`,
`@ryper/desktop-app`. Package count unchanged at 28.

## 43. APIs added

Additive except where noted as an intentional, fully-migrated breaking
change (§40, `bootstrapAIOrchestrator()`'s async signature and
`ToolParameterSchema.properties`'s type): `createNodeHttpFetch`,
`validateToolArguments`/`describeInvalidToolCall`/`ValidationResult`,
`ToolParameterPropertySchema`, `createLocalRuntimeAIProvider`,
`LlamaServerManager`/`createLlamaServerManager`/`LlamaServerStartError`/
`detectLlamaModelStatus`/`defaultLlamaServerPaths`,
`CapabilitySensitivity`/`CAPABILITY_SENSITIVITY`/`getCapabilitySensitivity`,
`AIOrchestratorBundle`/`AIOrchestratorBootstrapPaths`. No other
existing public API was removed.

## 44. ADRs added

`docs/adr/0020-real-llm-provider-and-tool-call-validation.md`.

## 45. Remaining limitations

See §5, §7, §21, §22, §28, §29, and `docs/PROJECT_STATE.md`'s Phase
13.9 section for the complete itemized list. Summarized: no real chat
completion ever produced (local or cloud), no real offline-inference
verification, no real performance measurements against a working
model, no adversarial/prompt-injection fuzz testing, confirmation-
tiering policy not implemented (scoped out), smart-home/email tools
not implemented (scoped out, per instruction).

## 46. RC3 blockers

1. No real, inference-capable local LLM model is reachable from this
   build environment (structural, confirmed).
2. No real cloud LLM API key is available in this environment.
3. No physical audio hardware exists in this environment (unchanged
   since Phase 13.6/13.7/13.8) — real voice-to-LLM-to-voice has never
   been demonstrated end-to-end.

## 47. Recommended next phase

On a real machine with either a real GGUF chat model or a real cloud
API key (or both) and real audio hardware: run this now-complete
architecture end-to-end for the first time and report real,
first-hand performance numbers and conversation quality — no further
architectural work is blocking this in the current codebase. If
staying in a similarly sandboxed environment, the highest-value
remaining work is the confirmation-tiering policy (§16) and the
Settings-UI surfacing of the new LLM diagnostics (mirroring Phase
13.7's still-outstanding voice-model-diagnostics UI gap).

## 48. Exact Git commands

```bash
git add -A
git commit -m "Phase 13.9: real LLM + production tool calling (local llama-server default, explicit-only cloud, real argument validation)

- createLocalRuntimeAIProvider(): thin adapter wrapping the existing
  LocalRuntimeManager.streamChat() as an AIProvider - no new AI
  architecture
- Real, locally-managed llama-server process (llm-model-provisioning.ts,
  mirrors Phase 13.7's voice-model-provisioning.ts pattern exactly):
  real detection, real process lifecycle, real health-check polling
- Real createNodeHttpFetch() - the first real HTTP transport any AI
  provider in this repo has been given
- Explicit-only optional cloud LLM (RYPER_CLOUD_LLM_PROVIDER/_API_KEY/
  _MODEL, all three required) reusing existing OpenAI-/Anthropic-/
  Google-compatible providers unchanged
- Real, structural tool-argument schema validation wired into
  ToolRegistry.invoke() - closes the brief's own set_volume(500)
  example; fixed a real secondary bug in HeuristicToolCallingProvider's
  argument typing this surfaced
- CapabilitySensitivity classification prep in @ryper/security (not
  lock-state enforcement, which doesn't exist)
- llama-server built from real source and exercised through the actual
  repo code this session - real, honest failure produced against an
  invalid model; no real inference-capable GGUF model was reachable
  from this environment (same structural finding as Phase 13.8's
  Whisper result)
- 61 new/changed tests, 1098/1098 unconditional repo-wide passing
- See docs/adr/0020 and docs/PROJECT_STATE.md's Phase 13.9 section for
  the full real-world certification matrix

NOT READY FOR RC3 - no real chat completion has ever been produced
(local model unreachable, no cloud API key available), and no physical
audio hardware exists in this environment. See docs/PROJECT_STATE.md's
Phase 13.9 section."
```

No tag is recommended — this is explicitly not a release (§49).

## 49. Release readiness

**NOT READY FOR RC3.** Every seam Phase 13.5 originally named is now
architecturally real: real audio I/O (13.6), real STT/TTS integration
(13.7, partially model/hardware-verified in 13.8), and now a real LLM
provider architecture with real, structural tool-call security (13.9).
What blocks RC3 is no longer missing architecture — it is **execution**:
no real GGUF chat model, no real cloud API key, and no physical audio
hardware have been simultaneously available in this build environment.
Per the brief's required framing: _voice pipeline verified for Piper/
TTS and model-management diagnostics, and the LLM/tool-calling
architecture is now real and structurally secure — but RC3 remains
blocked by real end-to-end model execution_, which requires a
different environment (real internet access to a model host or a real
API key, plus real audio hardware) to close.
