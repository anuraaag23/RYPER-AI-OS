import { describe, expect, it } from "vitest";
import { MemoryStore, InMemoryPersistence } from "../src/memory-store.js";
import { sampleInput } from "./fixtures.js";

describe("MemoryStore", () => {
  it("creates a record with version 1 and active lifecycle", async () => {
    const store = new MemoryStore(new InMemoryPersistence());
    const record = await store.create(sampleInput());
    expect(record.version).toBe(1);
    expect(record.lifecycleState).toBe("active");
    expect(store.get(record.id)).toEqual(record);
  });

  it("update() bumps the version and updatedAt", async () => {
    const store = new MemoryStore(new InMemoryPersistence());
    const record = await store.create(sampleInput());
    const updated = await store.update(record.id, { content: "prefers light mode" });
    expect(updated.version).toBe(2);
    expect(updated.content).toBe("prefers light mode");
  });

  it("update() throws for a deleted record", async () => {
    const store = new MemoryStore(new InMemoryPersistence());
    const record = await store.create(sampleInput());
    await store.delete(record.id);
    await expect(store.update(record.id, { content: "x" })).rejects.toThrow(/deleted/);
  });

  it("delete() is soft — the record remains retrievable but marked deleted", async () => {
    const store = new MemoryStore(new InMemoryPersistence());
    const record = await store.create(sampleInput());
    expect(await store.delete(record.id)).toBe(true);
    expect(store.get(record.id)?.lifecycleState).toBe("deleted");
    expect(store.listActive()).toHaveLength(0);
  });

  it("purge() removes the record entirely", async () => {
    const store = new MemoryStore(new InMemoryPersistence());
    const record = await store.create(sampleInput());
    expect(await store.purge(record.id)).toBe(true);
    expect(store.get(record.id)).toBeUndefined();
  });

  it("setLifecycleState() archives and restores", async () => {
    const store = new MemoryStore(new InMemoryPersistence());
    const record = await store.create(sampleInput());
    await store.setLifecycleState(record.id, "archived");
    expect(store.get(record.id)?.lifecycleState).toBe("archived");
    await store.setLifecycleState(record.id, "active");
    expect(store.get(record.id)?.lifecycleState).toBe("active");
  });

  it("hydrate() loads existing records from persistence exactly once", async () => {
    const persistence = new InMemoryPersistence();
    const seed = new MemoryStore(persistence);
    await seed.create(sampleInput());

    const store = new MemoryStore(persistence);
    await store.hydrate();
    expect(store.listAll()).toHaveLength(1);
    await store.hydrate(); // second call is a no-op, not a duplicate load
    expect(store.listAll()).toHaveLength(1);
  });

  it("put() replaces a record wholesale, used by sync/rollback", async () => {
    const store = new MemoryStore(new InMemoryPersistence());
    const record = await store.create(sampleInput());
    await store.put({ ...record, content: "replaced wholesale" });
    expect(store.get(record.id)?.content).toBe("replaced wholesale");
  });
});
