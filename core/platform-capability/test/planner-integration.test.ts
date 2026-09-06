import { describe, expect, it } from "vitest";
import { CapabilityResolver } from "@ryper/planner";
import { CapabilityManager } from "../src/capability-manager.js";
import { createPlannerCapabilitySource } from "../src/planner-integration.js";
import { buildCapabilityBroker, buildMockAdapter } from "./helpers.js";

describe("createPlannerCapabilitySource", () => {
  it("resolves a planner TaskType as supported when the mapped domain is supported by the adapter", () => {
    const manager = new CapabilityManager({
      broker: buildCapabilityBroker(),
      platformDetector: () => "windows",
    });
    manager.registerAdapter(
      buildMockAdapter({ platform: "windows", supportedDomains: ["browser_control"] }),
    );

    const resolver = new CapabilityResolver(createPlannerCapabilitySource(manager));
    const resolution = resolver.resolve("browser", "windows");
    expect(resolution.supported).toBe(true);
  });

  it("resolves a planner TaskType as unsupported and surfaces the static fallback message", () => {
    const manager = new CapabilityManager({
      broker: buildCapabilityBroker(),
      platformDetector: () => "windows",
    });
    manager.registerAdapter(buildMockAdapter({ platform: "windows", supportedDomains: [] }));

    const resolver = new CapabilityResolver(createPlannerCapabilitySource(manager));
    const resolution = resolver.resolve("camera", "windows");
    expect(resolution.supported).toBe(false);
    expect(resolution.alternative).toContain("camera");
  });

  it("converts the Planner's 'web' platform naming to this layer's 'browser' before resolving", () => {
    const manager = new CapabilityManager({ broker: buildCapabilityBroker() });
    manager.registerAdapter(
      buildMockAdapter({ platform: "browser", supportedDomains: ["browser_control"] }),
    );

    const resolver = new CapabilityResolver(createPlannerCapabilitySource(manager));
    expect(resolver.resolve("browser", "web").supported).toBe(true);
  });

  it("leaves the Planner's default (non-injected) CapabilityResolver behavior completely unchanged", () => {
    // No supportSource injected -> falls back to the pre-existing static table (Phase 7 behavior).
    const resolver = new CapabilityResolver();
    expect(resolver.resolve("browser", "windows").supported).toBe(true);
    expect(resolver.resolve("call", "linux").supported).toBe(false);
  });
});
