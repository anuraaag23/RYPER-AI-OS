import type { FileSystemLike } from "./filesystem.js";
import type { InstalledModel } from "./types.js";
import { verifyChecksum } from "./checksum.js";

export type VerificationStatus = "ok" | "missing" | "size-mismatch" | "checksum-mismatch";

export interface VerificationResult {
  readonly modelId: string;
  readonly status: VerificationStatus;
}

/**
 * Independent of the download path so it can also catch corruption from
 * causes other than a bad download — disk errors, a user manually touching
 * the cache directory, a partially-completed write from a crashed process.
 */
export class ModelVerifier {
  constructor(private readonly fileSystem: FileSystemLike) {}

  async verify(installed: InstalledModel): Promise<VerificationResult> {
    const exists = await this.fileSystem.exists(installed.localPath);
    if (!exists) {
      return { modelId: installed.metadata.id, status: "missing" };
    }

    const size = await this.fileSystem.statSize(installed.localPath);
    if (size !== installed.sizeBytes) {
      return { modelId: installed.metadata.id, status: "size-mismatch" };
    }

    const bytes = await this.fileSystem.readFile(installed.localPath);
    if (!verifyChecksum(bytes, installed.metadata.sha256)) {
      return { modelId: installed.metadata.id, status: "checksum-mismatch" };
    }

    return { modelId: installed.metadata.id, status: "ok" };
  }
}

export function createModelVerifier(fileSystem: FileSystemLike): ModelVerifier {
  return new ModelVerifier(fileSystem);
}
