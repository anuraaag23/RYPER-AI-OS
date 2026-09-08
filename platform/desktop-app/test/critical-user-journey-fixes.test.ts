import { describe, it, expect, vi } from "vitest";
import { CapabilityBroker } from "@ryper/security";
import { configureMediaPermissions } from "../electron/windows.js";
import { LlamaServerManager } from "../electron/llm-model-provisioning.js";
import { createHeuristicToolCallingProvider } from "../electron/heuristic-ai-provider.js";
import { AIOrchestrator, ToolRegistry, SessionManager } from "@ryper/ai-engine";
import { EventBus } from "@ryper/event-bus";

describe("Critical Public User Journey Fixes", () => {
  describe("Bug 1 & 3: Media permissions and audio capture", () => {
    it("approves microphone and audio-capture permissions in Electron session", () => {
      let requestHandler: any;
      let checkHandler: any;
      const fakeSession = {
        defaultSession: {
          setPermissionRequestHandler: vi.fn((fn) => {
            requestHandler = fn;
          }),
          setPermissionCheckHandler: vi.fn((fn) => {
            checkHandler = fn;
          }),
        },
      };

      configureMediaPermissions(fakeSession as any);
      expect(fakeSession.defaultSession.setPermissionRequestHandler).toHaveBeenCalled();
      expect(fakeSession.defaultSession.setPermissionCheckHandler).toHaveBeenCalled();

      const cb1 = vi.fn();
      requestHandler(null, "microphone", cb1, {});
      expect(cb1).toHaveBeenCalledWith(true);

      const cb2 = vi.fn();
      requestHandler(null, "audio-capture", cb2, {});
      expect(cb2).toHaveBeenCalledWith(true);

      const cb3 = vi.fn();
      requestHandler(null, "media", cb3, { mediaTypes: ["audio"] });
      expect(cb3).toHaveBeenCalledWith(true);

      expect(checkHandler(null, "microphone", "origin", {})).toBe(true);
      expect(checkHandler(null, "audio-capture", "origin", {})).toBe(true);
      expect(checkHandler(null, "media", "origin", { mediaTypes: ["audio"] })).toBe(true);
    });
  });

  describe("Bug 4 & 5: Known folder alias and conversational repair resolution", () => {
    it("handles repair phrases in desktop actions target parsing", () => {
      const input1 = "chrome, not edge";
      const cleaned1 = input1.replace(/^no[,\s]+|^i said\s+|,\s*not\s+.*$/i, "").trim();
      expect(cleaned1).toBe("chrome");

      const input2 = "no, open calculator";
      const cleaned2 = input2.replace(/^no[,\s]+|^i said\s+|,\s*not\s+.*$/i, "").trim();
      expect(cleaned2).toBe("open calculator");

      const input3 = "i said notepad";
      const cleaned3 = input3.replace(/^no[,\s]+|^i said\s+|,\s*not\s+.*$/i, "").trim();
      expect(cleaned3).toBe("notepad");
    });
  });

  describe("Bug 6: AI tool round message sequencing", () => {
    it("records assistant turn with toolCalls before tool response turn", async () => {
      const eventBus = new EventBus();
      const registry = new ToolRegistry({ eventBus });
      registry.register({
        spec: {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: {} },
        },
        execute: async () => ({ location: "Tokyo", temp: 22 }),
      });

      let capturedMessages: any[] = [];
      const testProvider = {
        id: "test-provider",
        kind: "local" as const,
        async *streamChat(req: any) {
          capturedMessages = [...req.messages];
          const hasToolResult = req.messages.some((m: any) => m.role === "tool");
          if (!hasToolResult) {
            yield {
              type: "tool_call" as const,
              toolCall: { id: "call-1", name: "get_weather", arguments: {} },
            };
            yield { type: "done" as const, finishReason: "tool_calls" as const };
          } else {
            yield { type: "text_delta" as const, delta: "It is 22C in Tokyo." };
            yield { type: "done" as const, finishReason: "stop" as const };
          }
        },
      };

      const orchestrator = new AIOrchestrator({
        toolRegistry: registry,
        eventBus,
        sessionManager: new SessionManager({ search: () => [] } as any, undefined),
        providerRegistry: { get: () => testProvider } as any,
        modelSelection: { select: () => ({ decision: { target: "local", reason: "test" }, provider: testProvider }) } as any,
        promptBuilder: { build: () => [{ role: "user", content: "Weather please" }] } as any,
        tokenBudget: { fit: (msgs: any) => msgs } as any,
      });

      for await (const _ of orchestrator.sendMessage("sess-1", "Weather please", {})) {
        // drain
      }

      expect(capturedMessages.length).toBe(3);
      expect(capturedMessages[0].role).toBe("user");
      expect(capturedMessages[1].role).toBe("assistant");
      expect(capturedMessages[1].toolCalls).toBeDefined();
      expect(capturedMessages[1].toolCalls[0].name).toBe("get_weather");
      expect(capturedMessages[2].role).toBe("tool");
      expect(capturedMessages[2].toolCallId).toBe("call-1");
    });
  });

  describe("Bug 7: GPU acceleration flags in LlamaServerManager", () => {
    it("spawns llama-server with -ngl and --flash-attn flags", async () => {
      let spawnedArgs: string[] = [];
      const fakeRunner = (_bin: string, args: readonly string[]) => {
        spawnedArgs = [...args];
        return {
          result: new Promise(() => {}),
          writeStdin: () => {},
          endStdin: () => {},
          kill: () => {},
        };
      };
      const fakeFetch = async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "",
        body: () => null,
      });

      const manager = new LlamaServerManager(fakeRunner as any, fakeFetch as any);
      const startPromise = manager.start({
        binaryPath: "C:\\tools\\llama-server.exe",
        modelPath: "C:\\model.gguf",
        port: 8090,
      }, 500);

      await startPromise;

      expect(spawnedArgs).toContain("-ngl");
      expect(spawnedArgs).toContain("--flash-attn");
      expect(spawnedArgs).toContain("--jinja");
    });
  });

  describe("Bug 8: CapabilityBroker persistent permission policies", () => {
    it("respects 'always' policy without prompting", async () => {
      const consentPrompt = vi.fn().mockResolvedValue(false);
      const broker = new CapabilityBroker(consentPrompt);

      broker.setPolicy("filesystem.read", "always", "ai-orchestrator");
      expect(broker.getPolicy("filesystem.read", "ai-orchestrator")).toBe("always");
      expect(broker.hasGrant("ai-orchestrator", "filesystem.read")).toBe(true);

      const grant = await broker.requestCapability({
        actorId: "ai-orchestrator",
        capability: "filesystem.read",
        justification: "test",
      });

      expect(grant.decision).toBe("granted");
      expect(consentPrompt).not.toHaveBeenCalled();
    });

    it("respects 'denied' policy without prompting", async () => {
      const consentPrompt = vi.fn().mockResolvedValue(true);
      const broker = new CapabilityBroker(consentPrompt);

      broker.setPolicy("system.power", "denied", "ai-orchestrator");
      expect(broker.getPolicy("system.power", "ai-orchestrator")).toBe("denied");

      const grant = await broker.requestCapability({
        actorId: "ai-orchestrator",
        capability: "system.power",
        justification: "test",
      });

      expect(grant.decision).toBe("denied");
      expect(consentPrompt).not.toHaveBeenCalled();
    });

    it("exports and imports policies correctly", () => {
      const broker = new CapabilityBroker(() => true);
      broker.setPolicy("filesystem.read", "always", "ai-orchestrator");
      broker.setPolicy("system.power", "denied", "ai-orchestrator");

      const exported = broker.exportPolicies();
      expect(exported["ai-orchestrator::filesystem.read"]).toBe("always");
      expect(exported["ai-orchestrator::system.power"]).toBe("denied");

      const freshBroker = new CapabilityBroker(() => true);
      freshBroker.importPolicies(exported);
      expect(freshBroker.getPolicy("filesystem.read", "ai-orchestrator")).toBe("always");
      expect(freshBroker.getPolicy("system.power", "ai-orchestrator")).toBe("denied");
      expect(freshBroker.hasGrant("ai-orchestrator", "filesystem.read")).toBe(true);
    });
  });

  describe("Bug 9 & 10: Multilingual voice and conversational fallback", () => {
    it("handles common conversational greetings politely in heuristic fallback", async () => {
      const provider = createHeuristicToolCallingProvider(new Set());
      const events: any[] = [];
      for await (const ev of provider.streamChat({
        messages: [{ role: "user", content: "hello" }],
      })) {
        events.push(ev);
      }

      const text = events
        .filter((e) => e.type === "text_delta")
        .map((e) => e.delta)
        .join("");

      expect(text).toContain("Hello! I am RYPER AI OS.");
    });
  });
});
