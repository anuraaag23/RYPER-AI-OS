import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { PluginRuntime } from "@ryper/plugin-runtime";
import { PluginSandbox, SandboxViolationError } from "../src/sandbox.js";
import { buildCapabilityBroker } from "./helpers.js";

function buildRuntime(): PluginRuntime {
  return new PluginRuntime(buildCapabilityBroker(), new EventBus(), true);
}

describe("PluginSandbox", () => {
  it("invokes a registered action and returns its result", async () => {
    const runtime = buildRuntime();
    runtime.register(
      { id: "p1", name: "P1", version: "1.0.0", requestedCapabilities: [], signed: false },
      [{ name: "echo", handler: (input) => input }],
    );
    const sandbox = new PluginSandbox(runtime);
    const result = await sandbox.invoke("p1", "echo", { hello: "world" });
    expect(result).toEqual({ hello: "world" });
  });

  it("rejects a call exceeding the concurrent-call limit", async () => {
    const runtime = buildRuntime();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    runtime.register(
      { id: "p1", name: "P1", version: "1.0.0", requestedCapabilities: [], signed: false },
      [{ name: "slow", handler: async () => gate }],
    );
    const sandbox = new PluginSandbox(runtime, {
      maxConcurrentCalls: 1,
      callTimeoutMs: 5000,
      maxPayloadBytes: 1_000_000,
    });

    const first = sandbox.invoke("p1", "slow", {});
    await expect(sandbox.invoke("p1", "slow", {})).rejects.toThrow(SandboxViolationError);
    release();
    await first;
  });

  it("rejects an oversized input payload", async () => {
    const runtime = buildRuntime();
    runtime.register(
      { id: "p1", name: "P1", version: "1.0.0", requestedCapabilities: [], signed: false },
      [{ name: "echo", handler: (input) => input }],
    );
    const sandbox = new PluginSandbox(runtime, {
      maxConcurrentCalls: 4,
      callTimeoutMs: 5000,
      maxPayloadBytes: 10,
    });
    await expect(
      sandbox.invoke("p1", "echo", { text: "this is way too long for the limit" }),
    ).rejects.toThrow(SandboxViolationError);
  });

  it("times out a call that runs past the sandbox's call timeout", async () => {
    const runtime = buildRuntime();
    runtime.register(
      { id: "p1", name: "P1", version: "1.0.0", requestedCapabilities: [], signed: false },
      [{ name: "slow", handler: () => new Promise(() => {}) }],
    );
    const sandbox = new PluginSandbox(runtime, {
      maxConcurrentCalls: 4,
      callTimeoutMs: 20,
      maxPayloadBytes: 1_000_000,
    });
    await expect(sandbox.invoke("p1", "slow", {})).rejects.toThrow(SandboxViolationError);
  });

  it("frees its concurrency slot after a call completes, allowing a subsequent call", async () => {
    const runtime = buildRuntime();
    runtime.register(
      { id: "p1", name: "P1", version: "1.0.0", requestedCapabilities: [], signed: false },
      [{ name: "echo", handler: (input) => input }],
    );
    const sandbox = new PluginSandbox(runtime, {
      maxConcurrentCalls: 1,
      callTimeoutMs: 5000,
      maxPayloadBytes: 1_000_000,
    });
    await sandbox.invoke("p1", "echo", {});
    await expect(sandbox.invoke("p1", "echo", {})).resolves.toEqual({});
  });
});
