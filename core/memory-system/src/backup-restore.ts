import type { MemoryRecord } from "./types.js";
import type { MemoryEncryption, EncryptedPayload } from "./encryption.js";

export interface MemoryExportBundle {
  readonly exportedAt: string;
  readonly records: readonly MemoryRecord[];
}

export interface MemoryBackupBundle {
  readonly backedUpAt: string;
  readonly payload: EncryptedPayload;
}

/**
 * Two distinct flows, both required by the brief: `exportAll`/`importAll`
 * produce/consume plain JSON (the "download my data" / "load my data"
 * user-facing feature — deliberately unencrypted so it's portable and
 * human-inspectable), while `backup`/`restore` wrap the same data in
 * `MemoryEncryption` for at-rest recovery bundles.
 */
export class MemoryBackupService {
  constructor(private readonly encryption: MemoryEncryption) {}

  exportAll(records: readonly MemoryRecord[]): MemoryExportBundle {
    return { exportedAt: new Date().toISOString(), records };
  }

  importAll(bundle: MemoryExportBundle): readonly MemoryRecord[] {
    return bundle.records;
  }

  async backup(records: readonly MemoryRecord[]): Promise<MemoryBackupBundle> {
    const plaintext = JSON.stringify(this.exportAll(records));
    const payload = await this.encryption.encrypt(plaintext);
    return { backedUpAt: new Date().toISOString(), payload };
  }

  async restore(bundle: MemoryBackupBundle): Promise<readonly MemoryRecord[]> {
    const plaintext = await this.encryption.decrypt(bundle.payload);
    const parsed = JSON.parse(plaintext) as MemoryExportBundle;
    return this.importAll(parsed);
  }
}

export function createMemoryBackupService(encryption: MemoryEncryption): MemoryBackupService {
  return new MemoryBackupService(encryption);
}
