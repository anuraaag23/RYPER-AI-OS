import { createLogger } from "@ryper/logging";
import type { DestructiveActionGate } from "./confirmation.js";
import type { WindowsSystemApi } from "./windows-system-api.js";
import type { ProcessInfo } from "./types.js";

const log = createLogger("windows-agent:process-manager");

/**
 * Application Control's process-lifecycle half: enumerate, start, and
 * (with confirmation) terminate processes. Never elevates and never
 * kills a `critical` process without going through the
 * `DestructiveActionGate` first — the brief's "require confirmation for
 * ... terminating critical processes" made concrete.
 */
export class ProcessManager {
  constructor(
    private readonly systemApi: WindowsSystemApi,
    private readonly destructiveGate: DestructiveActionGate,
  ) {}

  list(): Promise<readonly ProcessInfo[]> {
    return this.systemApi.listProcesses();
  }

  get(pid: number): Promise<ProcessInfo | undefined> {
    return this.systemApi.getProcess(pid);
  }

  async start(executablePath: string, args?: readonly string[]): Promise<ProcessInfo> {
    const process = await this.systemApi.startProcess(executablePath, args);
    log.info("process started", { pid: process.pid, name: process.name });
    return process;
  }

  async kill(pid: number, options: { force?: boolean } = {}): Promise<void> {
    const process = await this.systemApi.getProcess(pid);
    if (!process) throw new Error(`no process with pid ${pid}`);
    if (process.critical) {
      await this.destructiveGate.require({
        action: "kill_process",
        target: `${process.name} (pid ${pid})`,
        reason: "this process is marked critical to system stability",
      });
    }
    await this.systemApi.killProcess(pid, options.force ?? false);
    log.info("process killed", { pid, name: process.name });
  }

  async restart(pid: number): Promise<ProcessInfo> {
    const process = await this.systemApi.getProcess(pid);
    if (!process) throw new Error(`no process with pid ${pid}`);
    await this.kill(pid, { force: true });
    return this.start(process.executablePath);
  }
}

export function createProcessManager(
  systemApi: WindowsSystemApi,
  destructiveGate: DestructiveActionGate,
): ProcessManager {
  return new ProcessManager(systemApi, destructiveGate);
}
