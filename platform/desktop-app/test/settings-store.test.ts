import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SettingsStore } from "../electron/settings-store.js";

describe("SettingsStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ryper-settings-"));
    filePath = join(dir, "nested", "settings.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns defaults when no file exists yet", async () => {
    const store = new SettingsStore(filePath);
    await expect(store.load()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it("persists updates to a real file, creating parent directories", async () => {
    const store = new SettingsStore(filePath);
    const updated = await store.update({ theme: "dark", voiceEnabled: true });
    expect(updated.theme).toBe("dark");
    expect(updated.voiceEnabled).toBe(true);

    // A fresh store instance reading the same path sees the persisted change.
    const reloaded = new SettingsStore(filePath);
    await expect(reloaded.load()).resolves.toMatchObject({ theme: "dark", voiceEnabled: true });
  });

  it("caches after the first load, avoiding re-reading the file", async () => {
    const store = new SettingsStore(filePath);
    await store.update({ theme: "light" });
    const first = await store.load();
    const second = await store.load();
    expect(first).toBe(second);
  });

  it("sanitizes malformed on-disk JSON field-by-field rather than trusting it blindly", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "nested"), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({ theme: "not-a-real-theme", voiceEnabled: "yes", launchAtLogin: true }),
      "utf-8",
    );
    const store = new SettingsStore(filePath);
    const loaded = await store.load();
    expect(loaded.theme).toBe(DEFAULT_SETTINGS.theme); // invalid -> fell back to default
    expect(loaded.voiceEnabled).toBe(DEFAULT_SETTINGS.voiceEnabled); // wrong type -> fell back
    expect(loaded.launchAtLogin).toBe(true); // valid -> kept
  });

  it("merges partial updates without discarding untouched fields", async () => {
    const store = new SettingsStore(filePath);
    await store.update({ theme: "dark" });
    const updated = await store.update({ voiceEnabled: true });
    expect(updated).toEqual({ ...DEFAULT_SETTINGS, theme: "dark", voiceEnabled: true });
  });

  it("persists and reloads a real preferredBrowserId", async () => {
    const store = new SettingsStore(filePath);
    const updated = await store.update({ preferredBrowserId: "edge" });
    expect(updated.preferredBrowserId).toBe("edge");

    const reloaded = new SettingsStore(filePath);
    await expect(reloaded.load()).resolves.toMatchObject({ preferredBrowserId: "edge" });
  });

  it("sanitizes a malformed on-disk preferredBrowserId (wrong type or empty) to absent, not a crash", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "nested"), { recursive: true });
    await writeFile(filePath, JSON.stringify({ preferredBrowserId: 42 }), "utf-8");
    const store = new SettingsStore(filePath);
    const loaded = await store.load();
    expect(loaded.preferredBrowserId).toBeUndefined();
  });

  it("getCached() is undefined before load() and returns the loaded value after", async () => {
    const store = new SettingsStore(filePath);
    expect(store.getCached()).toBeUndefined();
    await store.load();
    expect(store.getCached()).toEqual(DEFAULT_SETTINGS);
  });
});
