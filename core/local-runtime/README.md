# @ryper/local-runtime — Local AI Runtime & Model Management

Phase 4 of RYPER AI OS. This package runs on-device AI models and exposes
them through one unified interface — the Core AI Engine (`@ryper/ai-engine`)
never depends on llama.cpp, Ollama, ONNX Runtime, or MLX specifically.

It depends on `@ryper/ai-engine` (reusing its `HttpFetch`/SSE/`AIProvider`
types rather than duplicating them) and `@ryper/logging`/`@ryper/event-bus`.
No file in `@ryper/ai-engine` or any other existing package was modified.

## Responsibilities → files

| Responsibility                                                   | File(s)                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| Local Runtime Manager                                            | `src/runtime-manager.ts`                                 |
| Model Registry / Metadata Database                               | `src/model-registry.ts`                                  |
| Model Discovery                                                  | `src/model-discovery.ts`                                 |
| Model Download Manager                                           | `src/model-download-manager.ts`                          |
| Model Verification                                               | `src/model-verification.ts`                              |
| Model Versioning                                                 | `src/model-versioning.ts`                                |
| Model Update Manager / Rollback / Export / Import                | `src/model-manager.ts`                                   |
| Model Cache / Disk usage / Storage cleanup                       | `src/model-cache.ts`                                     |
| Runtime Health Monitor                                           | `src/health-monitor.ts`                                  |
| GPU/CPU Capability Detection                                     | `src/capability-detection.ts`                            |
| Memory Availability Detection                                    | `src/capability-detection.ts` (`freeRamGB`)              |
| Runtime Scheduler / Inference Queue / Concurrent Request Manager | `src/inference-queue.ts`                                 |
| Runtime Configuration                                            | constructor options on `LocalRuntimeManager` (see below) |
| Offline Status Detection                                         | `src/offline-status.ts`                                  |
| Model Selection (policy-driven)                                  | `src/model-selection-policy.ts`                          |

## Local model providers (runtime adapters)

| Runtime              | File                                   | Notes                                                                                                                                                                                                                                           |
| -------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| llama.cpp-compatible | `src/runtime-providers/llama-cpp.ts`   | llama.cpp's server speaks the OpenAI wire format, so this wraps `@ryper/ai-engine`'s `createOpenAICompatibleProvider` directly.                                                                                                                 |
| Ollama-compatible    | `src/runtime-providers/ollama.ts`      | Wraps `@ryper/ai-engine`'s `createOllamaCompatibleProvider` for chat, adds a real `/api/embeddings` call.                                                                                                                                       |
| ONNX Runtime         | `src/runtime-providers/onnx.ts`        | Generic tensor-in/tensor-out orchestration around an **injected session** (`OnnxSessionLoader`) and per-task pipelines — mirrors `onnxruntime-node`'s real `InferenceSession.run()` shape so a real binding drops in with zero adapter changes. |
| MLX (Apple Silicon)  | `src/runtime-providers/mlx.ts`         | Generic orchestration around an **injected binding** (`MlxBinding`), gated by an injected Apple-Silicon capability check.                                                                                                                       |
| whisper.cpp (ASR)    | `src/runtime-providers/whisper-cpp.ts` | Real CLI child-process integration (Phase 13.7, `@ryper/desktop-app`) — spawns a real whisper.cpp binary via an **injected** `ProcessRunner`, wraps PCM into a real WAV file, reads the binary's real `.txt` output. Real kill-on-cancel.       |
| Piper (TTS)          | `src/runtime-providers/piper.ts`       | Real CLI child-process integration (Phase 13.7) — spawns a real Piper binary via the same injected `ProcessRunner`, real stdin text in, real WAV file out. Real kill-on-cancel.                                                                 |

All six implement the same `LocalRuntimeProvider` interface
(`src/types.ts`) — adding a fifth engine means implementing that interface
and passing an instance into `LocalRuntimeManager`'s `providers` array.
Nothing else changes.

