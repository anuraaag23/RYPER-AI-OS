import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../src/filesystem.js";

describe("InMemoryFileSystem", () => {
  it("writes and reads back bytes", async () => {
    const fs = new InMemoryFileSystem();
    const data = new TextEncoder().encode("payload");
    await fs.writeFile("/models/a.bin", data);
    expect(await fs.readFile("/models/a.bin")).toEqual(data);
  });

  it("exists() reflects writes and deletes", async () => {
    const fs = new InMemoryFileSystem();
    expect(await fs.exists("/x")).toBe(false);
    await fs.writeFile("/x", new Uint8Array([1]));
    expect(await fs.exists("/x")).toBe(true);
    await fs.deleteFile("/x");
    expect(await fs.exists("/x")).toBe(false);
  });

  it("statSize reports byte length", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/x", new Uint8Array(42));
    expect(await fs.statSize("/x")).toBe(42);
  });

  it("throws a clear error reading a missing file", async () => {
    const fs = new InMemoryFileSystem();
    await expect(fs.readFile("/missing")).rejects.toThrow(/not found/);
  });

  it("listFiles returns only paths under the given prefix", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/models/a.bin", new Uint8Array());
    await fs.writeFile("/models/b.bin", new Uint8Array());
    await fs.writeFile("/other/c.bin", new Uint8Array());
    const files = await fs.listFiles("/models");
    expect(files.sort()).toEqual(["/models/a.bin", "/models/b.bin"]);
  });
});
