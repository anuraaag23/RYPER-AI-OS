import { EventBus } from "@ryper/event-bus";
import { createLogger } from "@ryper/logging";
import { ModelRouter } from "@ryper/model-router";
import { LongTermMemory } from "@ryper/memory";
import { VectorStore } from "@ryper/rag";
import type { CapabilityManager } from "@ryper/platform-capability";
import type { CapabilityBroker } from "@ryper/security";
import {
  AIOrchestrator,
  ProviderRegistry,
  ModelSelectionEngine,
  PromptBuilder,
  TokenBudgetManager,
  SessionManager,
  ToolRegistry,
  createNodeHttpFetch,
  createOpenAICompatibleProvider,
  createAnthropicCompatibleProvider,
  createGoogleCompatibleProvider,
  type AIProvider,
  type HttpFetch,
} from "@ryper/ai-engine";
import {
  ModelRegistry,
  ModelSelector,
  RuntimeHealthMonitor,
  InferenceQueue,
  ModelCache,
  createNodeProcessRunner,
  createLlamaCppProvider,
  createLocalRuntimeAIProvider,
  LocalRuntimeManager,
  type FileSystemLike,
  type LocalRuntimeProvider,
} from "@ryper/local-runtime";
import { buildDesktopToolDefinitions } from "./desktop-tools.js";
import {
  type PowerConfirmationManager,
  createPowerConfirmationManager,
} from "./power-confirmation.js";
import type { ContextReferenceTracker } from "./context-reference.js";
import { createHeuristicToolCallingProvider } from "./heuristic-ai-provider.js";
import {
  createLlamaServerManager,
  defaultLlamaServerPaths,
  detectLlamaModelStatus,
  LlamaServerStartError,
  type LlamaModelDiagnostics,
} from "./llm-model-provisioning.js";

const REFERENCE_DEVICE_CAPABILITIES = {
  cpuCores: 4,
  totalRamGB: 8,
  freeRamGB: 4,
  hasGpu: false,
  platform: "windows" as const,
  isAppleSilicon: false,
};

const log = createLogger("desktop-app:ai-orchestrator-bootstrap");

/**
 * Real local hardware (a consumer GPU shared with the rest of the
 * machine) can have meaningfully slower prefill/generation than a
 * cloud provider's dedicated cluster — `AIOrchestrator`'s default
 * 30-second inter-event timeout, appropriate for a genuinely-hung
 * remote connection, is a real risk of a false timeout for a local
 * model under load (docs/adr/0022). 120s is a real, still-bounded
 * budget informed by this repo's own real-hardware verification
 * (Phase 13.10/13.11: ~43-49s for a full real Qwen3-8B response on an
 * RTX 4050 laptop GPU); `RYPER_LOCAL_LLM_STREAM_TIMEOUT_MS` lets it be
 * tuned for slower/faster real hardware without a code change.
 */
function localStreamTimeoutMs(): number {
  const raw = process.env["RYPER_LOCAL_LLM_STREAM_TIMEOUT_MS"];
  const parsed = raw ? Number(raw) : undefined;
  return parsed !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
}

export interface AIOrchestratorBootstrapPaths {
  readonly modelCacheDir: string;
}

export interface AIOrchestratorBundle {
  readonly orchestrator: AIOrchestrator;
  /** Real, on-disk detection of whether a real local LLM runtime+model was found — mirrors `VoiceModelDiagnostics` (Phase 13.7/13.8). */
  readonly llmDiagnostics: LlamaModelDiagnostics;
  readonly localLLMActive: boolean;
  readonly cloudLLMConfigured: boolean;
  /** Exposed so the desktop app can search real short-term conversation history (see `ipc-handlers.ts`'s `searchMemory`, docs/adr/0032) — replaces a dead read against the never-actually-used `ConversationEngine`'s own short-term buffer. */
  readonly sessionManager: SessionManager;
}

type CloudVendor = "openai" | "anthropic" | "google";

