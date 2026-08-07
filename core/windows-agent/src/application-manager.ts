import { createLogger } from "@ryper/logging";
import type { WindowsSystemApi } from "./windows-system-api.js";
import type { AppInfo, ProcessInfo } from "./types.js";

const log = createLogger("windows-agent:application-manager");

/**
 * The brief's APPLICATION CONTROL section: launch/close/restart
 * installed applications, enumerate them, and open URLs/files via the
 * OS-registered default handler.
 */
export class ApplicationManager {
  constructor(private readonly systemApi: WindowsSystemApi) {}

  listInstalled(): Promise<readonly AppInfo[]> {
    return this.systemApi.listInstalledApplications();
  }

  listRunning(): Promise<readonly AppInfo[]> {
    return this.systemApi.listRunningApplications();
  }

  async launch(appId: string, args?: readonly string[]): Promise<ProcessInfo> {
    const process = await this.systemApi.launchApplication(appId, args);
    log.info("application launched", { appId, pid: process.pid });
    return process;
  }

  async close(appId: string): Promise<void> {
    await this.systemApi.closeApplication(appId);
    log.info("application closed", { appId });
  }

  async restart(appId: string): Promise<ProcessInfo> {
    await this.close(appId);
    return this.launch(appId);
  }

  async openUrl(url: string): Promise<void> {
    await this.systemApi.openUrl(url);
    log.info("URL opened", { url });
  }

  async openFile(path: string): Promise<void> {
    await this.systemApi.openFile(path);
    log.info("file opened with its associated application", { path });
  }
}

export function createApplicationManager(systemApi: WindowsSystemApi): ApplicationManager {
  return new ApplicationManager(systemApi);
}
