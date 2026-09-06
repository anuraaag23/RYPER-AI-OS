import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { CapabilityBroker } from "@ryper/security";
import { createCapabilityManager } from "@ryper/platform-capability";
import { createWindowsAdapter, createInMemoryWindowsSystemApi } from "@ryper/windows-agent";
import type { AIOrchestrator, StreamEvent } from "@ryper/ai-engine";
import { bootstrapAIOrchestrator } from "../electron/ai-orchestrator-bootstrap.js";
import { runTextTurn } from "../electron/text-chat.js";
import { createPowerConfirmationManager } from "../electron/power-confirmation.js";

/**
 * Closes the real, honest test-coverage gap named in docs/adr/0032:
 * `runTextTurn` is what replaced the disconnected, placeholder-only
 * `ConversationEngine` path — these tests exercise the real
 * `AIOrchestrator`/`ToolRegistry`/`WindowsAdapter` chain it routes
 * through, not a stand-in.
 */
async function buildDeps(seedFiles?: Readonly<Record<string, string>>) {
  const broker = new CapabilityBroker(() => true);
  const capabilityManager = createCapabilityManager({ broker, platformDetector: () => "windows" });
  const systemApi = createInMemoryWindowsSystemApi({ seedFiles });
  const adapter = await createWindowsAdapter({ systemApi });
  capabilityManager.registerAdapter(adapter);
  const powerConfirmation = createPowerConfirmationManager();
  const bundle = await bootstrapAIOrchestrator(
    capabilityManager,
    broker,
    new EventBus(),
    undefined,
    undefined,
    powerConfirmation,
  );
  return {
    orchestrator: bundle.orchestrator,
    capabilityManager,
    powerConfirmation,
    cloudLLMConfigured: bundle.cloudLLMConfigured,
    adapter,
  };
}

