import { describe, expect, it } from "vitest";
import { CapabilityBroker } from "../src/index.js";

describe("CapabilityBroker", () => {
  it("denies use of a capability that was never requested", () => {
    const broker = new CapabilityBroker(() => true);
    expect(() => broker.assertGranted("plugin:demo", "microphone")).toThrow(/not granted/);
  });

  it("allows use only after the consent prompt approves", async () => {
    const broker = new CapabilityBroker(() => true);
    await broker.requestCapability({
      actorId: "plugin:demo",
      capability: "filesystem.read",
      justification: "index user documents for search",
    });

    expect(() => broker.assertGranted("plugin:demo", "filesystem.read")).not.toThrow();
  });

  it("respects a denying consent prompt", async () => {
    const broker = new CapabilityBroker(() => false);
    const grant = await broker.requestCapability({
      actorId: "plugin:demo",
      capability: "camera",
      justification: "scan a document",
    });

    expect(grant.decision).toBe("denied");
    expect(broker.hasGrant("plugin:demo", "camera")).toBe(false);
  });

  it("revoke() removes a previously granted capability", async () => {
    const broker = new CapabilityBroker(() => true);
    await broker.requestCapability({
      actorId: "plugin:demo",
      capability: "network",
      justification: "check for updates",
    });
    expect(broker.hasGrant("plugin:demo", "network")).toBe(true);

    broker.revoke("plugin:demo", "network");
    expect(broker.hasGrant("plugin:demo", "network")).toBe(false);
  });

  it("keeps an append-only audit trail of every decision and use", async () => {
    const broker = new CapabilityBroker(() => true);
    await broker.requestCapability({
      actorId: "plugin:demo",
      capability: "notifications",
      justification: "notify on task completion",
    });
    broker.assertGranted("plugin:demo", "notifications");

    const log = broker.getAuditLog();
    expect(log.map((e) => e.action)).toEqual(["request_capability", "used_capability"]);
  });
});
