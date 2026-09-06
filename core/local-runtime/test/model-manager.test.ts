import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../src/filesystem.js";
import { ModelRegistry } from "../src/model-registry.js";
import { VersionManager } from "../src/model-versioning.js";
import { ModelDownloadManager } from "../src/model-download-manager.js";
import { ModelCache } from "../src/model-cache.js";
import { ModelManager } from "../src/model-manager.js";
import { sha256Hex } from "../src/checksum.js";
import { sampleModel, fakeBytesFetch } from "./fixtures.js";

interface Harness {
  readonly manager: ModelManager;
  readonly registry: ModelRegistry;
  readonly versionManager: VersionManager;
  readonly fileSystem: InMemoryFileSystem;
  readonly cache: ModelCache;
}

function buildHarness(bytes: Uint8Array, maxCacheBytes = 1_000_000): Harness {
  const registry = new ModelRegistry();
  const versionManager = new VersionManager();
  const fileSystem = new InMemoryFileSystem();
  const downloadManager = new ModelDownloadManager(
    fakeBytesFetch(bytes),
    fileSystem,
    registry,
    versionManager,
    "/cache",
  );
  const cache = new ModelCache(registry, fileSystem, maxCacheBytes);
  const manager = new ModelManager(registry, downloadManager, versionManager, cache, fileSystem);
  return { manager, registry, versionManager, fileSystem, cache };
}

/** Builds a second ModelManager sharing the same registry/version history/filesystem/cache but a different download source — used to simulate "the update download serves different bytes than the original install." */
function withDifferentDownloadSource(harness: Harness, bytes: Uint8Array): ModelManager {
  const downloadManager = new ModelDownloadManager(
    fakeBytesFetch(bytes),
    harness.fileSystem,
    harness.registry,
    harness.versionManager,
    "/cache",
  );
  return new ModelManager(
    harness.registry,
    downloadManager,
    harness.versionManager,
    harness.cache,
    harness.fileSystem,
  );
}

const bytesV1 = new TextEncoder().encode("chat-small-bytes");

describe("ModelManager", () => {
  it("install() requires the model to already be in the catalog", async () => {
    const { manager, registry } = buildHarness(bytesV1);
    await expect(manager.install("chat-small")).rejects.toThrow(/not in the catalog/);
    registry.addToCatalog(sampleModel());
    await expect(manager.install("chat-small")).resolves.toBeDefined();
  });

  it("uninstall() removes the file and registry entry, and returns false for a model that wasn't installed", async () => {
    const { manager, registry, fileSystem } = buildHarness(bytesV1);
    registry.addToCatalog(sampleModel());
    const installed = await manager.install("chat-small");

    expect(await manager.uninstall("chat-small")).toBe(true);
    expect(await fileSystem.exists(installed.localPath)).toBe(false);
    expect(registry.isInstalled("chat-small")).toBe(false);
    expect(await manager.uninstall("chat-small")).toBe(false);
  });

  it("verify() reflects the current on-disk state", async () => {
    const { manager, registry } = buildHarness(bytesV1);
    registry.addToCatalog(sampleModel());
    await manager.install("chat-small");
    expect((await manager.verify("chat-small")).status).toBe("ok");
  });

  it("checkForUpdate() reports whether a newer catalog version is available", async () => {
    const { manager, registry } = buildHarness(bytesV1);
    registry.addToCatalog(sampleModel({ version: "1.0.0" }));
    await manager.install("chat-small");

    expect(
      manager.checkForUpdate("chat-small", sampleModel({ version: "1.0.0" })).updateAvailable,
    ).toBe(false);
    expect(
      manager.checkForUpdate("chat-small", sampleModel({ version: "2.0.0" })).updateAvailable,
    ).toBe(true);
  });

  it("update() installs the new version and rollback() restores the previous one without re-downloading", async () => {
    const harness = buildHarness(bytesV1);
    harness.registry.addToCatalog(sampleModel({ version: "1.0.0" }));
    await harness.manager.install("chat-small");
    expect(harness.versionManager.getActiveVersion("chat-small")).toBe("1.0.0");

    const bytesV2 = new TextEncoder().encode("chat-small-bytes-v2");
    const managerV2 = withDifferentDownloadSource(harness, bytesV2);
    const v2Metadata = sampleModel({ version: "2.0.0", sha256: sha256Hex(bytesV2) });

    await managerV2.update(v2Metadata);
    expect(harness.versionManager.getActiveVersion("chat-small")).toBe("2.0.0");

    const restored = await managerV2.rollback("chat-small");
    expect(restored.metadata.version).toBe("1.0.0");
    expect(harness.versionManager.getActiveVersion("chat-small")).toBe("1.0.0");
  });

  it("rollback() throws when there is nothing earlier to restore", async () => {
    const { manager, registry } = buildHarness(bytesV1);
    registry.addToCatalog(sampleModel());
    await manager.install("chat-small");
    await expect(manager.rollback("chat-small")).rejects.toThrow(/no previous version/);
  });

  it("export then import round-trips a model, verifying integrity on import", async () => {
    const { manager, registry } = buildHarness(bytesV1);
    registry.addToCatalog(sampleModel());
    await manager.install("chat-small");

    const bundle = await manager.exportModel("chat-small");
    await manager.uninstall("chat-small");
    expect(registry.isInstalled("chat-small")).toBe(false);

    const reimported = await manager.importModel(bundle);
    expect(reimported.metadata.id).toBe("chat-small");
    expect(registry.isInstalled("chat-small")).toBe(true);
  });

  it("importModel() rejects a bundle whose bytes don't match its declared checksum", async () => {
    const { manager } = buildHarness(bytesV1);
    const badBundle = {
      metadata: sampleModel({ sha256: "0".repeat(64) }),
      base64Bytes: Buffer.from(bytesV1).toString("base64"),
    };
    await expect(manager.importModel(badBundle)).rejects.toThrow(/integrity verification/);
  });

  it("diskUsage() reports installed model sizes", async () => {
    const { manager, registry } = buildHarness(bytesV1, 1_000_000);
    registry.addToCatalog(sampleModel());
    await manager.install("chat-small");
    expect(manager.diskUsage().totalBytes).toBeGreaterThan(0);
  });

  it("cleanup() evicts installed models once they exceed the configured cache budget", async () => {
    const harness = buildHarness(bytesV1, 1_000_000);
    harness.registry.addToCatalog(sampleModel());
    await harness.manager.install("chat-small");
    expect(harness.registry.isInstalled("chat-small")).toBe(true);

    // Tighten the budget after install so cleanup() (not install()'s own
    // enforceLimit call) is what triggers eviction.
    const tinyCache = new ModelCache(harness.registry, harness.fileSystem, 1);
    const tightManager = new ModelManager(
      harness.registry,
      new ModelDownloadManager(
        fakeBytesFetch(bytesV1),
        harness.fileSystem,
        harness.registry,
        harness.versionManager,
        "/cache",
      ),
      harness.versionManager,
      tinyCache,
      harness.fileSystem,
    );
    const evicted = await tightManager.cleanup();
    expect(evicted).toContain("chat-small");
  });
});
