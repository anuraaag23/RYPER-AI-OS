import { createLogger } from "@ryper/logging";
import type { DestructiveActionGate } from "./confirmation.js";
import type { WindowsSystemApi } from "./windows-system-api.js";
import type { ScheduledTaskInfo, ScheduledTaskSpec } from "./types.js";

const log = createLogger("windows-agent:task-scheduler-manager");

/**
 * Windows Task Scheduler Manager.
 * Enforces:
 * - Read-only queries for enumeration and inspection.
 * - Execution capability for run, enable, disable.
 * - Explicit confirmation via `DestructiveActionGate` for `create` (persistence protection)
 *   and `delete` (removal of scheduled task).
 */
export class TaskSchedulerManager {
  constructor(
    private readonly systemApi: WindowsSystemApi,
    private readonly destructiveGate: DestructiveActionGate,
  ) {}

  list(folderPath?: string): Promise<readonly ScheduledTaskInfo[]> {
    return this.systemApi.listScheduledTasks(folderPath);
  }

  get(name: string, folderPath?: string): Promise<ScheduledTaskInfo | undefined> {
    return this.systemApi.getScheduledTask(name, folderPath);
  }

  async run(name: string, folderPath?: string): Promise<void> {
    await this.systemApi.runScheduledTask(name, folderPath);
    log.info("scheduled task started", { name, folderPath });
  }

  async enable(name: string, folderPath?: string): Promise<void> {
    await this.systemApi.enableScheduledTask(name, folderPath);
    log.info("scheduled task enabled", { name, folderPath });
  }

  async disable(name: string, folderPath?: string): Promise<void> {
    await this.systemApi.disableScheduledTask(name, folderPath);
    log.info("scheduled task disabled", { name, folderPath });
  }

  async create(spec: ScheduledTaskSpec): Promise<void> {
    await this.destructiveGate.require({
      action: "create_scheduled_task",
      target: `${spec.taskPath ?? "\\"}${spec.taskName} -> ${spec.executable}${spec.arguments ? " " + spec.arguments : ""}`,
      reason: "creating a scheduled task establishes persistent background execution on this computer",
    });
    await this.systemApi.createScheduledTask(spec);
    log.info("scheduled task created", { spec });
  }

  async delete(name: string, folderPath?: string): Promise<void> {
    await this.destructiveGate.require({
      action: "delete_scheduled_task",
      target: `${folderPath ?? "\\"}${name}`,
      reason: "deleting a scheduled task permanently removes its automated execution schedule",
    });
    await this.systemApi.deleteScheduledTask(name, folderPath);
    log.info("scheduled task deleted", { name, folderPath });
  }
}

export function createTaskSchedulerManager(
  systemApi: WindowsSystemApi,
  destructiveGate: DestructiveActionGate,
): TaskSchedulerManager {
  return new TaskSchedulerManager(systemApi, destructiveGate);
}
