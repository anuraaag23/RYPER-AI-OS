import { createLogger } from "@ryper/logging";
import type { WindowsSystemApi } from "./windows-system-api.js";
import type { NotificationHandle, NotificationSpec } from "./types.js";

const log = createLogger("windows-agent:notification-manager");

/** The brief's NOTIFICATIONS section: basic, progress, action, and persistent native Windows notifications. */
export class NotificationManager {
  constructor(private readonly systemApi: WindowsSystemApi) {}

  async show(spec: NotificationSpec): Promise<NotificationHandle> {
    if (spec.kind === "progress" && spec.progressPercent === undefined) {
      throw new Error('a "progress" notification requires progressPercent');
    }
    const handle = await this.systemApi.showNotification(spec);
    log.info("notification shown", { id: handle.id, kind: spec.kind });
    return handle;
  }

  /** Updates an in-flight progress notification's percentage (or any other field). */
  updateProgress(
    id: string,
    current: NotificationSpec,
    progressPercent: number,
  ): Promise<NotificationHandle> {
    return this.systemApi.updateNotification(id, { ...current, kind: "progress", progressPercent });
  }

  update(id: string, spec: NotificationSpec): Promise<NotificationHandle> {
    return this.systemApi.updateNotification(id, spec);
  }

  async dismiss(id: string): Promise<void> {
    await this.systemApi.dismissNotification(id);
    log.info("notification dismissed", { id });
  }
}

export function createNotificationManager(systemApi: WindowsSystemApi): NotificationManager {
  return new NotificationManager(systemApi);
}
