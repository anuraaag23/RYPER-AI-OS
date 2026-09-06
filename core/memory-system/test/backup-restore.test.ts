import { describe, expect, it } from "vitest";
import { MemoryBackupService } from "../src/backup-restore.js";
import { MemoryEncryption, InMemoryKeyStore } from "../src/encryption.js";
import type { MemoryRecord } from "../src/types.js";

function record(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: overrides.id ?? "id",
    type: "task",
    content: "x",
    tags: [],
    metadata: {},
    importance: 0.5,
    pinned: false,
    lifecycleState: "active",
    createdAt: "now",
    updatedAt: "now",
    version: 1,
    ...overrides,
  };
}

describe("MemoryBackupService", () => {
  it("exportAll/importAll round-trip plain records", () => {
    const service = new MemoryBackupService(new MemoryEncryption(new InMemoryKeyStore()));
    const records = [record({ id: "a" }), record({ id: "b" })];
    const bundle = service.exportAll(records);
    expect(service.importAll(bundle)).toEqual(records);
  });

  it("backup() encrypts the export and restore() decrypts it back to the same records", async () => {
    const service = new MemoryBackupService(new MemoryEncryption(new InMemoryKeyStore()));
    const records = [record({ id: "a", content: "sensitive" })];
    const bundle = await service.backup(records);

    expect(bundle.payload.ciphertext).not.toContain("sensitive");
    const restored = await service.restore(bundle);
    expect(restored).toEqual(records);
  });

  it("restore() fails if the bundle was encrypted with a different key", async () => {
    const serviceA = new MemoryBackupService(new MemoryEncryption(new InMemoryKeyStore()));
    const serviceB = new MemoryBackupService(new MemoryEncryption(new InMemoryKeyStore()));
    const bundle = await serviceA.backup([record({ id: "a" })]);
    await expect(serviceB.restore(bundle)).rejects.toThrow();
  });
});