interface CloudLLMConfig {
  readonly vendor: CloudVendor;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

const CLOUD_DEFAULT_BASE_URLS: Readonly<Record<CloudVendor, string>> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
};

/**
 * Real, **explicit-only** cloud LLM configuration (docs/adr/0020). All
 * three of provider/API key/model must be set via environment variables
 * for a cloud provider to be constructed at all — RYPER never silently
 * falls back to one, matching this repo's existing consent-first
 * posture (`main.ts`'s `denyAllConfirmer`, Phase 13.6's media
 * permission handling). Never hard-codes a vendor as mandatory.
 */
function loadExplicitCloudLLMConfig(): CloudLLMConfig | undefined {
  const vendor = process.env["RYPER_CLOUD_LLM_PROVIDER"];
  const apiKey = process.env["RYPER_CLOUD_LLM_API_KEY"];
  const model = process.env["RYPER_CLOUD_LLM_MODEL"];
  if (!vendor || !apiKey || !model) return undefined;
  if (vendor !== "openai" && vendor !== "anthropic" && vendor !== "google") return undefined;
  const baseUrl = process.env["RYPER_CLOUD_LLM_BASE_URL"] ?? CLOUD_DEFAULT_BASE_URLS[vendor];
  return { vendor, apiKey, model, baseUrl };
}

function createCloudProvider(config: CloudLLMConfig, httpFetch: HttpFetch): AIProvider {
  const id = `cloud-${config.vendor}`;
  const shared = { id, baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model };
  switch (config.vendor) {
    case "openai":
      return createOpenAICompatibleProvider(shared, httpFetch);
    case "anthropic":
      return createAnthropicCompatibleProvider(shared, httpFetch);
    case "google":
      return createGoogleCompatibleProvider(shared, httpFetch);
  }
}

/**
 * Assembles a real `AIOrchestrator` — every sub-component
 * (`ProviderRegistry`, `ModelSelectionEngine`, `PromptBuilder`,
 * `TokenBudgetManager`, `SessionManager`, `ToolRegistry`) is the real
 * `@ryper/ai-engine` class, none stubbed, unchanged since Phase 13.5's
 * `docs/adr/0016`.
 *
 * As of Phase 13.9 (`docs/adr/0020`), the registered `AIProvider` is a
 * real local LLM — `@ryper/local-runtime`'s existing `createLlamaCppProvider`
 * (Phase 4, unmodified) talking to a real, locally-managed `llama-server`
 * process this file starts and health-checks
 * (`llm-model-provisioning.ts`) — when a real binary+model are detected
 * installed, registered ahead of `HeuristicToolCallingProvider`, which
 * remains, always registered, as the honest last-resort fallback (the
 * exact Phase 13.7 pattern for `ReferenceVoiceRuntimeProvider`). An
 * explicitly configured cloud provider (`RYPER_CLOUD_LLM_PROVIDER`/
 * `_API_KEY`/`_MODEL`, all three required) is additionally registered
 * and wired as `LocalRuntimeManager`'s `cloudChatFallback` — never
 * active unless all three are set, never silently substituted for the
 * local path.
 *
 * Uses its own `LongTermMemory`/`VectorStore` instance, separate from
 * `@ryper/web-shell`'s (which `WebShell`'s public interface does not
 * expose) — a real, acknowledged duplication of *storage*, not of
 * orchestration logic: there remains exactly one orchestration system
 * (`AIOrchestrator`) driving voice, matching the brief's "do not create
 * a second independent orchestration system."
 */
