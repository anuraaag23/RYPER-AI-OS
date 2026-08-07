import { describe, expect, it, vi } from "vitest";
import { EmbeddingService } from "../src/embedding-service.js";

describe("EmbeddingService", () => {
  it("returns the embed function's result", async () => {
    const service = new EmbeddingService(async (text) => [text.length]);
    expect(await service.embedText("hello")).toEqual([5]);
  });

  it("caches repeated lookups for the same text", async () => {
    const embed = vi.fn(async (text: string) => [text.length]);
    const service = new EmbeddingService(embed);
    await service.embedText("hello");
    await service.embedText("hello");
    expect(embed).toHaveBeenCalledTimes(1);
    expect(service.cacheSize()).toBe(1);
  });

  it("clearCache() forces re-computation", async () => {
    const embed = vi.fn(async (text: string) => [text.length]);
    const service = new EmbeddingService(embed);
    await service.embedText("hello");
    service.clearCache();
    await service.embedText("hello");
    expect(embed).toHaveBeenCalledTimes(2);
  });
});
