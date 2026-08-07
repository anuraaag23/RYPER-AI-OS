import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { CapabilityBroker } from "@ryper/security";
import { PluginLoadError, PluginRuntime } from "../src/index.js";

const signedManifest = {
  id: "demo-plugin",
  name: "Demo Plugin",
  version: "1.0.0",
  requestedCapabilities: ["filesystem.read"] as const,
  signed: true,
};

describe("PluginRuntime", () => {
  it("refuses to register an unsigned plugin outside developer mode", () => {
    const runtime = new PluginRuntime(new CapabilityBroker(() => true), new EventBus(), false);
    expect(() => runtime.register({ ...signedManifest, signed: false }, [])).toThrow(
      PluginLoadError,
    );
  });

  it("allows an unsigned plugin when developer mode is enabled", () => {
    const runtime = new PluginRuntime(new CapabilityBroker(() => true), new EventBus(), true);
    expect(() => runtime.register({ ...signedManifest, signed: false }, [])).not.toThrow();
  });

  it("invokes a registered action and returns its result", async () => {
    const broker = new CapabilityBroker(() => true);
    const runtime = new PluginRuntime(broker, new EventBus());
    runtime.register(signedManifest, [
      { name: "greet", handler: (input) => `hello ${String(input)}` },
    ]);

    const result = await runtime.invoke("demo-plugin", "greet", "world");
    expect(result).toBe("hello world");
  });

  it("blocks an action whose required capability was never granted", async () => {
    const broker = new CapabilityBroker(() => true);
    const runtime = new PluginRuntime(broker, new EventBus());
    runtime.register(signedManifest, [
      {
        name: "read-file",
        requiredCapability: "filesystem.read",
        handler: () => "contents",
      },
    ]);

    await expect(runtime.invoke("demo-plugin", "read-file", null)).rejects.toThrow(/not granted/);
  });

  it("lets a plugin action emit events through the shared bus", async () => {
    const bus = new EventBus();
    const runtime = new PluginRuntime(new CapabilityBroker(() => true), bus);
    runtime.register(signedManifest, [
      {
        name: "notify",
        handler: async (_input, context) => {
          await context.emit("plugin.notified", { ok: true });
        },
      },
    ]);

    let received = false;
    bus.on("plugin.notified", () => {
      received = true;
    });
    await runtime.invoke("demo-plugin", "notify", null);
    expect(received).toBe(true);
  });
});