**Why ONNX/MLX are injection-based:** this package was built in a sandboxed
Linux environment with no native ONNX Runtime binding and no MLX (Apple
Silicon only) available to compile or link against. Rather than write code
that can't be verified, the adapters take the native session/binding as a
constructor argument — exactly the same pattern `@ryper/ai-engine` already
uses for `HttpFetch`. The orchestration logic around that injected call
(choosing a pipeline, marshalling requests/results) is real and fully
tested; only the tensor math / native call itself is supplied by whoever
wires up the real binding on a machine that has it.

## Model types supported

Chat, embedding, ASR, TTS, OCR, vision, translation, and image-editing are
all represented in `ModelType` (`src/types.ts`) and in `LocalRuntimeManager`'s
per-task methods (`streamChat`, `embed`, `transcribe`, `synthesizeSpeech`,
`ocr`, `describeImage`, `translate`, `editImage`). A provider only needs to
implement the methods for the task types it actually serves.

## The integration point: `toAIProvider()`

```ts
import {
  createOllamaRuntimeProvider,
  LocalRuntimeManager,
  ModelSelector,
  RuntimeHealthMonitor,
  InferenceQueue,
  ModelCache,
  ModelRegistry,
} from "@ryper/local-runtime";
import { createAIOrchestrator, createProviderRegistry } from "@ryper/ai-engine";

const registry = new ModelRegistry();
// ... populate via ModelDiscoveryService + ModelManager.install(), or a bundled offline catalog ...

const runtimeManager = new LocalRuntimeManager({
  registry: new ModelSelector(registry),
  providers: [
    createOllamaRuntimeProvider({ id: "ollama", baseUrl: "http://localhost:11434" }, realHttpFetch),
  ],
  healthMonitor: new RuntimeHealthMonitor(),
  queue: new InferenceQueue(2),
  cache: new ModelCache(registry, nodeFileSystem, 20 * 1024 ** 3),
  cloudChatFallback: cloudAIProvider, // optional — only used for chat, only if the user has configured cloud fallback
});

const providers = createProviderRegistry();
providers.register(
  runtimeManager.toAIProvider("local", { device: await capabilityDetector.detect() }),
);
providers.register(cloudAIProvider);

// The Core AI Engine's orchestrator now has a "local" provider it can pick
// via @ryper/ai-engine's ModelSelectionEngine/ModelRouter exactly like any
// other provider — it never sees llama.cpp/Ollama/ONNX/MLX.
const orchestrator = createAIOrchestrator({
  providerRegistry: providers /* ...other Phase 3 wiring... */,
});
```

Non-chat task types (embeddings for `@ryper/rag`, OCR for the future
Documents module, ASR/TTS for the future Voice module) call
`runtimeManager.embed(...)`, `runtimeManager.ocr(...)`, etc. directly —
those modules depend on `@ryper/local-runtime`, not on any specific engine.

## Error handling and fallback, precisely scoped

- **Missing/corrupt models:** `ModelManager.verify()` and `ModelVerifier`
  distinguish `missing` / `size-mismatch` / `checksum-mismatch` so a caller
  can decide to re-download rather than silently serve a broken model.
  `ModelDownloadManager` refuses to install anything that fails checksum
  verification in the first place (`ModelIntegrityError`).
- **Unsupported hardware / OOM risk:** `defaultModelSelectionPolicy` filters
  out any model whose `minRamGB`/`requiresGpu` the device can't meet before
  it's ever a candidate — the manager never attempts to run a model on
  hardware that can't fit it.
- **Runtime crashes / provider failures:** `LocalRuntimeManager` tries each
  eligible (model, provider) candidate in order, recording every
  success/failure with `RuntimeHealthMonitor`; a provider that trips the
  "unavailable" threshold is skipped on subsequent calls until it succeeds
  again. Single-shot tasks (embed/ocr/translate/asr/tts/vision/image-edit)
  retry across candidates transparently via `runWithFallback`.
- **Streaming chat is handled more carefully:** once any token has streamed
  from a provider, a later failure from that same provider is surfaced as
  an error rather than silently retried against a different one (avoids a
  duplicated/inconsistent reply) — mirroring the rule `@ryper/ai-engine`'s
  own orchestrator applies to cloud providers.
- **Falling back to cloud** happens only for chat, only after every local
  candidate has failed, and only if a `cloudChatFallback` was configured —
  never silently, and only when the offline-status detector (if configured)
  believes the network is actually reachable.
