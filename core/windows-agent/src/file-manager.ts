import { createLogger } from "@ryper/logging";
import type { DestructiveActionGate } from "./confirmation.js";
import type { WindowsSystemApi } from "./windows-system-api.js";
import type { FileEntry, WellKnownFolder } from "./types.js";

const log = createLogger("windows-agent:file-manager");

/**
 * The brief's FILESYSTEM section, respecting Windows permissions (via
 * whatever the injected `WindowsSystemApi` itself enforces — this class
 * never bypasses them) and requiring confirmation before `delete`, the
 * one destructive filesystem operation the brief explicitly calls out.
 */
export class FileManager {
  constructor(
    private readonly systemApi: WindowsSystemApi,
    private readonly destructiveGate: DestructiveActionGate,
  ) {}

  browse(path: string): Promise<readonly FileEntry[]> {
    return this.systemApi.listDirectory(path);
  }

  read(path: string): Promise<string> {
    return this.systemApi.readFile(path);
  }

  async write(path: string, content: string): Promise<void> {
    await this.systemApi.writeFile(path, content);
    log.info("file written", { path, bytes: content.length });
  }

  async copy(sourcePath: string, destinationPath: string): Promise<void> {
    await this.systemApi.copyEntry(sourcePath, destinationPath);
  }

  async move(sourcePath: string, destinationPath: string): Promise<void> {
    await this.systemApi.moveEntry(sourcePath, destinationPath);
  }

  async rename(path: string, newName: string): Promise<void> {
    await this.systemApi.renameEntry(path, newName);
  }

  async delete(path: string): Promise<void> {
    await this.destructiveGate.require({
      action: "delete_file",
      target: path,
      reason: "file/folder deletion cannot be undone through this interface",
    });
    await this.systemApi.deleteEntry(path);
    log.info("file deleted", { path });
  }

  async createFolder(path: string): Promise<void> {
    await this.systemApi.createDirectory(path);
  }

  search(query: string, rootPath?: string): Promise<readonly FileEntry[]> {
    return this.systemApi.searchFiles(query, rootPath);
  }

  recent(): Promise<readonly FileEntry[]> {
    return this.systemApi.getRecentFiles();
  }

  async wellKnownFolder(folder: WellKnownFolder): Promise<string> {
    return this.systemApi.getWellKnownFolderPath(folder);
  }
}

export function createFileManager(
  systemApi: WindowsSystemApi,
  destructiveGate: DestructiveActionGate,
): FileManager {
  return new FileManager(systemApi, destructiveGate);
}