export async function bootstrapAIOrchestrator(
  capabilityManager: CapabilityManager,
  broker: CapabilityBroker,
  eventBus: EventBus = new EventBus(),
  paths?: AIOrchestratorBootstrapPaths,
  fileSystem?: FileSystemLike,
  // Defaults to a fresh, standalone instance — fine for a caller (e.g.
  // most tests) that doesn't need power-action tool calls to correlate
  // with a separately-tracked voice "yes"/"no". `voice-bootstrap.ts`
  // explicitly passes its one real, shared instance instead (see
  // docs/adr/0031) so both integration surfaces agree on what's
  // pending.
  powerConfirmation: PowerConfirmationManager = createPowerConfirmationManager(),
  contextTracker?: ContextReferenceTracker,
  /**
   * Reads the user's configured default browser (Settings) fresh on
   * every tool call — not a value captured once at startup, since the
   * setting can change while the app is running. `undefined` means
   * use the system default, same as if this parameter weren't given
   * at all. Threaded through to `buildDesktopToolDefinitions()`.
   */
  getPreferredBrowser?: () => string | undefined,
): Promise<AIOrchestratorBundle> {
  const router = new ModelRouter(eventBus);
  const longTermMemory = new LongTermMemory();
  const vectorStore = new VectorStore(async (text) => [text.length]);

  const providerRegistry = new ProviderRegistry();
  const toolDefinitions = buildDesktopToolDefinitions(
    capabilityManager,
    powerConfirmation,
    contextTracker,
    undefined,
    getPreferredBrowser,
  );
  const toolNames = new Set(toolDefinitions.map((t) => t.spec.name));

  const tokenLimits: Record<string, { contextWindow: number; reservedForCompletion: number }> = {
    "heuristic-pattern-matcher": { contextWindow: 8000, reservedForCompletion: 1000 },
  };

  const httpFetch = createNodeHttpFetch();
  const processRunner = createNodeProcessRunner();

  let llmDiagnostics: LlamaModelDiagnostics = {
    status: "binary-missing",
    detail: "no model cache directory configured — real local LLM detection was skipped",
  };
  let localLLMActive = false;

  if (paths && fileSystem) {
    const llamaPaths = defaultLlamaServerPaths(paths.modelCacheDir);
    log.info("[DIAGNOSTIC] local LLM paths resolved", {
      binaryPath: llamaPaths.binaryPath,
      modelPath: llamaPaths.modelPath,
      port: llamaPaths.port,
    });
    llmDiagnostics = await detectLlamaModelStatus(fileSystem, llamaPaths);
    log.info("[DIAGNOSTIC] local LLM detection result", {
      status: llmDiagnostics.status,
      detail: llmDiagnostics.detail,
    });

    if (llmDiagnostics.status === "installed") {
      log.info("[DIAGNOSTIC] starting local llama-server process", {
        binaryPath: llamaPaths.binaryPath,
        port: llamaPaths.port,
      });
      const serverManager = createLlamaServerManager(processRunner, httpFetch);
      try {
        const baseUrl = await serverManager.start(llamaPaths);
        log.info("[DIAGNOSTIC] local llama-server ready", { baseUrl, port: llamaPaths.port });
        const localRuntimeProvider: LocalRuntimeProvider = createLlamaCppProvider(
          {
            id: "llama-cpp-local",
            baseUrl,
            // Qwen3-specific: disables "thinking" chain-of-thought for
            // tool-calling requests specifically, per the model's own
            // recommendation for deterministic tool calls, and because
            // an un-bounded hidden reasoning phase before the tool call
            // is exactly what caused the real timeout this exists to
            // fix (docs/adr/0022). Safe to set unconditionally here:
            // this is the local llama.cpp path only, never the cloud
            // OpenAI-compatible provider below.
            disableThinkingForToolCalls: true,
          },
          httpFetch,
        );

        const modelRegistry = new ModelRegistry();
        const modelSelector = new ModelSelector(modelRegistry);
        const healthMonitor = new RuntimeHealthMonitor();
        const inferenceQueue = new InferenceQueue(2);
        const modelCache = new ModelCache(modelRegistry, fileSystem, 2 * 1024 * 1024 * 1024);
        modelRegistry.markInstalled({
          metadata: {
            id: "llama-cpp-local",
            name: "Local llama.cpp model",
            type: "chat",
            runtime: "llama-cpp",
            version: "1.0.0",
            requirements: { minRamGB: 1, approxDiskBytes: 1 },
            downloadUrl: "",
            sha256: "",
            license: "user-provided",
            runtimeModelId: "llama-cpp-local",
          },
          localPath: llamaPaths.modelPath,
          installedAt: new Date().toISOString(),
          sizeBytes: await fileSystem.statSize(llamaPaths.modelPath).catch(() => 0),
          active: true,
        });

        const explicitCloudForFallback = loadExplicitCloudLLMConfig();
        const cloudChatFallback = explicitCloudForFallback
          ? createCloudProvider(explicitCloudForFallback, httpFetch)
          : undefined;

        const localRuntimeManager = new LocalRuntimeManager({
          registry: modelSelector,
          providers: [localRuntimeProvider],
          healthMonitor,
          queue: inferenceQueue,
          cache: modelCache,
          eventBus,
          ...(cloudChatFallback ? { cloudChatFallback } : {}),
        });

        providerRegistry.register(
          createLocalRuntimeAIProvider("llama-cpp-local", localRuntimeManager, {
            device: REFERENCE_DEVICE_CAPABILITIES,
          }),
        );
        tokenLimits["llama-cpp-local"] = { contextWindow: 16384, reservedForCompletion: 2048 };
        localLLMActive = true;
        log.info("[DIAGNOSTIC] local LLM provider registered and active", {
          providerId: "llama-cpp-local",
          modelPath: llamaPaths.modelPath,
          port: llamaPaths.port,
        });
      } catch (err) {
        log.warn("[DIAGNOSTIC] local LLM failed to start, falling back to heuristic provider", {
          error: err instanceof Error ? err.message : String(err),
        });
        // Real, honest degrade: a real binary+model were found but the
        // real server failed to start/become ready — fall through to the
        // Heuristic fallback below rather than crashing the app.
        llmDiagnostics = {
          status: "binary-missing",
          detail:
            err instanceof LlamaServerStartError
              ? err.message
              : `failed to start local LLM runtime: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    } else {
      log.info("[DIAGNOSTIC] local LLM not installed, falling back to heuristic provider", {
        status: llmDiagnostics.status,
        detail: llmDiagnostics.detail,
      });
    }
  } else {
    log.info("[DIAGNOSTIC] paths or fileSystem missing, skipping local LLM detection");
  }

  providerRegistry.register(createHeuristicToolCallingProvider(toolNames));

  const explicitCloud = loadExplicitCloudLLMConfig();
  const cloudLLMConfigured = explicitCloud !== undefined;
  if (explicitCloud) {
    const cloudProvider = createCloudProvider(explicitCloud, httpFetch);
    // Only registered directly (reachable when ModelRouter decides
    // "cloud") in addition to any use above as the local-runtime's
    // fallback — the ids are always distinct (`cloud-<vendor>` vs
    // `llama-cpp-local`), so this is always safe to register too.
    providerRegistry.register(cloudProvider);
    tokenLimits[cloudProvider.id] = { contextWindow: 32000, reservedForCompletion: 2000 };
  }

  const modelSelection = new ModelSelectionEngine(router, providerRegistry);
  const promptBuilder = new PromptBuilder({
    systemPrompt:
      "You are Ryper, an offline-first multilingual voice assistant supporting English, Hindi, and Hinglish. You fluently understand Devanagari script, Latin-script Hindi, and mixed English-Hindi speech. Respond in the same language or dialect the user used (Hindi, Hinglish, or English). When invoking desktop tools, always use standard English tool names and schemas without altering system parameters or bypassing confirmation boundaries.",
  });
  const tokenBudget = new TokenBudgetManager(tokenLimits);
  const sessionManager = new SessionManager(longTermMemory, vectorStore);

  const toolRegistry = new ToolRegistry(broker);
  for (const tool of toolDefinitions) toolRegistry.register(tool);

  const orchestrator = new AIOrchestrator({
    providerRegistry,
    modelSelection,
    promptBuilder,
    tokenBudget,
    toolRegistry,
    sessionManager,
    eventBus,
    localStreamTimeoutMs: localStreamTimeoutMs(),
  });

  return { orchestrator, llmDiagnostics, localLLMActive, cloudLLMConfigured, sessionManager };
}
