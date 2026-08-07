import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { InMemoryFileSystem } from "../src/filesystem.js";
import { ModelRegistry } from "../src/model-registry.js";
import { VersionManager } from "../src/model-versioning.js";
import { ModelDownloadManager, ModelIntegrityError } from "../src/model-download-manager.js";
import { sampleModel, fakeBytesFetch } from "./fixtures.js";

const goodBytes = new TextEncoder().encode("chat-small-bytes");

function buildManager(bytes: Uint8Array, eventBus?: EventBus) {
  const registry = new ModelRegistry();
  const versionManager = new VersionManager();
  const fileSystem = new InMemoryFileSystem();
  const manager = new ModelDownloadManager(
    fakeBytesFetch(bytes),
    fileSystem,
    registry,
    versionManager,
    "/cache",
    eventBus,
  );
  return { manager, registry, versionManager, fileSystem };
}

describe("ModelDownloadManager", () => {
  it("downloads, verifies, writes, and registers an installed model", async () => {
    const { manager, registry, versionManager, fileSystem } = buildManager(goodBytes);
    const metadata = sampleModel();

    const installed = await manager.download(metadata);

    expect(installed.sizeBytes).toBe(goodBytes.byteLength);
    expect(await fileSystem.exists(installed.localPath)).toBe(true);
    expect(registry.isInstalled(metadata.id)).toBe(true);
    expect(versionManager.getActiveVersion(metadata.id)).toBe(metadata.version);
  });

  it("throws ModelIntegrityError and never installs on a checksum mismatch", async () => {
    const wrongBytes = new TextEncoder().encode("tampered bytes");
    const { manager, registry } = buildManager(wrongBytes);
    const metadata = sampleModel();

    await expect(manager.download(metadata)).rejects.toThrow(ModelIntegrityError);
    expect(registry.isInstalled(metadata.id)).toBe(false);
  });

  it("emits download_progress and model_installed events", async () => {
    const eventBus = new EventBus();
    const { manager } = buildManager(goodBytes, eventBus);
    const seen: string[] = [];
    eventBus.on("local_runtime.download_progress", () => seen.push("progress"));
    eventBus.on("local_runtime.model_installed", () => seen.push("installed"));

    await manager.download(sampleModel());
    expect(seen).toContain("progress");
    expect(seen).toContain("installed");
  });
});
