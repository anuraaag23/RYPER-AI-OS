import { describe, expect, it } from "vitest";
import { CapabilityResolver, PlannerEngine } from "@ryper/planner";
import { CapabilityManager } from "../src/capability-manager.js";
import { createPlannerCapabilitySource } from "../src/planner-integration.js";
import { buildCapabilityBroker, buildMockAdapter } from "./helpers.js";

describe("PlannerEngine driven by the Platform Capability Layer", () => {
  it("marks a task unsupported when the PCL's active adapter doesn't support the mapped domain", async () => {
    const manager = new CapabilityManager({
      broker: buildCapabilityBroker(),
      platformDetector: () => "linux",
    });
    // A minimal Linux adapter that (accurately, for this test) doesn't support phone calls.
    manager.registerAdapter(
      buildMockAdapter({
        platform: "linux",
        supportedDomains: ["application_control", "browser_control"],
      }),
    );

    const capabilityResolver = new CapabilityResolver(createPlannerCapabilitySource(manager));
    const engine = new PlannerEngine({ capabilityResolver });

    const plan = await engine.plan({ text: "call mom", platform: "linux" });
    const callTask = plan.tasks.find((t) => t.taskType === "call");
    expect(callTask?.recovery?.fallbackTask?.taskType).toBe("ai");
    expect(plan.diagnostics.some((d) => d.includes("linux"))).toBe(true);
  });

  it("marks a task supported when the PCL's active adapter supports the mapped domain", async () => {
    const manager = new CapabilityManager({
      broker: buildCapabilityBroker(),
      platformDetector: () => "windows",
    });
    manager.registerAdapter(
      buildMockAdapter({ platform: "windows", supportedDomains: ["application_control"] }),
    );

    const capabilityResolver = new CapabilityResolver(createPlannerCapabilitySource(manager));
    const engine = new PlannerEngine({ capabilityResolver });

    const plan = await engine.plan({ text: "Open Calculator.", platform: "windows" });
    const task = plan.tasks[0];
    expect(task?.taskType).toBe("application");
    expect(task?.recovery).toBeUndefined();
  });
});
