import { createLogger } from "@ryper/logging";
import type { SystemTrayHandler, SystemTrayStatus } from "./types.js";

const log = createLogger("windows-agent:tray-manager");

export class TrayManager {
  private handler?: SystemTrayHandler;
  private currentTooltip = "Ryper";
  private isCreated = true;
  private isVisible = true;
  private isDestroyed = false;

  setHandler(handler: SystemTrayHandler): void {
    this.handler = handler;
  }

  async getStatus(): Promise<SystemTrayStatus> {
    if (this.handler) {
      return this.handler.getStatus();
    }
    return {
      created: this.isCreated,
      tooltip: this.currentTooltip,
      visible: this.isVisible,
      destroyed: this.isDestroyed,
    };
  }

  async setTooltip(tooltip: string): Promise<void> {
    if (!tooltip || tooltip.trim().length === 0) {
      throw new Error("tray tooltip cannot be empty");
    }
    if (tooltip.length > 128) {
      throw new Error("tray tooltip exceeds maximum allowed length (128 characters)");
    }
    this.currentTooltip = tooltip.trim();
    if (this.handler) {
      await this.handler.setTooltip(this.currentTooltip);
    }
    log.info("tray tooltip updated", { tooltip: this.currentTooltip });
  }

  async destroy(): Promise<void> {
    this.isDestroyed = true;
    this.isVisible = false;
    if (this.handler?.destroy) {
      await this.handler.destroy();
    }
    log.info("tray destroyed");
  }
}

export function createTrayManager(): TrayManager {
  return new TrayManager();
}
