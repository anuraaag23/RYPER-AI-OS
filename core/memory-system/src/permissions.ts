import { createLogger } from "@ryper/logging";

const log = createLogger("memory-system:permissions");

/**
 * Independently typed from `@ryper/security`'s `Capability` union on
 * purpose — that type is closed and shared by unrelated modules
 * (filesystem, mic, camera, ...), and extending it here would mean
 * modifying a package this phase doesn't own. Memory operations get their
 * own small, equally capability-broker-shaped permission model instead.
 */
export type MemoryOperation =
  "view" | "edit" | "delete" | "export" | "import" | "disable" | "enable";

export type ConsentPrompt = (operation: MemoryOperation) => Promise<boolean> | boolean;

/**
 * The single global switch: when memory is disabled, `MemoryManager`
 * refuses every read/write (see its `assertEnabled` guard) — "disable
 * memory" is a real, load-bearing state here, not a UI toggle that only
 * hides things.
 */
export class MemoryPermissions {
  private enabled = true;
  private readonly grants = new Set<MemoryOperation>([
    "view",
    "edit",
    "delete",
    "export",
    "import",
  ]);

  constructor(private readonly promptForConsent?: ConsentPrompt) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  async disable(): Promise<void> {
    this.enabled = false;
    log.info("memory disabled by user");
  }

  async enable(): Promise<void> {
    this.enabled = true;
    log.info("memory enabled by user");
  }

  async requestGrant(operation: MemoryOperation): Promise<boolean> {
    const approved = this.promptForConsent ? await this.promptForConsent(operation) : true;
    if (approved) {
      this.grants.add(operation);
    } else {
      this.grants.delete(operation);
    }
    return approved;
  }

  revoke(operation: MemoryOperation): void {
    this.grants.delete(operation);
  }

  isGranted(operation: MemoryOperation): boolean {
    return this.grants.has(operation);
  }

  assertGranted(operation: MemoryOperation): void {
    if (!this.isGranted(operation)) {
      throw new Error(`memory operation "${operation}" is not permitted`);
    }
  }
}

export function createMemoryPermissions(promptForConsent?: ConsentPrompt): MemoryPermissions {
  return new MemoryPermissions(promptForConsent);
}
