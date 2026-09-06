export type AuditAction =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "purge"
  | "archive"
  | "restore"
  | "export"
  | "import"
  | "backup"
  | "merge"
  | "split";

export interface AuditEntry {
  readonly action: AuditAction;
  readonly memoryId: string;
  readonly actor: string;
  readonly createdAt: string;
}

/**
 * Append-only by construction (no delete/update method on purpose) — the
 * same design `@ryper/security`'s `CapabilityBroker` uses for its audit
 * log, applied here to memory operations specifically, so a user's "what
 * has touched my memory" view has a single, trustworthy source.
 */
export class MemoryAuditLog {
  private readonly entries: AuditEntry[] = [];

  record(action: AuditAction, memoryId: string, actor: string): void {
    this.entries.push({ action, memoryId, actor, createdAt: new Date().toISOString() });
  }

  all(): readonly AuditEntry[] {
    return this.entries;
  }

  forMemory(memoryId: string): readonly AuditEntry[] {
    return this.entries.filter((e) => e.memoryId === memoryId);
  }
}

export function createMemoryAuditLog(): MemoryAuditLog {
  return new MemoryAuditLog();
}
