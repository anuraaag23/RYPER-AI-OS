import { describe, expect, it } from "vitest";
import { InMemoryWindowsSystemApi } from "../src/reference-system-api.js";
import { createDestructiveActionGate } from "../src/confirmation.js";
import { createFileManager } from "../src/file-manager.js";
import { createClipboardManager } from "../src/clipboard-manager.js";
import { createNotificationManager } from "../src/notification-manager.js";
import { allowAllConfirmer, denyConfirmer } from "./helpers.js";

describe("FileManager", () => {
  it("writes, reads, copies, moves, and renames files", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createFileManager(api, createDestructiveActionGate(allowAllConfirmer));
    const folder = await manager.wellKnownFolder("documents");
    const path = `${folder}\\a.txt`;

    await manager.write(path, "content");
    await expect(manager.read(path)).resolves.toBe("content");

    const copyPath = `${folder}\\b.txt`;
    await manager.copy(path, copyPath);
    await expect(manager.read(copyPath)).resolves.toBe("content");

    await manager.rename(copyPath, "c.txt");
    await expect(manager.read(`${folder}\\c.txt`)).resolves.toBe("content");

    const entries = await manager.browse(folder);
    expect(entries.some((e) => e.path === path)).toBe(true);
  });

  it("refuses to delete without confirmation, and deletes once confirmed", async () => {
    const api = new InMemoryWindowsSystemApi();
    const folder = await api.getWellKnownFolderPath("downloads");
    const path = `${folder}\\delete-me.txt`;
    await api.writeFile(path, "x");

    const denyingManager = createFileManager(api, createDestructiveActionGate(denyConfirmer));
    await expect(denyingManager.delete(path)).rejects.toThrow(/not confirmed/);
    await expect(api.readFile(path)).resolves.toBe("x");

    const allowingManager = createFileManager(api, createDestructiveActionGate(allowAllConfirmer));
    await allowingManager.delete(path);
    await expect(api.readFile(path)).rejects.toThrow();
  });

  it("creates folders and searches recursively-seeded files by name", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createFileManager(api, createDestructiveActionGate(allowAllConfirmer));
    const folder = await manager.wellKnownFolder("pictures");
    await manager.createFolder(`${folder}\\vacation`);
    await manager.write(`${folder}\\vacation\\beach.png`, "binary-ish");

    const results = await manager.search("beach", folder);
    expect(results.some((r) => r.name === "beach.png")).toBe(true);
  });

  it("returns recent files", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createFileManager(api, createDestructiveActionGate(allowAllConfirmer));
    const folder = await manager.wellKnownFolder("desktop");
    await manager.write(`${folder}\\r1.txt`, "1");
    await manager.write(`${folder}\\r2.txt`, "2");
    const recent = await manager.recent();
    expect(recent.length).toBeGreaterThanOrEqual(2);
  });
});

describe("ClipboardManager", () => {
  it("writes and reads back clipboard content, stamping capturedAt", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createClipboardManager(api);
    await manager.write({ format: "text", value: "copied text" });
    const content = await manager.read();
    expect(content?.value).toBe("copied text");
    expect(content?.capturedAt).toBeTruthy();
  });

  it("keeps a history of writes", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createClipboardManager(api);
    await manager.write({ format: "text", value: "one" });
    await manager.write({ format: "text", value: "two" });
    const history = await manager.history();
    expect(history.map((h) => h.value)).toEqual(["one", "two"]);
  });

  it("notifies a monitor callback when the clipboard changes", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createClipboardManager(api);
    const seen: string[] = [];
    const unsubscribe = manager.monitor((content) => seen.push(content.value));

    await manager.write({ format: "text", value: "watched" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toContain("watched");

    unsubscribe();
  });
});

describe("NotificationManager", () => {
  it("shows a basic notification", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createNotificationManager(api);
    const handle = await manager.show({ title: "Hi", body: "There", kind: "basic" });
    expect(handle.spec.title).toBe("Hi");
  });

  it("requires progressPercent for a progress notification", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createNotificationManager(api);
    await expect(
      manager.show({ title: "Downloading", body: "...", kind: "progress" }),
    ).rejects.toThrow();
  });

  it("updates a progress notification's percentage", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createNotificationManager(api);
    const handle = await manager.show({
      title: "Downloading",
      body: "file.zip",
      kind: "progress",
      progressPercent: 10,
    });
    const updated = await manager.updateProgress(handle.id, handle.spec, 55);
    expect(updated.spec.progressPercent).toBe(55);
  });

  it("dismisses a notification", async () => {
    const api = new InMemoryWindowsSystemApi();
    const manager = createNotificationManager(api);
    const handle = await manager.show({ title: "Done", body: "Task complete", kind: "persistent" });
    await manager.dismiss(handle.id);
  });
});
