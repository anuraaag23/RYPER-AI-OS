import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { CapabilityBroker } from "@ryper/security";
import { PluginRuntime } from "@ryper/plugin-runtime";
import { newFilePlugin } from "../src/index.js";

describe("newFilePlugin end-to-end", () => {
  it("processes a new-file event once filesystem.write is granted", async () => {
    const bus = new EventBus();
    const broker = new CapabilityBroker(() => true);
    const runtime = new PluginRuntime(broker, bus, /* allowUnsigned */ true);

    runtime.register(newFilePlugin.manifest, newFilePlugin.actions);
    await broker.requestCapability({
      actorId: newFilePlugin.manifest.id,
      capability: "filesystem.write",
      justification: "rename organized files",
    });

    let processedEvent: unknown;
    bus.on("plugin.new_file_organizer.processed", (event) => {
      processedEvent = event.payload;
    });

    const result = await runtime.invoke("new-file-organizer", "process-new-file", {
      path: "/downloads/report.pdf",
      extension: "pdf",
    });

    expect(result).toMatchObject({ notified: true });
    expect(processedEvent).toMatchObject({ notified: true });
  });

  it("is blocked without the filesystem.write grant", async () => {
    const bus = new EventBus();
    const broker = new CapabilityBroker(() => true);
    const runtime = new PluginRuntime(broker, bus, true);
    runtime.register(newFilePlugin.manifest, newFilePlugin.actions);

    await expect(
      runtime.invoke("new-file-organizer", "process-new-file", {
        path: "/downloads/report.pdf",
        extension: "pdf",
      }),
    ).rejects.toThrow(/not granted/);
  });
});
