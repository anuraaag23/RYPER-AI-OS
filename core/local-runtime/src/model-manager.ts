import { createLogger } from "@ryper/logging";
import type { EventBus } from "@ryper/event-bus";
import type { ModelMetadata, InstalledModel } from "./types.js";
import type { FileSystemLike } from "./filesystem.js";
import type { ModelRegistry } from "./model-registry.js";
import type { ModelDownloadManager } from "./model-download-manager.js";
import { ModelVerifier, type VerificationResult } from "./model-verification.js";
import { isNewerVersion, type VersionManager } from "./model-versioning.js";
import type { ModelCache, DiskUsageReport } from "./model-cache.js";

const log = createLogger("local-runtime:model-manager");

export interface ModelBundle {
  readonly metadata: ModelMetadata;
  readonly base64Bytes: string;
}

export interface UpdateCheckResult {
  readonly modelId: string;
  readonly currentVersion: string | undefined;
  readonly latestAvailableVersion: string;
  readonly updateAvailable: boolean;
}

/**
 * The single entry point for every model lifecycle operation the brief
 * requires (install, uninstall, verify, update, rollback, export, import,
 * integrity checks, disk usage, cleanup). It composes the download
 * manager, verifier, version manager, and cache rather than reimplementing
 * their logic.
 */
export class ModelManager {
  private readonly verifier: ModelVerifier;

  constructor(
    private readonly registry: ModelRegistry,
    private readonly downloadManager: ModelDownloadManager,
    private readonly versionManager: VersionManager,
    private readonly cache: ModelCache,
    private readonly fileSystem: FileSystemLike,
    private readonly eventBus?: EventBus,
  ) {
    this.verifier = new ModelVerifier(fileSystem);
  }

  async install(modelId: string, signal?: AbortSignal): Promise<InstalledModel> {
    const metadata = this.registry.getMetadata(modelId);
    if (!metadata) {
      throw new Error(`model "${modelId}" is not in the catalog — run discovery first`);
    }
    const installed = await this.downloadManager.download(metadata, signal);
    await this.cache.enforceLimit();
    return installed;
  }

  async uninstall(modelId: string): Promise<boolean> {
    const installed = this.registry.getInstalled(modelId);
    if (!installed) return false;
    await this.fileSystem.deleteFile(installed.localPath);
    this.registry.markUninstalled(modelId);
    this.versionManager.forget(modelId);
    await this.eventBus?.emit("local_runtime.model_uninstalled", { modelId }, "local-runtime");
    log.info("model uninstalled", { modelId });
    return true;
  }

  async verify(modelId: string): Promise<VerificationResult> {
    const installed = this.registry.getInstalled(modelId);
    if (!installed) {
      return { modelId, status: "missing" };
    }
    return this.verifier.verify(installed);
  }

  checkForUpdate(modelId: string, latestCatalogMetadata: ModelMetadata): UpdateCheckResult {
    const currentVersion = this.versionManager.getActiveVersion(modelId);
    return {
      modelId,
      currentVersion,
      latestAvailableVersion: latestCatalogMetadata.version,
      updateAvailable:
        currentVersion === undefined ||
        isNewerVersion(latestCatalogMetadata.version, currentVersion),
    };
  }

  /** Downloads the new version alongside the old one; the old version's files remain on disk until a rollback needs them or cache pressure evicts them. */
  async update(
    latestCatalogMetadata: ModelMetadata,
    signal?: AbortSignal,
  ): Promise<InstalledModel> {
    this.registry.addToCatalog(latestCatalogMetadata);
    const installed = await this.downloadManager.download(latestCatalogMetadata, signal);
    await this.eventBus?.emit(
      "local_runtime.model_updated",
      { modelId: latestCatalogMetadata.id, version: latestCatalogMetadata.version },
      "local-runtime",
    );
    return installed;
  }

  /** Repoints the active version to the previous install without re-downloading. Throws if there's nothing to roll back to. */
  async rollback(modelId: string): Promise<InstalledModel> {
    const previous = this.versionManager.rollback(modelId);
    if (!previous) {
      throw new Error(`no previous version of model "${modelId}" to roll back to`);
    }
    const metadata = this.registry.getMetadata(modelId);
    if (!metadata) {
      throw new Error(`model "${modelId}" metadata not found in registry`);
    }
    const size = await this.fileSystem.statSize(previous.localPath);
    const installed: InstalledModel = {
      metadata: { ...metadata, version: previous.version },
      localPath: previous.localPath,
      installedAt: previous.installedAt,
      sizeBytes: size,
      active: true,
    };
    this.registry.markInstalled(installed);
    await this.eventBus?.emit(
      "local_runtime.model_rolled_back",
      { modelId, restoredVersion: previous.version },
      "local-runtime",
    );
    log.info("model rolled back", { modelId, restoredVersion: previous.version });
    return installed;
  }

  async exportModel(modelId: string): Promise<ModelBundle> {
    const installed = this.registry.getInstalled(modelId);
    if (!installed) {
      throw new Error(`model "${modelId}" is not installed`);
    }
    const bytes = await this.fileSystem.readFile(installed.localPath);
    return { metadata: installed.metadata, base64Bytes: Buffer.from(bytes).toString("base64") };
  }

  async importModel(bundle: ModelBundle): Promise<InstalledModel> {
    const bytes = Buffer.from(bundle.base64Bytes, "base64");
    const path = `imported-${bundle.metadata.id}-${bundle.metadata.version}.bin`;
    await this.fileSystem.writeFile(path, bytes);

    const installedAt = new Date().toISOString();
    const installed: InstalledModel = {
      metadata: bundle.metadata,
      localPath: path,
      installedAt,
      sizeBytes: bytes.byteLength,
      active: true,
    };
    this.registry.markInstalled(installed);
    this.versionManager.recordInstall(bundle.metadata.id, {
      version: bundle.metadata.version,
      localPath: path,
      installedAt,
    });

    const verification = await this.verifier.verify(installed);
    if (verification.status !== "ok") {
      await this.fileSystem.deleteFile(path);
      this.registry.markUninstalled(bundle.metadata.id);
      throw new Error(
        `imported model "${bundle.metadata.id}" failed integrity verification: ${verification.status}`,
      );
    }

    log.info("model imported", { modelId: bundle.metadata.id, version: bundle.metadata.version });
    return installed;
  }

  diskUsage(): DiskUsageReport {
    return this.cache.diskUsage();
  }

  async cleanup(): Promise<readonly string[]> {
    return this.cache.enforceLimit();
  }
}

export function createModelManager(
  registry: ModelRegistry,
  downloadManager: ModelDownloadManager,
  versionManager: VersionManager,
  cache: ModelCache,
  fileSystem: FileSystemLike,
  eventBus?: EventBus,
): ModelManager {
  return new ModelManager(registry, downloadManager, versionManager, cache, fileSystem, eventBus);
}
