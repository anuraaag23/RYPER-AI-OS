import { createLogger } from "@ryper/logging";
import type { DestructiveActionGate } from "./confirmation.js";
import type { WindowsSystemApi } from "./windows-system-api.js";
import type { ServiceInfo, ServiceStatus } from "./types.js";

const log = createLogger("windows-agent:service-manager");

/**
 * Windows Service Manager — one of the brief's named core modules.
 * Lists, starts, and stops Windows services, requiring confirmation
 * before stopping/restarting a service marked `critical` (the same
 * "require confirmation for ... changing sensitive system settings"
 * rule `ProcessManager` applies to critical processes).
 */
export class ServiceManager {
  constructor(
    private readonly systemApi: WindowsSystemApi,
    private readonly destructiveGate: DestructiveActionGate,
  ) {}

  list(): Promise<readonly ServiceInfo[]> {
    return this.systemApi.listServices();
  }

  status(name: string): Promise<ServiceStatus> {
    return this.systemApi.getServiceStatus(name);
  }

  get(name: string): Promise<ServiceInfo | undefined> {
    return this.systemApi.getService(name);
  }

  async start(name: string): Promise<void> {
    await this.systemApi.startService(name);
    log.info("service started", { name });
  }

  private async requireService(name: string): Promise<ServiceInfo> {
    const service = await this.systemApi.getService(name);
    if (!service) throw new Error(`no service named "${name}"`);
    return service;
  }

  async stop(name: string): Promise<void> {
    const service = await this.requireService(name);
    if (service.critical) {
      await this.destructiveGate.require({
        action: "stop_service",
        target: service.displayName,
        reason: "this service is marked critical to system stability",
      });
    }
    await this.systemApi.stopService(name);
    log.info("service stopped", { name });
  }

  async restart(name: string): Promise<void> {
    await this.stop(name);
    await this.start(name);
  }

  async pause(name: string): Promise<void> {
    await this.systemApi.pauseService(name);
    log.info("service paused", { name });
  }

  async resume(name: string): Promise<void> {
    await this.systemApi.resumeService(name);
    log.info("service resumed", { name });
  }

  async delete(name: string): Promise<void> {
    const service = await this.requireService(name);
    await this.destructiveGate.require({
      action: "delete_service",
      target: `${service.displayName} (${service.name})`,
      reason: "deleting a Windows service permanently removes the service configuration and background execution",
    });
    await this.systemApi.deleteService(name);
    log.info("service deleted", { name });
  }
}

export function createServiceManager(
  systemApi: WindowsSystemApi,
  destructiveGate: DestructiveActionGate,
): ServiceManager {
  return new ServiceManager(systemApi, destructiveGate);
}
