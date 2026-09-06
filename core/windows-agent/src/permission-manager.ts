import { createLogger } from "@ryper/logging";

const log = createLogger("windows-agent:permission-manager");

export type ElevationPrompt = (reason: string) => Promise<boolean>;

/** The safe default: never elevates. Matches `confirmation.ts`'s `denyAllConfirmer` — silence means "no." */
export const denyElevation: ElevationPrompt = async (reason) => {
  log.warn("elevation request denied: no elevation prompt configured", { reason });
  return false;
};

export interface ElevationRecord {
  readonly reason: string;
  readonly granted: boolean;
  readonly at: string;
}

/**
 * The brief's SECURITY section made concrete for the one thing every
 * other manager needs a single source of truth for: "never elevate
 * privileges automatically ... respect User Account Control (UAC) ...
 * never bypass Windows security mechanisms." This class never elevates
 * itself — every `requestElevation()` call round-trips through the
 * injected `ElevationPrompt`, which is what a real desktop shell wires
 * to an actual UAC consent dialog. There is no method on this class, or
 * anywhere else in this package, that raises a process's privilege level
 * without going through here first.
 */
export class PermissionManager {
  private elevated = false;
  private readonly history: ElevationRecord[] = [];

  constructor(private readonly elevationPrompt: ElevationPrompt = denyElevation) {}

  isElevated(): boolean {
    return this.elevated;
  }

  async requestElevation(reason: string): Promise<boolean> {
    const granted = await this.elevationPrompt(reason);
    this.history.push({ reason, granted, at: new Date().toISOString() });
    log.info("elevation request", { reason, granted });
    if (granted) this.elevated = true;
    return granted;
  }

  elevationHistory(): readonly ElevationRecord[] {
    return [...this.history];
  }
}

export function createPermissionManager(elevationPrompt?: ElevationPrompt): PermissionManager {
  return new PermissionManager(elevationPrompt);
}
