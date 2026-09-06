import { describe, expect, it } from "vitest";
import { ToolRegistry } from "@ryper/ai-engine";
import { CapabilityBroker, type CapabilityRequest } from "@ryper/security";
import { createCapabilityManager } from "@ryper/platform-capability";
import {
  createWindowsAdapter,
  WINDOWS_CAPABILITY_DESCRIPTORS,
  createInMemoryWindowsSystemApi,
} from "@ryper/windows-agent";
import { buildDesktopToolDefinitions } from "../electron/desktop-tools.js";
import { PowerConfirmationManager } from "../electron/power-confirmation.js";

const ACTOR_CTX = {
  actorId: "ai-orchestrator",
  platform: "windows",
  invocationId: "test-inv",
  sessionId: "s1",
};

async function buildTestRig(options?: {
  promptForConsent?: (request: CapabilityRequest) => Promise<boolean> | boolean;
  destructiveActionConfirmer?: (request: { action: string; target: string; reason: string }) => Promise<boolean>;
}) {
  const broker = new CapabilityBroker(options?.promptForConsent ?? (() => true));
  const capabilityManager = createCapabilityManager({ broker, platformDetector: () => "windows" });
  const systemApi = createInMemoryWindowsSystemApi();

  const adapter = await createWindowsAdapter({
    systemApi,
    allowRegistryWrites: true,
    destructiveActionConfirmer: options?.destructiveActionConfirmer ?? (async () => true),
  });
  capabilityManager.registerAdapter(adapter);
  for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
    capabilityManager.registerCapability(descriptor);
  }
  const powerConfirmation = new PowerConfirmationManager();
  const registry = new ToolRegistry(broker);
  for (const tool of buildDesktopToolDefinitions(
    capabilityManager,
    powerConfirmation,
    undefined,
    "ai-orchestrator",
  )) {
    registry.register(tool);
  }
  return { broker, capabilityManager, adapter, registry, systemApi, powerConfirmation };
}

