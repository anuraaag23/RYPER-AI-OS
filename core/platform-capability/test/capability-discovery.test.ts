import { describe, expect, it } from "vitest";
import { CapabilityDiscovery } from "../src/capability-discovery.js";
import { CapabilityPermissions } from "../src/capability-permissions.js";
import { CapabilityRegistry } from "../src/capability-registry.js";
import { CapabilityResolver } from "../src/capability-resolver.js";
import { buildCapabilityBroker, buildMockAdapter } from "./helpers.js";

describe("CapabilityDiscovery", () => {
  it("aggregates supported/unsupported domains, device info, limitations, and permissions", async () => {
    const registry = new CapabilityRegistry();
    registry.register({
      domain: "notifications",
      name: "n",
      description: "d",
      version: "1.0.0",
    });
    registry.register({
      domain: "camera",
      name: "c",
      description: "d",
      version: "1.0.0",
      requiredCapability: "camera",
    });
    const resolver = new CapabilityResolver(registry);
    const broker = buildCapabilityBroker(() => true);
    const permissions = new CapabilityPermissions(broker, registry);
    await permissions.requestPermission("camera", "actor-1", "test");

    const discovery = new CapabilityDiscovery(registry, resolver, permissions);
    const adapter = buildMockAdapter({
      supportedDomains: ["notifications"],
      deviceInfo: { platformVersion: "11", deviceType: "desktop" },
      runtimeLimitations: [{ domain: "camera", reason: "no camera hardware" }],
    });

    const report = discovery.discover(adapter, "actor-1");
    expect(report.platform).toBe(adapter.platform);
    expect(report.supportedDomains).toEqual(["notifications"]);
    expect(report.unsupportedDomains.map((s) => s.domain)).toEqual(["camera"]);
    expect(report.deviceInfo.platformVersion).toBe("11");
    expect(report.runtimeLimitations).toEqual([{ domain: "camera", reason: "no camera hardware" }]);
    expect(report.availablePermissions).toEqual(["camera"]);
  });
});
