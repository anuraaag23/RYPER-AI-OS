import { describe, expect, it } from "vitest";
import { createToolVoiceCommandHandler, type ToolInvoker } from "../src/voice-integration.js";
import type { ToolResult } from "../src/types.js";

function result(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    invocationId: "i1",
    toolId: "system.get_current_time",
    status: "ok",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1,
    attempts: 1,
    ...overrides,
  };
}

describe("createToolVoiceCommandHandler", () => {
  it("invokes the tool named in the 'tool' slot and reports success", async () => {
    let received: unknown;
    const invoker: ToolInvoker = {
      invoke: async (toolId, parameters) => {
        received = { toolId, parameters };
        return result();
      },
    };
    const handler = createToolVoiceCommandHandler(invoker, "windows");
    const response = await handler.handle(
      { intent: "invoke_tool", slots: { tool: "system.get_current_time" }, confidence: 1 },
      { sessionId: "s1" },
    );
    expect(response.handled).toBe(true);
    expect(response.spokenResponse).toContain("Done");
    expect(received).toEqual({ toolId: "system.get_current_time", parameters: {} });
  });

  it("parses a JSON 'parameters' slot into the invocation parameters", async () => {
    let receivedParams: unknown;
    const invoker: ToolInvoker = {
      invoke: async (_toolId, parameters) => {
        receivedParams = parameters;
        return result();
      },
    };
    const handler = createToolVoiceCommandHandler(invoker, "windows");
    await handler.handle(
      {
        intent: "invoke_tool",
        slots: {
          tool: "system.text_transform",
          parameters: '{"text":"hi","operation":"uppercase"}',
        },
        confidence: 1,
      },
      { sessionId: "s1" },
    );
    expect(receivedParams).toEqual({ text: "hi", operation: "uppercase" });
  });

  it("responds gracefully when no tool slot was matched", async () => {
    const invoker: ToolInvoker = { invoke: async () => result() };
    const handler = createToolVoiceCommandHandler(invoker, "windows");
    const response = await handler.handle(
      { intent: "invoke_tool", slots: {}, confidence: 1 },
      { sessionId: "s1" },
    );
    expect(response.spokenResponse).toContain("not sure which tool");
  });

  it("describes a permission-denied result distinctly from a generic failure", async () => {
    const invoker: ToolInvoker = { invoke: async () => result({ status: "permission_denied" }) };
    const handler = createToolVoiceCommandHandler(invoker, "windows");
    const response = await handler.handle(
      { intent: "invoke_tool", slots: { tool: "t1" }, confidence: 1 },
      { sessionId: "s1" },
    );
    expect(response.spokenResponse).toContain("permission");
  });
});
