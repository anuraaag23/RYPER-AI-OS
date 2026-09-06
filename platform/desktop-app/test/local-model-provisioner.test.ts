import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicCopyOrLink, provisionLocalModels } from "../electron/local-model-provisioner.js";

describe("local-model-provisioner", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "ryper-prov-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("provisions into an empty directory and creates README_MODELS.txt", async () => {
    const status = await provisionLocalModels(testDir);
    expect(status).toBeDefined();
    expect(existsSync(join(testDir, "models", "README_MODELS.txt"))).toBe(true);
    expect(existsSync(join(testDir, "models", "llama"))).toBe(true);
    expect(existsSync(join(testDir, "models", "whisper"))).toBe(true);
    expect(existsSync(join(testDir, "models", "piper"))).toBe(true);
  });

  it("handles normalized models directory if base already ends with models", async () => {
    const modelsSubdir = join(testDir, "models");
    const status = await provisionLocalModels(modelsSubdir);
    expect(status).toBeDefined();
    expect(existsSync(join(modelsSubdir, "README_MODELS.txt"))).toBe(true);
    expect(existsSync(join(modelsSubdir, "llama"))).toBe(true);
  });

  it("atomicCopyOrLink safely copies and renames", async () => {
    const src = join(testDir, "sample.bin");
    const dst = join(testDir, "out", "target.bin");
    await writeFile(src, "dummy-model-payload-content", "utf-8");

    const ok = await atomicCopyOrLink(src, dst);
    expect(ok).toBe(true);
    expect(existsSync(dst)).toBe(true);
    const targetStat = await stat(dst);
    expect(targetStat.size).toBeGreaterThan(0);
  });

  it("atomicCopyOrLink returns false if source does not exist", async () => {
    const src = join(testDir, "non-existent.bin");
    const dst = join(testDir, "out", "target.bin");
    const ok = await atomicCopyOrLink(src, dst);
    expect(ok).toBe(false);
    expect(existsSync(dst)).toBe(false);
  });
});
