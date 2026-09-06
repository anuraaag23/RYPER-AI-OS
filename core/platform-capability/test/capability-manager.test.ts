import { describe, expect, it } from "vitest";
import type { ToolExecutionContext } from "@ryper/tool-framework";
import { CapabilityManager } from "../src/capability-manager.js";
import { buildCapabilityBroker, buildMockAdapter } from "./helpers.js";

function context(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    invocationId: "i1",
    actorId: "actor-1",
    sessionId: "s1",
    platform: "windows",
    ...overrides,
  };
}

describe("CapabilityManager — registration and resolution", () => {
  it("registers a capability descriptor and resolves it against the active adapter", () => {
    const manager = new CapabilityManager({
      broker: buildCapabilityBroker(),
      platformDetector: () => "windows",
    });
    manager.registerCapability({
      domain: "notifications",
      name: "Notifications",
      description: "d",
      version: "1.0.0",
    });
    manager.registerAdapter(
      buildMockAdapter({ platform: "windows", supportedDomains: ["notifications"] }),
    );

    expect(manager.resolve("notifications").supported).toBe(true);
    expect(manager.resolve("bluetooth").supported).toBe(false);
  });

  it("rejects registering an invalid capability descriptor", () => {
    const manager = new CapabilityManager({ broker: buildCapabilityBroker() });
    expect(() =>
      manager.registerCapability({
        domain: "Not Valid!",
        name: "n",
        description: "d",
        version: "1.0.0",
      }),
    ).toThrow();
  });

  it("falls back to the null adapter when no adapter is registered for the active platform", () => {
    const manager = new CapabilityManager({
      broker: buildCapabilityBroker(),
      platformDetector: () => "ios",
    });
    expect(manager.activeAdapter().platform).toBe("ios");
    expect(manager.resolve("notifications").supported).toBe(false);
  });
});

describe("CapabilityManager — discovery", () => {
  it("produces a full discovery report through the active adapter", () => {
    const manager = new CapabilityManager({
      broker: buildCapabilityBroker(),
      platformDetector: () => "windows",
    });
    manager.registerCapability({
      domain: "notifications",
      name: "n",
      description: "d",
      version: "1.0.0",
    });
    manager.registerAdapter(
      buildMockAdapter({ platform: "windows", supportedDomains: ["notifications"] }),
    );

    const report = manager.discover("actor-1");
    expect(report.supportedDomains).toEqual(["notifications"]);
    expect(report.platform).toBe("windows");
  });
});

describe("CapabilityManager — invoke pipeline", () => {
  it("invokes a capability through the adapter and records diagnostics/metrics", async () => {
    const manager = new CapabilityManager({
      broker: buildCapabilityBroker(),
      platformDetector: () => "windows",
    });
    manager.registerCapability({
      domain: "notifications",
      name: "n",
      description: "d",
      version: "1.0.0",
    });
    manager.registerAdapter(
      buildMockAdapter({
        platform: "windows",
        supportedDomains: ["notifications"],
        handlers: { "notifications.send": (params) => ({ sent: params["title"] }) },
      }),
    );

    const result = await manager.invoke("notifications", "send", { title: "hi" }, context());
    expect(result).toEqual({ sent: "hi" });
    expect(manager.metrics.snapshot("notifications")?.invocations).toBe(1);
    expect(manager.diagnostics.recent("notifications")).toHaveLength(1);
  });

  it("denies invocation when the required permission isn't granted", async () => {
    const manager = new CapabilityManager({
      broker: buildCapabilityBroker(() => false),
      platformDetector: () => "windows",
    });
    manager.registerCapability({
      domain: "camera",
      name: "c",
      description: "d",
      version: "1.0.0",
      requiredCapability: "camera",
    });
    manager.registerAdapter(
      buildMockAdapter({ platform: "windows", supportedDomains: ["camera"] }),
    );

    await expect(manager.invoke("camera", "capture", {}, context())).rejects.toThrow(/not granted/);
    expect(manager.metrics.snapshot("camera")?.failures).toBe(1);
  });

  it("rejects invalid parameters against the descriptor's inputSchema before invoking the adapter", async () => {
    const manager = new CapabilityManager({
      broker: buildCapabilityBroker(),
      platformDetector: () => "windows",
    });
    manager.registerCapability({
      domain: "notifications",
      name: "n",
      description: "d",
      version: "1.0.0",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      },
    });
    let invoked = false;
    manager.registerAdapter(
      buildMockAdapter({
        platform: "windows",
        supportedDomains: ["notifications"],
        handlers: {
          "notifications.send": () => {
            invoked = true;
            return {};
          },
        },
      }),
    );

    await expect(manager.invoke("notifications", "send", {}, context())).rejects.toThrow(
      /invalid parameters/,
    );
    expect(invoked).toBe(false);
  });

  it("propagates and records an adapter-level failure", async () => {
    const manager = new CapabilityManager({
      broker: buildCapabilityBroker(),
      platformDetector: () => "windows",
    });
    manager.registerAdapter(
      buildMockAdapter({
        platform: "windows",
        supportedDomains: ["notifications"],
        handlers: {
          "notifications.send": () => {
            throw new Error("adapter exploded");
          },
        },
      }),
    );
    await expect(manager.invoke("notifications", "send", {}, context())).rejects.toThrow(
      "adapter exploded",
    );
    expect(manager.metrics.snapshot("notifications")?.failures).toBe(1);
  });

  it("converts a ToolExecutionContext's 'web' platform naming to this layer's 'browser'", async () => {
    const manager = new CapabilityManager({ broker: buildCapabilityBroker() });
    manager.registerAdapter(
      buildMockAdapter({ platform: "browser", supportedDomains: ["notifications"] }),
    );
    const result = await manager.invoke("notifications", "send", {}, context({ platform: "web" }));
    expect(result).toEqual({ ok: true });
  });

  it("enforces operation-level capability permissions on invoke", async () => {
    const broker = buildCapabilityBroker((req) => req.capability === "filesystem.read");
    const manager = new CapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    manager.registerCapability({
      domain: "filesystem",
      name: "Filesystem",
      description: "d",
      version: "1.0.0",
      requiredCapability: "filesystem.write",
      operationCapabilities: {
        list: "filesystem.read",
        write: "filesystem.write",
      },
    });
    manager.registerAdapter(
      buildMockAdapter({
        platform: "windows",
        supportedDomains: ["filesystem"],
        handlers: {
          "filesystem.list": () => ["file1.txt"],
          "filesystem.write": () => ({ success: true }),
        },
      }),
    );

    // list requests filesystem.read, which broker grants
    const listResult = await manager.invoke("filesystem", "list", {}, context());
    expect(listResult).toEqual(["file1.txt"]);

    // write requests filesystem.write, which broker denies
    await expect(manager.invoke("filesystem", "write", {}, context())).rejects.toThrow(/not granted/);
  });
});