describe("Windows Background Services & Task Scheduler Security Suite", () => {
  // ---- SERVICE TESTS ----

  it("1. list_services requires automation.read", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "svc-1", name: "list_services", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.read");
    expect(requestedCaps).not.toContain("automation.execute");
    expect(result.content).toContain("Windows Services");
    expect(result.content).toContain("Print Spooler");
  });

  it("2. inspect_service requires automation.read", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "svc-2", name: "inspect_service", arguments: { name: "Spooler" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.read");
    expect(requestedCaps).not.toContain("automation.execute");
    expect(result.content).toContain("Print Spooler");
    expect(result.content).toContain("Status: running");
  });

  it("3. get_service_status requires automation.read", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "svc-3", name: "get_service_status", arguments: { name: "Spooler" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.read");
    expect(result.content).toContain("status is: running");
  });

  it("4. service read operations are blocked when automation.read is denied", async () => {
    const { registry } = await buildTestRig({
      promptForConsent: (req) => req.capability !== "automation.read",
    });

    const resList = await registry.invoke(
      { id: "svc-4a", name: "list_services", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(resList.ok).toBe(false);
    expect(resList.content).toMatch(/not granted|denied/i);

    const resInspect = await registry.invoke(
      { id: "svc-4b", name: "inspect_service", arguments: { name: "Spooler" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(resInspect.ok).toBe(false);
    expect(resInspect.content).toMatch(/not granted|denied/i);
  });

  it("5. start_service requires automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry, systemApi } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    // wuauserv starts in "stopped" state in test fixture
    const result = await registry.invoke(
      { id: "svc-5", name: "start_service", arguments: { name: "wuauserv" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
    const s = await systemApi.getService("wuauserv");
    expect(s?.status).toBe("running");
  });

  it("6. stop_service requires automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry, systemApi } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "svc-6", name: "stop_service", arguments: { name: "Spooler" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
    const s = await systemApi.getService("Spooler");
    expect(s?.status).toBe("stopped");
  });

  it("7. restart_service requires automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry, systemApi } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "svc-7", name: "restart_service", arguments: { name: "Spooler" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
    const s = await systemApi.getService("Spooler");
    expect(s?.status).toBe("running");
  });

  it("8. service mutation is blocked when automation.execute is denied", async () => {
    const { registry } = await buildTestRig({
      promptForConsent: (req) => req.capability !== "automation.execute",
    });

    const result = await registry.invoke(
      { id: "svc-8", name: "start_service", arguments: { name: "wuauserv" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/not granted|denied/i);
  });

  it("9. stopping critical service requires DestructiveActionGate confirmation", async () => {
    const confirmations: { action: string; target: string; reason: string }[] = [];
    const { registry, systemApi } = await buildTestRig({
      promptForConsent: () => true,
      destructiveActionConfirmer: async (req) => {
        confirmations.push(req);
        return true;
      },
    });

    // WinDefend is seeded as critical: true
    const result = await registry.invoke(
      { id: "svc-9", name: "stop_service", arguments: { name: "WinDefend" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(confirmations.length).toBe(1);
    expect(confirmations[0].action).toBe("stop_service");
    expect(confirmations[0].reason).toContain("critical");
    const s = await systemApi.getService("WinDefend");
    expect(s?.status).toBe("stopped");
  });

  it("10. stopping critical service is blocked when DestructiveActionGate is rejected", async () => {
    const { registry, systemApi } = await buildTestRig({
      promptForConsent: () => true,
      destructiveActionConfirmer: async () => false,
    });

    const result = await registry.invoke(
      { id: "svc-10", name: "stop_service", arguments: { name: "WinDefend" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("not confirmed");
    const s = await systemApi.getService("WinDefend");
    expect(s?.status).toBe("running");
  });

  it("11. automation.read cannot authorize service mutation directly", async () => {
    const { capabilityManager } = await buildTestRig({
      promptForConsent: (req) => req.capability === "automation.read",
    });

    await expect(
      capabilityManager.invoke("background_services", "start_service", { name: "wuauserv" }, ACTOR_CTX),
    ).rejects.toThrow(/denied|not granted/i);

    await expect(
      capabilityManager.invoke("background_services", "stop_service", { name: "Spooler" }, ACTOR_CTX),
    ).rejects.toThrow(/denied|not granted/i);
  });

  // ---- TASK SCHEDULER TESTS ----

  it("12. list_scheduled_tasks requires automation.read", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "task-12", name: "list_scheduled_tasks", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.read");
    expect(requestedCaps).not.toContain("automation.execute");
    expect(result.content).toContain("Scheduled Tasks");
    expect(result.content).toContain("Adobe Acrobat Update Task");
  });

  it("13. inspect_scheduled_task requires automation.read", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "task-13", name: "inspect_scheduled_task", arguments: { name: "Adobe Acrobat Update Task" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.read");
    expect(result.content).toContain("State: ready");
    expect(result.content).toContain("update.exe");
  });

  it("14. task reads are blocked when automation.read is denied", async () => {
    const { registry } = await buildTestRig({
      promptForConsent: (req) => req.capability !== "automation.read",
    });

    const result = await registry.invoke(
      { id: "task-14", name: "list_scheduled_tasks", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/not granted|denied/i);
  });

  it("15. run_scheduled_task requires automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry, systemApi } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    const result = await registry.invoke(
      { id: "task-15", name: "run_scheduled_task", arguments: { name: "Adobe Acrobat Update Task" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
    const t = await systemApi.getScheduledTask("Adobe Acrobat Update Task");
    expect(t?.state).toBe("running");
  });

  it("16. enable and disable scheduled task require automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry, systemApi } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });

    await registry.invoke(
      { id: "task-16a", name: "disable_scheduled_task", arguments: { name: "Adobe Acrobat Update Task" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    let t = await systemApi.getScheduledTask("Adobe Acrobat Update Task");
    expect(t?.enabled).toBe(false);

    await registry.invoke(
      { id: "task-16b", name: "enable_scheduled_task", arguments: { name: "Adobe Acrobat Update Task" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    t = await systemApi.getScheduledTask("Adobe Acrobat Update Task");
    expect(t?.enabled).toBe(true);
  });

  it("17. create_scheduled_task requires automation.execute plus persistence confirmation", async () => {
    const requestedCaps: string[] = [];
    const confirmations: { action: string; target: string; reason: string }[] = [];
    const { registry, systemApi } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
      destructiveActionConfirmer: async (req) => {
        confirmations.push(req);
        return true;
      },
    });

    const result = await registry.invoke(
      {
        id: "task-17",
        name: "create_scheduled_task",
        arguments: {
          name: "TestPersistTask",
          executable: "cmd.exe",
          arguments: "/c echo hello",
          description: "Temporary persistence test",
          folderPath: "\\RYPER\\Certification",
        },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
    expect(confirmations.length).toBe(1);
    expect(confirmations[0].action).toBe("create_scheduled_task");
    expect(confirmations[0].reason).toContain("persistent");

    const created = await systemApi.getScheduledTask("TestPersistTask", "\\RYPER\\Certification");
    expect(created).toBeDefined();
    expect(created?.taskName).toBe("TestPersistTask");
  });

  it("18. delete_scheduled_task requires automation.execute plus destructive confirmation", async () => {
    const requestedCaps: string[] = [];
    const confirmations: { action: string; target: string; reason: string }[] = [];
    const { registry, systemApi } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
      destructiveActionConfirmer: async (req) => {
        confirmations.push(req);
        return true;
      },
    });

    // First create it
    await systemApi.createScheduledTask({
      taskName: "TaskToDelete",
      taskPath: "\\RYPER\\Certification",
      executable: "cmd.exe",
    });

    const result = await registry.invoke(
      {
        id: "task-18",
        name: "delete_scheduled_task",
        arguments: { name: "TaskToDelete", folderPath: "\\RYPER\\Certification" },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
    expect(confirmations.some((c) => c.action === "delete_scheduled_task")).toBe(true);

    const deleted = await systemApi.getScheduledTask("TaskToDelete", "\\RYPER\\Certification");
    expect(deleted).toBeUndefined();
  });

  it("19. automation.read alone cannot authorize task mutation or creation directly", async () => {
    const { capabilityManager } = await buildTestRig({
      promptForConsent: (req) => req.capability === "automation.read",
    });

    await expect(
      capabilityManager.invoke("task_scheduler", "run", { name: "Adobe Acrobat Update Task" }, ACTOR_CTX),
    ).rejects.toThrow(/denied|not granted/i);

    await expect(
      capabilityManager.invoke(
        "task_scheduler",
        "create",
        { name: "Persist", executable: "cmd.exe" },
        ACTOR_CTX,
      ),
    ).rejects.toThrow(/denied|not granted/i);
  });

  it("20. denied persistence confirmation blocks task creation", async () => {
    const { registry, systemApi } = await buildTestRig({
      promptForConsent: () => true,
      destructiveActionConfirmer: async () => false,
    });

    const result = await registry.invoke(
      {
        id: "task-20",
        name: "create_scheduled_task",
        arguments: { name: "BlockedTask", executable: "cmd.exe" },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("not confirmed");
    const t = await systemApi.getScheduledTask("BlockedTask");
    expect(t).toBeUndefined();
  });

  it("21. unknown background_services operation fails closed", async () => {
    const { capabilityManager } = await buildTestRig({
      promptForConsent: (req) => req.capability === "automation.read",
    });

    await expect(
      capabilityManager.invoke("background_services", "unmapped_service_op", {}, ACTOR_CTX),
    ).rejects.toThrow(/denied|not granted|automation\.execute/i);
  });

  it("22. unknown task_scheduler operation fails closed", async () => {
    const { capabilityManager } = await buildTestRig({
      promptForConsent: (req) => req.capability === "automation.read",
    });

    await expect(
      capabilityManager.invoke("task_scheduler", "unmapped_task_op", {}, ACTOR_CTX),
    ).rejects.toThrow(/denied|not granted|automation\.execute/i);
  });

  it("23. missing service returns clear message without crashing", async () => {
    const { registry } = await buildTestRig();
    const result = await registry.invoke(
      { id: "svc-23", name: "inspect_service", arguments: { name: "NonExistentService123" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('Windows service "NonExistentService123" was not found.');
  });

  it("24. missing scheduled task returns clear message without crashing", async () => {
    const { registry } = await buildTestRig();
    const result = await registry.invoke(
      { id: "task-24", name: "inspect_scheduled_task", arguments: { name: "NonExistentTask123" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('Scheduled task "NonExistentTask123" was not found.');
  });

  it("25. service search query filtering works accurately", async () => {
    const { registry } = await buildTestRig();
    const result = await registry.invoke(
      { id: "svc-25", name: "list_services", arguments: { query: "spool" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Print Spooler");
    expect(result.content).not.toContain("Windows Update");
  });

  it("26. scheduled task search query filtering works accurately", async () => {
    const { registry } = await buildTestRig();
    const result = await registry.invoke(
      { id: "task-26", name: "list_scheduled_tasks", arguments: { query: "adobe" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Adobe Acrobat Update Task");
    expect(result.content).not.toContain("CreateExplorerShellUnelevatedTask");
  });
});
