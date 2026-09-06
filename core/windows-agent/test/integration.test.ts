import { describe, expect, it } from "vitest";
import { createCapabilityResolver, PlannerEngine } from "@ryper/planner";
import { createToolManager } from "@ryper/tool-framework";
import { createPlannerCapabilitySource } from "@ryper/platform-capability";
import { InMemoryWindowsSystemApi } from "../src/reference-system-api.js";
import { bootstrapWindowsPlatformAgent, createLaunchApplicationTool } from "../src/bootstrap.js";
import { buildCapabilityBroker, buildToolContext } from "./helpers.js";

describe("Windows Platform Agent integration", () => {
  it("bootstraps a CapabilityManager with every Windows descriptor registered and the adapter active", async () => {
    const broker = buildCapabilityBroker();
    const { adapter, capabilityManager } = await bootstrapWindowsPlatformAgent({ broker });

    expect(capabilityManager.activeAdapter("windows")).toBe(adapter);
    expect(capabilityManager.resolve("application_control", "windows").supported).toBe(true);
    expect(capabilityManager.registry.list().length).toBeGreaterThanOrEqual(14);
  });

  it("CapabilityManager.invoke() runs the full permission-check → validation → adapter pipeline", async () => {
    const broker = buildCapabilityBroker(() => true);
    const { capabilityManager } = await bootstrapWindowsPlatformAgent({ broker });

    const result = await capabilityManager.invoke(
      "application_control",
      "launch",
      { appId: "microsoft.windows.notepad" },
      buildToolContext(),
    );
    expect(result).toMatchObject({ name: "notepad.exe" });
    expect(broker.hasGrant("actor-1", "filesystem.write")).toBe(false); // application_control has no requiredCapability
  });

  it("CapabilityManager.invoke() refuses when the CapabilityBroker denies consent", async () => {
    const broker = buildCapabilityBroker(() => false);
    const { capabilityManager } = await bootstrapWindowsPlatformAgent({ broker });

    await expect(
      capabilityManager.invoke("filesystem", "read", { path: "C:\\x.txt" }, buildToolContext()),
    ).rejects.toThrow(/not granted/);
  });

  it("createPlannerCapabilitySource lets a real PlannerEngine ask the Windows adapter what it supports", async () => {
    const broker = buildCapabilityBroker();
    const { capabilityManager } = await bootstrapWindowsPlatformAgent({ broker });

    const capabilityResolver = createCapabilityResolver(
      createPlannerCapabilitySource(capabilityManager),
    );
    const planner = new PlannerEngine({ capabilityResolver });

    const plan = await planner.plan({
      text: "open the calculator app",
      platform: "windows",
      actorId: "actor-1",
      sessionId: "session-1",
    });

    expect(plan.tasks.length).toBeGreaterThan(0);
    // "application" task types resolve through TASK_TYPE_TO_DOMAIN -> "application_control",
    // which the Windows adapter supports, so nothing should be flagged unsupported.
    expect(plan.diagnostics.filter(Boolean)).toEqual([]);
  });

  it("createPlannerCapabilitySource reports unsupported task types the Windows adapter doesn't implement", async () => {
    const broker = buildCapabilityBroker();
    const { capabilityManager } = await bootstrapWindowsPlatformAgent({ broker });

    const capabilityResolver = createCapabilityResolver(
      createPlannerCapabilitySource(capabilityManager),
    );
    // "smart_home" -> domain "smart_home", which the Windows adapter does not implement.
    const resolution = capabilityResolver.resolve("smart_home", "windows");
    expect(resolution.supported).toBe(false);
    expect(resolution.alternative).toBeTruthy();
  });

  it("createCapabilityTool wraps application_control.launch as a real, invokable ToolDefinition", async () => {
    const broker = buildCapabilityBroker();
    const { capabilityManager } = await bootstrapWindowsPlatformAgent({ broker });

    const toolManager = createToolManager({
      capabilityBroker: broker,
      registerBuiltinTools: false,
    });
    toolManager.registerTool(createLaunchApplicationTool(capabilityManager));

    const result = await toolManager.invoke(
      "windows.application.launch",
      { appId: "microsoft.windows.calculator" },
      "actor-1",
      "session-1",
      "windows",
    );

    expect(result.status).toBe("ok");
    expect(result.value).toMatchObject({ name: "Calculator.exe" });
  });

  it("createCapabilityTool surfaces adapter errors as a failed ToolResult, not a thrown exception", async () => {
    const broker = buildCapabilityBroker();
    const { capabilityManager } = await bootstrapWindowsPlatformAgent({ broker });

    const toolManager = createToolManager({
      capabilityBroker: broker,
      registerBuiltinTools: false,
    });
    toolManager.registerTool(createLaunchApplicationTool(capabilityManager));

    const result = await toolManager.invoke(
      "windows.application.launch",
      { appId: "not.installed" },
      "actor-1",
      "session-1",
      "windows",
    );
    expect(result.status).toBe("error");
  });

  it("a plugin-contributed Windows capability handler is reachable end-to-end through CapabilityManager", async () => {
    const broker = buildCapabilityBroker();
    const { adapter, capabilityManager } = await bootstrapWindowsPlatformAgent({ broker });

    capabilityManager.registerCapability({
      domain: "tray_icons",
      name: "Tray Icons (plugin-contributed)",
      description: "Lets a plugin set the system tray icon.",
      version: "1.0.0",
    });
    adapter.pluginCapabilities.register({
      pluginId: "acme.tray-icons",
      domain: "tray_icons",
      operation: "set_icon",
      handler: async (params) => ({ iconSet: params.iconName }),
    });

    const result = await capabilityManager.invoke(
      "tray_icons",
      "set_icon",
      { iconName: "syncing" },
      buildToolContext(),
    );
    expect(result).toEqual({ iconSet: "syncing" });
  });

  it("wires a custom InMemoryWindowsSystemApi through the whole stack (adapter, capability manager, tool)", async () => {
    const systemApi = new InMemoryWindowsSystemApi();
    await systemApi.writeFile("C:\\Users\\ryper\\Documents\\report.txt", "quarterly numbers");

    const broker = buildCapabilityBroker();
    const { capabilityManager } = await bootstrapWindowsPlatformAgent({
      broker,
      adapterOptions: { systemApi },
    });

    const content = await capabilityManager.invoke(
      "filesystem",
      "read",
      { path: "C:\\Users\\ryper\\Documents\\report.txt" },
      buildToolContext(),
    );
    expect(content).toBe("quarterly numbers");
  });
});
