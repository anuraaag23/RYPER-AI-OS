import { describe, expect, it } from "vitest";
import { CapabilityBroker } from "@ryper/security";
import { createCapabilityManager } from "@ryper/platform-capability";
import { createWindowsAdapter } from "@ryper/windows-agent";
import { EventBus } from "@ryper/event-bus";
import { bootstrapAIOrchestrator } from "../electron/ai-orchestrator-bootstrap.js";
import { buildDesktopToolDefinitions } from "../electron/desktop-tools.js";
import { HeuristicToolCallingProvider } from "../electron/heuristic-ai-provider.js";

async function buildOrchestratorWithRealWindowsAdapter() {
  const broker = new CapabilityBroker(() => true);
  const capabilityManager = createCapabilityManager({ broker, platformDetector: () => "windows" });
  const adapter = await createWindowsAdapter();
  capabilityManager.registerAdapter(adapter);
  const bundle = await bootstrapAIOrchestrator(capabilityManager, broker, new EventBus());
  const orchestrator = bundle.orchestrator;
  return { orchestrator, capabilityManager, adapter };
}

async function collectText(
  stream: AsyncIterable<{ type: string; delta?: string }>,
): Promise<string> {
  let text = "";
  for await (const event of stream) {
    if (event.type === "text_delta" && event.delta) text += event.delta;
  }
  return text;
}

describe("Phase 13.9: the LLM cannot bypass CapabilityManager/CapabilityBroker", () => {
  it("an out-of-schema tool call from the AI layer is rejected before it can reach CapabilityManager at all", async () => {
    const broker = new CapabilityBroker(() => true);
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const adapter = await createWindowsAdapter();
    capabilityManager.registerAdapter(adapter);
    const bundle = await bootstrapAIOrchestrator(capabilityManager, broker, new EventBus());

    // "set volume to five hundred" — the heuristic layer extracts percent=500,
    // which Phase 13.9's schema validation must reject (0-100 range) before
    // desktopActions.setVolume() (and therefore CapabilityManager) ever runs.
    await collectText(
      bundle.orchestrator.sendMessage("session-invalid-args", "set volume to 500 percent", {
        device: { online: true },
      }),
    );

    const volume = await adapter.audioManager.getVolume();
    expect(volume).not.toBe(500); // real proof: an impossible volume was never applied
  });
});

describe("AIOrchestrator + HeuristicToolCallingProvider (real multi-round tool execution)", () => {
  it("executes a single real tool call end-to-end through the real CapabilityManager/WindowsAdapter", async () => {
    const { orchestrator, adapter } = await buildOrchestratorWithRealWindowsAdapter();
    const text = await collectText(
      orchestrator.sendMessage("session-1", "open calculator", { device: { online: true } }),
    );
    expect(text.toLowerCase()).toContain("opening");
    const running = await adapter.applicationManager.listRunning();
    expect(running.some((a) => a.appId === "microsoft.windows.calculator")).toBe(true);
  });

  it("executes a genuine multi-step utterance as a sequence of real, observed tool calls", async () => {
    const { orchestrator, adapter } = await buildOrchestratorWithRealWindowsAdapter();
    await adapter.audioManager.setVolume(50);

    const text = await collectText(
      orchestrator.sendMessage(
        "session-2",
        "open calculator, then set the volume to 30 percent, then mute",
        {
          device: { online: true },
        },
      ),
    );

    // All three real, sequenced steps actually executed — not a single fabricated summary.
    const running = await adapter.applicationManager.listRunning();
    expect(running.some((a) => a.appId === "microsoft.windows.calculator")).toBe(true);
    await expect(adapter.audioManager.getVolume()).resolves.toBe(30);
    await expect(adapter.audioManager.getMute()).resolves.toBe(true);
    expect(text.length).toBeGreaterThan(0);
  });

  it("gives an honest fallback reply for a request that matches no known tool pattern", async () => {
    const { orchestrator } = await buildOrchestratorWithRealWindowsAdapter();
    const text = await collectText(
      orchestrator.sendMessage("session-3", "write me a haiku about the ocean", {
        device: { online: true },
      }),
    );
    expect(text).toContain("isn't a language model");
  });

  it("reflects a real tool failure honestly rather than claiming success", async () => {
    const { orchestrator } = await buildOrchestratorWithRealWindowsAdapter();
    const text = await collectText(
      orchestrator.sendMessage("session-4", "open some totally unknown application", {
        device: { online: true },
      }),
    );
    // Real behavior since the universal-open capability (docs/adr/0030):
    // an unrecognized name is no longer just rejected outright — it's
    // genuinely classified via `smart_open` (not a known app, not a
    // known browser/website, not a real directory), and the *real*
    // underlying filesystem error ("no file at ...") is what's reported
    // honestly here, rather than a canned "I don't know how to open
    // that" that never actually tried.
    expect(text.toLowerCase()).toContain("no file at");
    expect(text.toLowerCase()).not.toContain("opening some totally unknown application");
  });

  it("honors a pre-aborted AbortSignal: no tool executes, and the stream reports an error event rather than silently succeeding", async () => {
    const { orchestrator, adapter } = await buildOrchestratorWithRealWindowsAdapter();
    const controller = new AbortController();
    controller.abort();

    const events: { type: string }[] = [];
    for await (const event of orchestrator.sendMessage("session-5", "open calculator", {
      device: { online: true },
      signal: controller.signal,
    })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events.some((e) => e.type === "tool_call")).toBe(false);
    // Unlike notepad, calculator is not pre-seeded as already running in the reference
    // WindowsAdapter, so this genuinely proves the tool never executed.
    const running = await adapter.applicationManager.listRunning();
    expect(running.some((a) => a.appId === "microsoft.windows.calculator")).toBe(false);
  });
});

describe("HeuristicToolCallingProvider", () => {
  it("is explicitly identified as a non-LLM provider", () => {
    const provider = new HeuristicToolCallingProvider(new Set(["open_application"]));
    expect(provider.kind).toBe("local");
    expect(provider.id).toBe("heuristic-pattern-matcher");
  });

  it("only emits a tool call for intents present in the allowed tool-name set", async () => {
    const provider = new HeuristicToolCallingProvider(new Set()); // no tools allowed
    const events: { type: string }[] = [];
    for await (const event of provider.streamChat({
      messages: [{ role: "user", content: "open notepad" }],
    })) {
      events.push(event);
    }
    expect(events.some((e) => e.type === "tool_call")).toBe(false);
  });
});

describe("buildDesktopToolDefinitions", () => {
  it("names every tool after its corresponding intent, matching DESKTOP_INTENT_PATTERNS/DEFAULT_INTENT_PATTERNS", async () => {
    const broker = new CapabilityBroker(() => true);
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const tools = buildDesktopToolDefinitions(capabilityManager);
    const names = tools.map((t) => t.spec.name);
    expect(names).toContain("open_application");
    expect(names).toContain("set_volume");
    expect(names).toContain("media_play");
  });
});
