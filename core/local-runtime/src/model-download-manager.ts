import { createLogger } from "@ryper/logging";
import type { EventBus } from "@ryper/event-bus";
import { assertOk, type HttpFetch } from "@ryper/ai-engine";
import type { InstalledModel, ModelMetadata } from "./types.js";
import type { FileSystemLike } from "./filesystem.js";
import type { ModelRegistry } from "./model-registry.js";
import type { VersionManager } from "./model-versioning.js";
import { verifyChecksum } from "./checksum.js";

const log = createLogger("local-runtime:download-manager");

export class ModelIntegrityError extends Error {
  constructor(modelId: string) {
    super(`downloaded bytes for model "${modelId}" failed checksum verification`);
    this.name = "ModelIntegrityError";
  }
}

export interface DownloadProgressEvent {
  readonly modelId: string;
  readonly bytesDownloaded: number;
  readonly totalBytes: number;
}

function modelPath(cacheDir: string, metadata: ModelMetadata): string {
  return `${cacheDir}/${metadata.id}-${metadata.version}.bin`;
}

async function collectBody(
  body: AsyncIterable<Uint8Array>,
  onChunk: (bytesSoFar: number) => void,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    chunks.push(chunk);
    total += chunk.byteLength;
    onChunk(total);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * Downloads a catalog model's bytes, verifies its SHA-256 against the
 * metadata's published checksum, writes it into the cache directory, and
 * promotes it to "installed" in both the registry and the version
 * history. A failed checksum never reaches disk as an installed model —
 * it's surfaced as `ModelIntegrityError` instead.
 */
export class ModelDownloadManager {
  constructor(
    private readonly httpFetch: HttpFetch,
    private readonly fileSystem: FileSystemLike,
    private readonly registry: ModelRegistry,
    private readonly versionManager: VersionManager,
    private readonly cacheDir: string,
    private readonly eventBus?: EventBus,
  ) {}

  async download(metadata: ModelMetadata, signal?: AbortSignal): Promise<InstalledModel> {
    await this.fileSystem.mkdir(this.cacheDir);

    const response = await this.httpFetch(metadata.downloadUrl, {
      method: "GET",
      headers: {},
      ...(signal ? { signal } : {}),
    });
    await assertOk(response);

    const body = response.body();
    if (!body) {
      throw new Error(`download of model "${metadata.id}" produced no streamable body`);
    }

    const bytes = await collectBody(body, (bytesSoFar) => {
      void this.eventBus?.emit(
        "local_runtime.download_progress",
        {
          modelId: metadata.id,
          bytesDownloaded: bytesSoFar,
          totalBytes: metadata.requirements.approxDiskBytes,
        },
        "local-runtime",
      );
    });

    if (!verifyChecksum(bytes, metadata.sha256)) {
      throw new ModelIntegrityError(metadata.id);
    }

    const path = modelPath(this.cacheDir, metadata);
    await this.fileSystem.writeFile(path, bytes);

    const installedAt = new Date().toISOString();
    const installed: InstalledModel = {
      metadata,
      localPath: path,
      installedAt,
      sizeBytes: bytes.byteLength,
      active: true,
    };

    this.registry.markInstalled(installed);
    this.versionManager.recordInstall(metadata.id, {
      version: metadata.version,
      localPath: path,
      installedAt,
    });

    await this.eventBus?.emit(
      "local_runtime.model_installed",
      { modelId: metadata.id, version: metadata.version },
      "local-runtime",
    );
    log.info("model installed", {
      modelId: metadata.id,
      version: metadata.version,
      sizeBytes: bytes.byteLength,
    });

    return installed;
  }
}

export function createModelDownloadManager(
  httpFetch: HttpFetch,
  fileSystem: FileSystemLike,
  registry: ModelRegistry,
  versionManager: VersionManager,
  cacheDir: string,
  eventBus?: EventBus,
): ModelDownloadManager {
  return new ModelDownloadManager(
    httpFetch,
    fileSystem,
    registry,
    versionManager,
    cacheDir,
    eventBus,
  );
}
