import { describe, expect, it } from "vitest";
import { createWebShell } from "../src/index.js";

describe("createWebShell", () => {
  it("boots with default echo providers and reports device state", async () => {
    const shell = createWebShell({ readOnlineStatus: () => false });
    expect(shell.getDeviceState()).toEqual({ online: false });

    const reply = await shell.conversation.sendMessage("c1", "hi", {
      device: shell.getDeviceState(),
    });
    expect(reply.routingTarget).toBe("local");
    expect(reply.content).toContain("[local model]");
  });

  it("accepts injected model providers", async () => {
    const shell = createWebShell({
      readOnlineStatus: () => true,
      localModel: { id: "test-local", target: "local", generate: async () => "stub-local" },
      cloudModel: { id: "test-cloud", target: "cloud", generate: async () => "stub-cloud" },
    });

    const reply = await shell.conversation.sendMessage("c1", "search this", {
      device: shell.getDeviceState(),
      requiresWebSearch: true,
    });
    expect(reply.routingTarget).toBe("cloud");
    expect(reply.content).toBe("stub-cloud");
  });
});
