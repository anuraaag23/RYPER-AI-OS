/**
 * Every disk operation the model manager needs, behind an interface — the
 * same injection pattern `@ryper/ai-engine` uses for HTTP (`HttpFetch`).
 * Tests use an in-memory fake; platform shells use `createNodeFileSystem`
 * or their own native storage bridge.
 */
export interface FileSystemLike {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  deleteFile(path: string): Promise<void>;
  statSize(path: string): Promise<number>;
  mkdir(path: string): Promise<void>;
  listFiles(dirPath: string): Promise<readonly string[]>;
}

/** Simple in-memory implementation used throughout this package's own test suite. */
export class InMemoryFileSystem implements FileSystemLike {
  private readonly files = new Map<string, Uint8Array>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async readFile(path: string): Promise<Uint8Array> {
    const data = this.files.get(path);
    if (!data) throw new Error(`file not found: ${path}`);
    return data;
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, data);
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }

  async statSize(path: string): Promise<number> {
    const data = this.files.get(path);
    if (!data) throw new Error(`file not found: ${path}`);
    return data.byteLength;
  }

  async mkdir(): Promise<void> {
    // No-op: this fake has no real directory concept, paths are flat keys.
  }

  async listFiles(dirPath: string): Promise<readonly string[]> {
    const prefix = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
    return [...this.files.keys()].filter((path) => path.startsWith(prefix));
  }
}

/**
 * Real Node.js filesystem implementation. Kept isolated behind the same
 * `FileSystemLike` interface so platform shells (or tests) can swap it for
 * a native storage bridge without touching any caller.
 */
export function createNodeFileSystem(fs: {
  readonly access: (path: string) => Promise<void>;
  readonly readFile: (path: string) => Promise<Uint8Array>;
  readonly writeFile: (path: string, data: Uint8Array) => Promise<void>;
  readonly unlink: (path: string) => Promise<void>;
  readonly stat: (path: string) => Promise<{ size: number }>;
  readonly mkdir: (path: string, options: { recursive: boolean }) => Promise<unknown>;
  readonly readdir: (path: string) => Promise<string[]>;
}): FileSystemLike {
  return {
    async exists(path) {
      try {
        await fs.access(path);
        return true;
      } catch {
        return false;
      }
    },
    readFile: (path) => fs.readFile(path),
    writeFile: (path, data) => fs.writeFile(path, data),
    deleteFile: (path) => fs.unlink(path),
    async statSize(path) {
      const stats = await fs.stat(path);
      return stats.size;
    },
    async mkdir(path) {
      await fs.mkdir(path, { recursive: true });
    },
    async listFiles(dirPath) {
      const entries = await fs.readdir(dirPath);
      return entries.map((name) => `${dirPath}/${name}`);
    },
  };
}
