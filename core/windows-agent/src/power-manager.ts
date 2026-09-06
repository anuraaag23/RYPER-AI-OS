import { createLogger } from "@ryper/logging";
import type { DestructiveActionGate } from "./confirmation.js";
import type { WindowsSystemApi } from "./windows-system-api.js";
import type { PowerStatusInfo } from "./types.js";

const log = createLogger("windows-agent:power-manager");

export class PowerActionCancelledError extends Error {}

/**
 * OS power management (see `docs/adr/0030`, PARTs 6-8). Every operation
 * here is real, system-impacting, and irreversible mid-flight — the
 * exact class of action `DestructiveActionGate` exists for (the same
 * gate `FileManager.delete()` already uses), so this reuses it rather
 * than inventing a second confirmation mechanism.
 *
 * Cancellation (PART 8): the gate's `require()` is always awaited
 * *before* the real `systemApi` call, and `signal` is checked again
 * immediately after the confirmation resolves and before that real call
 * — closing the real race the brief calls out: a confirmer that takes
 * real wall-clock time to resolve (a UI dialog, a voice confirmation)
 * gives a caller a genuine window to cancel *during* that wait, and
 * this class honors a cancellation that arrives in that window instead
 * of executing anyway once the (now-stale) "yes" comes back.
 */
export class PowerManager {
  constructor(
    private readonly systemApi: WindowsSystemApi,
    private readonly destructiveGate: DestructiveActionGate,
  ) {}

  async getPowerStatus(): Promise<PowerStatusInfo> {
    return this.systemApi.getPowerStatus();
  }

  async getBatteryStatus(): Promise<{
    batteryLifePercent: number;
    batteryChargeStatus: string;
    isCharging: boolean;
  }> {
    const status = await this.getPowerStatus();
    return {
      batteryLifePercent: status.batteryLifePercent,
      batteryChargeStatus: status.batteryChargeStatus,
      isCharging: status.isCharging,
    };
  }

  async getPowerPlan(): Promise<{ activePowerScheme: string }> {
    const status = await this.getPowerStatus();
    return { activePowerScheme: status.activePowerScheme };
  }

  async getSystemPowerState(): Promise<{
    powerLineStatus: string;
    isPluggedIn: boolean;
    activePowerScheme: string;
    batteryLifePercent: number;
  }> {
    const status = await this.getPowerStatus();
    return {
      powerLineStatus: status.powerLineStatus,
      isPluggedIn: status.isPluggedIn,
      activePowerScheme: status.activePowerScheme,
      batteryLifePercent: status.batteryLifePercent,
    };
  }

  async lock(signal?: AbortSignal): Promise<void> {
    await this.gated("lock", "the workstation screen will lock", signal);
    await this.systemApi.lock();
    log.info("workstation locked");
  }

  async shutdown(signal?: AbortSignal): Promise<void> {
    await this.gated("shutdown", "the machine will power off", signal);
    await this.systemApi.shutdown();
    log.warn("system shutdown executed");
  }

  async restart(signal?: AbortSignal): Promise<void> {
    await this.gated("restart", "the machine will restart, closing all open applications", signal);
    await this.systemApi.restart();
    log.warn("system restart executed");
  }

  async sleep(signal?: AbortSignal): Promise<void> {
    await this.gated("sleep", "the machine will suspend, pausing all running work", signal);
    await this.systemApi.sleep();
    log.info("system sleep executed");
  }

  async hibernate(signal?: AbortSignal): Promise<void> {
    await this.gated("hibernate", "the machine will hibernate to disk, saving open work", signal);
    await this.systemApi.hibernate();
    log.warn("system hibernate executed");
  }

  async signOut(signal?: AbortSignal): Promise<void> {
    await this.gated("signOut", "the current user session will sign out", signal);
    await this.systemApi.signOut();
    log.warn("system signOut executed");
  }

  async cancelShutdown(): Promise<void> {
    await this.systemApi.cancelShutdown();
    log.info("system shutdown cancelled");
  }

  private async gated(action: string, reason: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new PowerActionCancelledError(`"${action}" was cancelled`);
    await this.destructiveGate.require({ action, target: "this PC", reason });
    // Re-check after the (potentially real-time) confirmation wait —
    // see the cancellation-race note on the class doc comment above.
    if (signal?.aborted) throw new PowerActionCancelledError(`"${action}" was cancelled`);
  }
}

export function createPowerManager(
  systemApi: WindowsSystemApi,
  destructiveGate: DestructiveActionGate,
): PowerManager {
  return new PowerManager(systemApi, destructiveGate);
}
