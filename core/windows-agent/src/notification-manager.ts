import { createLogger } from "@ryper/logging";
import type { WindowsSystemApi } from "./windows-system-api.js";
import type { NotificationHandle, NotificationSpec } from "./types.js";

const log = createLogger("windows-agent:notification-manager");

/** The brief's NOTIFICATIONS section: basic, progress, action, and persistent native Windows notifications. */
export class NotificationManager {
  private readonly history: NotificationHandle[] = [];

  constructor(private readonly systemApi: WindowsSystemApi) {}

  async show(spec: NotificationSpec): Promise<NotificationHandle> {
    if (!spec.title || typeof spec.title !== "string" || spec.title.trim().length === 0) {
      throw new Error("notification title cannot be empty");
    }
    if (!spec.body || typeof spec.body !== "string" || spec.body.trim().length === 0) {
      throw new Error("notification body cannot be empty");
    }
    if (spec.title.length > 256) {
      throw new Error("notification title exceeds maximum allowed length (256 characters)");
    }
    if (spec.body.length > 2048) {
      throw new Error("notification body exceeds maximum allowed length (2048 characters)");
    }
    if (spec.title.includes("\0") || spec.body.includes("\0")) {
      throw new Error("notification content contains invalid null bytes");
    }
    if (spec.kind === "progress" && spec.progressPercent === undefined) {
      throw new Error('a "progress" notification requires progressPercent');
    }
    const handle = await this.systemApi.showNotification(spec);
    this.history.push(handle);
    log.info("notification shown", { id: handle.id, kind: spec.kind });
    return handle;
  }

  async list(): Promise<readonly NotificationHandle[]> {
    return [...this.history];
  }

  async get(id: string): Promise<NotificationHandle | undefined> {
    return this.history.find((h) => h.id === id);
  }

  /** Updates an in-flight progress notification's percentage (or any other field). */
  updateProgress(
    id: string,
    current: NotificationSpec,
    progressPercent: number,
  ): Promise<NotificationHandle> {
    return this.update(id, { ...current, kind: "progress", progressPercent });
  }

  async update(id: string, spec: NotificationSpec): Promise<NotificationHandle> {
    const updated = await this.systemApi.updateNotification(id, spec);
    const idx = this.history.findIndex((h) => h.id === id);
    if (idx !== -1) {
      this.history[idx] = updated;
    } else {
      this.history.push(updated);
    }
    return updated;
  }

  async dismiss(id: string): Promise<void> {
    await this.systemApi.dismissNotification(id);
    const idx = this.history.findIndex((h) => h.id === id);
    if (idx !== -1) {
      const item = this.history[idx]!;
      this.history[idx] = {
        id: item.id,
        spec: item.spec,
        shownAt: item.shownAt,
        dismissed: true,
      };
    }
    log.info("notification dismissed", { id });
  }
}

export function createNotificationManager(systemApi: WindowsSystemApi): NotificationManager {
  return new NotificationManager(systemApi);
}
