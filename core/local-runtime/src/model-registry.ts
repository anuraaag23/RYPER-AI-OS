import type { InstalledModel, ModelMetadata, ModelType, RuntimeKind } from "./types.js";

export interface ModelQuery {
  readonly type?: ModelType;
  readonly runtime?: RuntimeKind;
  readonly installedOnly?: boolean;
}

/**
 * The metadata database for every model the runtime knows about — both
 * ones merely discovered (catalog entries not yet downloaded) and ones
 * actually installed on disk. `ModelDownloadManager` promotes a catalog
 * entry to installed; `ModelManager.uninstall` demotes it back.
 */
export class ModelRegistry {
  private readonly catalog = new Map<string, ModelMetadata>();
  private readonly installed = new Map<string, InstalledModel>();

  addToCatalog(metadata: ModelMetadata): void {
    this.catalog.set(metadata.id, metadata);
  }

  getMetadata(modelId: string): ModelMetadata | undefined {
    return this.catalog.get(modelId);
  }

  markInstalled(installed: InstalledModel): void {
    this.installed.set(installed.metadata.id, installed);
    if (!this.catalog.has(installed.metadata.id)) {
      this.catalog.set(installed.metadata.id, installed.metadata);
    }
  }

  markUninstalled(modelId: string): boolean {
    return this.installed.delete(modelId);
  }

  getInstalled(modelId: string): InstalledModel | undefined {
    return this.installed.get(modelId);
  }

  isInstalled(modelId: string): boolean {
    return this.installed.has(modelId);
  }

  query(filter: ModelQuery = {}): readonly ModelMetadata[] {
    return [...this.catalog.values()].filter((model) => {
      if (filter.type && model.type !== filter.type) return false;
      if (filter.runtime && model.runtime !== filter.runtime) return false;
      if (filter.installedOnly && !this.installed.has(model.id)) return false;
      return true;
    });
  }

  listInstalled(): readonly InstalledModel[] {
    return [...this.installed.values()];
  }

  totalInstalledBytes(): number {
    return this.listInstalled().reduce((sum, m) => sum + m.sizeBytes, 0);
  }
}

export function createModelRegistry(): ModelRegistry {
  return new ModelRegistry();
}
