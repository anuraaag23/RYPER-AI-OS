import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapCore } from "../electron/core-bootstrap.js";
import type { StartupDiagnostics } from "../electron/ipc-contract.js";

describe("bootstrapCore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ryper-core-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("wires a real WebShell, CapabilityManager, conversation store, and settings store", async () => {
    const events: StartupDiagnostics[] = [];
    const core = await bootstrapCore(
      {
        conversationsFile: join(dir, "conversations.json"),
        settingsFile: join(dir, "settings.json"),
        modelCacheDir: join(dir, "models"),
      },
      (event) => events.push(event),
      async () => true,
    );

    expect(core.webShell.conversation).toBeDefined();
    expect(core.webShell.eventBus).toBeDefined();
    expect(core.capabilityManager).toBeDefined();
    expect(core.conversations).toBeDefined();
    expect(core.settings).toBeDefined();

    // Every step reported ok (this sandbox is not win32, so the "platform agent" step
    // reports a diagnostic notice rather than failing).
    expect(events.every((e) => e.ok)).toBe(true);
    expect(events.some((e) => e.step.includes("core services"))).toBe(true);
    expect(events.some((e) => e.step.includes("security"))).toBe(true);
  });

  it("actually persists conversations created through the bootstrapped store", async () => {
    const core = await bootstrapCore(
      {
        conversationsFile: join(dir, "conversations.json"),
        settingsFile: join(dir, "settings.json"),
        modelCacheDir: join(dir, "models"),
      },
      () => undefined,
      async () => true,
    );
    const created = await core.conversations.create("Real persistence check");
    const list = await core.conversations.list();
    expect(list.some((c) => c.id === created.id)).toBe(true);
  });

  it("reports a non-win32 health check honestly (no PlatformAdapter registered)", async () => {
    const core = await bootstrapCore(
      {
        conversationsFile: join(dir, "conversations.json"),
        settingsFile: join(dir, "settings.json"),
        modelCacheDir: join(dir, "models"),
      },
      () => undefined,
      async () => true,
    );
    const health = await core.getHealth();
    if (process.platform !== "win32") {
      expect(health.status).toBe("degraded");
      expect(health.details.some((d) => d.includes("no PlatformAdapter"))).toBe(true);
    }
  }, 15_000);

  it("runs a real end-to-end conversation turn through the bootstrapped WebShell", async () => {
    const core = await bootstrapCore(
      {
        conversationsFile: join(dir, "conversations.json"),
        settingsFile: join(dir, "settings.json"),
        modelCacheDir: join(dir, "models"),
      },
      () => undefined,
      async () => true,
    );
    const conversation = await core.conversations.create();
    const reply = await core.webShell.conversation.sendMessage(conversation.id, "Hello there", {
      device: core.webShell.getDeviceState(),
    });
    expect(reply.content.length).toBeGreaterThan(0);
  });
});