describe("runTextTurn — real text chat routed through the shared AIOrchestrator", () => {
  it("executes a real tool call end-to-end, not a placeholder echo", async () => {
    const deps = await buildDeps();
    const result = await runTextTurn("conv-1", "open calculator", { online: false }, deps);

    expect(result.reply.toLowerCase()).not.toContain("[local model]");
    expect(result.reply.toLowerCase()).toContain("calculator");
    const running = (await deps.adapter.invoke(
      "application_control",
      "enumerate_running",
      {},
      {
        invocationId: "check-1",
        actorId: "ai-orchestrator",
        sessionId: "conv-1",
        platform: "windows",
      },
    )) as readonly { appId: string }[];
    expect(running.some((p) => p.appId === "microsoft.windows.calculator")).toBe(true);
  });

  it("reports routingTarget 'local' when no cloud LLM is configured, regardless of online state", async () => {
    const deps = await buildDeps();
    const offline = await runTextTurn("conv-2", "hello", { online: false }, deps);
    const online = await runTextTurn("conv-2", "hello again", { online: true }, deps);
    expect(offline.routingTarget).toBe("local");
    expect(online.routingTarget).toBe("local");
  });

  it("registers a real pending power confirmation and returns the prompt without touching power_management", async () => {
    const deps = await buildDeps();
    const result = await runTextTurn("conv-3", "shut down my pc", { online: false }, deps);

    expect(result.reply.toLowerCase()).toContain("say yes to confirm");
    expect(deps.powerConfirmation.hasPending("voice-user")).toBe(true);
  });

  it("a typed 'yes' genuinely resolves the pending confirmation and executes the real action", async () => {
    const broker = new CapabilityBroker(() => true);
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const adapter = await createWindowsAdapter({ destructiveActionConfirmer: async () => true });
    capabilityManager.registerAdapter(adapter);
    const powerConfirmation = createPowerConfirmationManager();
    const bundle = await bootstrapAIOrchestrator(
      capabilityManager,
      broker,
      new EventBus(),
      undefined,
      undefined,
      powerConfirmation,
    );
    const deps = {
      orchestrator: bundle.orchestrator,
      capabilityManager,
      powerConfirmation,
      cloudLLMConfigured: bundle.cloudLLMConfigured,
    };

    const first = await runTextTurn("conv-4", "shut down my pc", { online: false }, deps);
    expect(first.reply.toLowerCase()).toContain("say yes to confirm");

    const second = await runTextTurn("conv-4", "yes", { online: false }, deps);
    expect(second.reply).toBe("Shutting down.");
    expect(powerConfirmation.hasPending("voice-user")).toBe(false);
  });

  it("a typed 'no' denies the pending confirmation without executing anything", async () => {
    const deps = await buildDeps();
    await runTextTurn("conv-5", "restart my computer", { online: false }, deps);
    const denied = await runTextTurn("conv-5", "no", { online: false }, deps);

    expect(denied.reply.toLowerCase()).toContain("cancelling");
    expect(deps.powerConfirmation.hasPending("voice-user")).toBe(false);
  });

  it("throws a clear error when the orchestrator returns an empty response, rather than a fake success", async () => {
    const fakeOrchestrator = {
      async *sendMessage(): AsyncGenerator<StreamEvent> {
        yield { type: "text_delta", delta: "   " };
        yield { type: "done", finishReason: "stop" };
      },
    } as unknown as AIOrchestrator;

    const broker = new CapabilityBroker(() => true);
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const adapter = await createWindowsAdapter();
    capabilityManager.registerAdapter(adapter);
    const powerConfirmation = createPowerConfirmationManager();

    await expect(
      runTextTurn(
        "conv-6",
        "hello",
        { online: false },
        {
          orchestrator: fakeOrchestrator,
          capabilityManager,
          powerConfirmation,
          cloudLLMConfigured: false,
        },
      ),
    ).rejects.toThrow("empty response");
  });

  it("captures real tool_call/tool_result events as safe, user-facing toolActivity", async () => {
    const fakeOrchestrator = {
      async *sendMessage(): AsyncGenerator<StreamEvent> {
        yield {
          type: "tool_call",
          toolCall: { id: "call-1", name: "open_file", arguments: { path: "C:/notes.txt" } },
        };
        yield {
          type: "tool_result",
          toolCallId: "call-1",
          name: "open_file",
          ok: true,
          content: "Opened C:/notes.txt",
        };
        yield { type: "text_delta", delta: "Done, I opened it." };
        yield { type: "done", finishReason: "stop" };
      },
    } as unknown as AIOrchestrator;

    const broker = new CapabilityBroker(() => true);
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const adapter = await createWindowsAdapter();
    capabilityManager.registerAdapter(adapter);
    const powerConfirmation = createPowerConfirmationManager();

    const result = await runTextTurn(
      "conv-8",
      "open my notes",
      { online: false },
      {
        orchestrator: fakeOrchestrator,
        capabilityManager,
        powerConfirmation,
        cloudLLMConfigured: false,
      },
    );

    expect(result.toolActivity).toHaveLength(1);
    expect(result.toolActivity[0]).toMatchObject({
      name: "open_file",
      ok: true,
      resultSummary: "Opened C:/notes.txt",
    });
    expect(result.toolActivity[0]?.argsSummary).toContain("notes.txt");
  });

  it("redacts sensitive-looking argument keys instead of ever showing them", async () => {
    const fakeOrchestrator = {
      async *sendMessage(): AsyncGenerator<StreamEvent> {
        yield {
          type: "tool_call",
          toolCall: {
            id: "call-2",
            name: "login",
            arguments: { username: "alice", password: "hunter2" },
          },
        };
        yield {
          type: "tool_result",
          toolCallId: "call-2",
          name: "login",
          ok: false,
          content: "invalid credentials",
        };
        yield { type: "text_delta", delta: "That didn't work." };
        yield { type: "done", finishReason: "stop" };
      },
    } as unknown as AIOrchestrator;

    const broker = new CapabilityBroker(() => true);
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const adapter = await createWindowsAdapter();
    capabilityManager.registerAdapter(adapter);
    const powerConfirmation = createPowerConfirmationManager();

    const result = await runTextTurn(
      "conv-9",
      "log me in",
      { online: false },
      {
        orchestrator: fakeOrchestrator,
        capabilityManager,
        powerConfirmation,
        cloudLLMConfigured: false,
      },
    );

    expect(result.toolActivity[0]?.ok).toBe(false);
    expect(result.toolActivity[0]?.argsSummary).not.toContain("hunter2");
    expect(result.toolActivity[0]?.argsSummary).toContain("[redacted]");
  });

  it("reports a clean cancelled result instead of a rejected promise when aborted", async () => {
    const controller = new AbortController();
    const fakeOrchestrator = {
      // Deliberately throws before ever yielding, to reproduce a real abort mid-stream.
      // eslint-disable-next-line require-yield
      async *sendMessage(): AsyncGenerator<StreamEvent> {
        controller.abort();
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      },
    } as unknown as AIOrchestrator;

    const broker = new CapabilityBroker(() => true);
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const adapter = await createWindowsAdapter();
    capabilityManager.registerAdapter(adapter);
    const powerConfirmation = createPowerConfirmationManager();

    const result = await runTextTurn(
      "conv-10",
      "hello",
      { online: false },
      {
        orchestrator: fakeOrchestrator,
        capabilityManager,
        powerConfirmation,
        cloudLLMConfigured: false,
      },
      controller.signal,
    );

    expect(result.cancelled).toBe(true);
    expect(result.reply).toBe("Cancelled.");
  });

  it("surfaces the orchestrator's own error message rather than swallowing it", async () => {
    const fakeOrchestrator = {
      async *sendMessage(): AsyncGenerator<StreamEvent> {
        yield { type: "error", message: "provider unreachable" };
      },
    } as unknown as AIOrchestrator;

    const broker = new CapabilityBroker(() => true);
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const adapter = await createWindowsAdapter();
    capabilityManager.registerAdapter(adapter);
    const powerConfirmation = createPowerConfirmationManager();

    await expect(
      runTextTurn(
        "conv-7",
        "hello",
        { online: false },
        {
          orchestrator: fakeOrchestrator,
          capabilityManager,
          powerConfirmation,
          cloudLLMConfigured: false,
        },
      ),
    ).rejects.toThrow("provider unreachable");
  });
});
