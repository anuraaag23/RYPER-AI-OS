import { describe, expect, it } from "vitest";
import { ToolExecutor } from "../src/tool-executor.js";
import { ToolPermissionManager } from "../src/tool-permissions.js";
import { ToolValidator } from "../src/tool-validator.js";
import type { ToolDefinition, ToolInvocationRequest } from "../src/types.js";
import { buildCapabilityBroker } from "./helpers.js";

function request(overrides: Partial<ToolInvocationRequest> = {}): ToolInvocationRequest {
  return {
    toolId: "t1",
    parameters: {},
    actorId: "actor-1",
    sessionId: "session-1",
    platform: "windows",
    ...overrides,
  };
}

function tool(
  overrides: Partial<ToolDefinition> = {},
  specOverrides: Partial<ToolDefinition["spec"]> = {},
): ToolDefinition {
  return {
    spec: {
      id: "t1",
      name: "Tool",
      description: "d",
      category: "system",
      version: "1.0.0",
      author: "test",
      capabilities: [],
      permissions: [],
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: {} },
      examples: [],
      errorCodes: [],
      executionCost: "low",
      timeoutMs: 200,
      cancellationSupport: true,
      streamingSupport: false,
      ...specOverrides,
    },
    execute: () => ({}),
    ...overrides,
  };
}

describe("ToolExecutor — happy path", () => {
  it("validates input/output and returns an ok result", async () => {
    const executor = new ToolExecutor(new ToolValidator());
    const t = tool(
      { execute: (params) => ({ echoed: params["text"] }) },
      {
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
        outputSchema: {
          type: "object",
          properties: { echoed: { type: "string" } },
          required: ["echoed"],
        },
      },
    );
    const result = await executor.execute(t, request({ parameters: { text: "hi" } }));
    expect(result.status).toBe("ok");
    expect(result.value).toEqual({ echoed: "hi" });
    expect(result.attempts).toBe(1);
  });
});

describe("ToolExecutor — validation", () => {
  it("rejects input that fails the schema without calling execute", async () => {
    let called = false;
    const executor = new ToolExecutor(new ToolValidator());
    const t = tool(
      {
        execute: () => {
          called = true;
          return {};
        },
      },
      { inputSchema: { type: "object", properties: { n: { type: "number" } }, required: ["n"] } },
    );
    const result = await executor.execute(t, request({ parameters: {} }));
    expect(result.status).toBe("validation_error");
    expect(called).toBe(false);
  });

  it("rejects output that fails the output schema", async () => {
    const executor = new ToolExecutor(new ToolValidator());
    const t = tool(
      { execute: () => ({ wrong: "shape" }) },
      {
        outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      },
    );
    const result = await executor.execute(t, request());
    expect(result.status).toBe("validation_error");
  });
});

describe("ToolExecutor — permissions", () => {
  it("denies execution when a required capability isn't granted", async () => {
    const permissions = new ToolPermissionManager(buildCapabilityBroker(() => false));
    const executor = new ToolExecutor(new ToolValidator(), permissions);
    let called = false;
    const t = tool(
      {
        execute: () => {
          called = true;
          return {};
        },
      },
      { permissions: [{ capability: "network" }] },
    );
    const result = await executor.execute(t, request());
    expect(result.status).toBe("permission_denied");
    expect(called).toBe(false);
  });

  it("allows execution once the capability is pre-granted", async () => {
    const broker = buildCapabilityBroker(() => true);
    await broker.requestCapability({
      actorId: "actor-1",
      capability: "network",
      justification: "test",
    });
    const permissions = new ToolPermissionManager(broker);
    const executor = new ToolExecutor(new ToolValidator(), permissions);
    const t = tool({ execute: () => ({}) }, { permissions: [{ capability: "network" }] });
    const result = await executor.execute(t, request());
    expect(result.status).toBe("ok");
  });
});

describe("ToolExecutor — timeout and cancellation", () => {
  it("times out a tool that never resolves within its timeoutMs", async () => {
    const executor = new ToolExecutor(new ToolValidator());
    const t = tool(
      { execute: () => new Promise(() => {}) },
      { timeoutMs: 30, executionCost: "high" },
    );
    const result = await executor.execute(t, request());
    expect(result.status).toBe("timeout");
    expect(result.errorCode).toBe("framework.timeout");
  }, 2000);

  it("reports cancelled when the caller's signal aborts mid-execution", async () => {
    const controller = new AbortController();
    const executor = new ToolExecutor(new ToolValidator());
    const t = tool(
      { execute: () => new Promise((resolve) => setTimeout(resolve, 100)) },
      { timeoutMs: 5000, executionCost: "high" },
    );
    const promise = executor.execute(t, request(), { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    const result = await promise;
    expect(result.status).toBe("cancelled");
  });
});

describe("ToolExecutor — retry", () => {
  it("retries a throwing low-cost tool up to its retry policy's max attempts", async () => {
    let calls = 0;
    const executor = new ToolExecutor(new ToolValidator());
    const t = tool({
      execute: () => {
        calls += 1;
        throw new Error("flaky");
      },
    });
    const result = await executor.execute(t, request());
    expect(result.status).toBe("error");
    expect(calls).toBe(3); // "low" cost -> maxAttempts 3
    expect(result.attempts).toBe(3);
  });

  it("succeeds on a later attempt after earlier ones fail", async () => {
    let calls = 0;
    const executor = new ToolExecutor(new ToolValidator());
    const t = tool({
      execute: () => {
        calls += 1;
        if (calls < 2) throw new Error("flaky");
        return { ok: true };
      },
    });
    const result = await executor.execute(t, request());
    expect(result.status).toBe("ok");
    expect(calls).toBe(2);
  });

  it("does not retry a high-cost tool beyond a single attempt", async () => {
    let calls = 0;
    const executor = new ToolExecutor(new ToolValidator());
    const t = tool(
      {
        execute: () => {
          calls += 1;
          throw new Error("flaky");
        },
      },
      { executionCost: "high" },
    );
    await executor.execute(t, request());
    expect(calls).toBe(1);
  });
});

describe("ToolExecutor — streaming", () => {
  it("aggregates a streaming tool's chunks into the result value", async () => {
    const executor = new ToolExecutor(new ToolValidator());
    const t = tool(
      {
        execute: () => ["fallback"],
        executeStream: async function* () {
          yield "a";
          yield "b";
        },
      },
      { streamingSupport: true, outputSchema: { type: "array", items: { type: "string" } } },
    );
    const chunksSeen: unknown[] = [];
    const result = await executor.execute(t, request(), {
      onStreamChunk: (chunk) => chunksSeen.push(chunk),
    });
    expect(result.status).toBe("ok");
    expect(result.value).toEqual(["a", "b"]);
    expect(chunksSeen.length).toBeGreaterThan(0);
  });
});
