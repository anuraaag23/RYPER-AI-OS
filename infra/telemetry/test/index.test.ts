import { describe, expect, it, vi } from "vitest";
import { TelemetryClient } from "../src/index.js";

describe("TelemetryClient", () => {
  it("drops events and never calls the transport when disabled", async () => {
    const transport = vi.fn();
    const client = new TelemetryClient({ enabled: false, transport });

    await client.track({ name: "app_opened" });

    expect(transport).not.toHaveBeenCalled();
    expect(client.getBufferedEvents()).toHaveLength(0);
  });

  it("forwards events to the transport only when enabled", async () => {
    const transport = vi.fn();
    const client = new TelemetryClient({ enabled: true, transport });

    await client.track({ name: "app_opened", properties: { platform: "web" } });

    expect(transport).toHaveBeenCalledTimes(1);
    expect(client.getBufferedEvents()).toHaveLength(1);
  });

  it("clearBuffer() empties the transparency buffer", async () => {
    const client = new TelemetryClient({ enabled: true });
    await client.track({ name: "x" });
    client.clearBuffer();
    expect(client.getBufferedEvents()).toHaveLength(0);
  });
});
