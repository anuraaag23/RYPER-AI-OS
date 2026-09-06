import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../src/filesystem.js";
import { ModelVerifier } from "../src/model-verification.js";
import { sha256Hex } from "../src/checksum.js";
import { sampleModel } from "./fixtures.js";
import type { InstalledModel } from "../src/types.js";

describe("ModelVerifier", () => {
  it("reports ok for a file matching size and checksum", async () => {
    const fs = new InMemoryFileSystem();
    const bytes = new TextEncoder().encode("real bytes");
    await fs.writeFile("/x", bytes);
    const installed: InstalledModel = {
      metadata: sampleModel({ sha256: sha256Hex(bytes) }),
      localPath: "/x",
      installedAt: "now",
      sizeBytes: bytes.byteLength,
      active: true,
    };

    const verifier = new ModelVerifier(fs);
    expect((await verifier.verify(installed)).status).toBe("ok");
  });

  it("reports missing when the file isn't on disk", async () => {
    const fs = new InMemoryFileSystem();
    const installed: InstalledModel = {
      metadata: sampleModel(),
      localPath: "/gone",
      installedAt: "now",
      sizeBytes: 10,
      active: true,
    };
    expect((await new ModelVerifier(fs).verify(installed)).status).toBe("missing");
  });

  it("reports size-mismatch when the recorded size disagrees with disk", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/x", new Uint8Array(5));
    const installed: InstalledModel = {
      metadata: sampleModel(),
      localPath: "/x",
      installedAt: "now",
      sizeBytes: 999,
      active: true,
    };
    expect((await new ModelVerifier(fs).verify(installed)).status).toBe("size-mismatch");
  });

  it("reports checksum-mismatch when bytes were corrupted without a size change", async () => {
    const fs = new InMemoryFileSystem();
    const bytes = new TextEncoder().encode("corrupted!");
    await fs.writeFile("/x", bytes);
    const installed: InstalledModel = {
      metadata: sampleModel({ sha256: "0".repeat(64) }),
      localPath: "/x",
      installedAt: "now",
      sizeBytes: bytes.byteLength,
      active: true,
    };
    expect((await new ModelVerifier(fs).verify(installed)).status).toBe("checksum-mismatch");
  });
});
