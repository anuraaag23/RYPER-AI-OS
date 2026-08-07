import { describe, expect, it } from "vitest";
import { createMediaEngine, MediaEngine, type MediaAsset } from "../src/index.js";

const sampleImage: MediaAsset = {
  kind: "image",
  mimeType: "image/png",
  bytes: new Uint8Array([1, 2, 3]),
  width: 100,
  height: 100,
};

describe("MediaEngine", () => {
  it("registers and runs a transform", async () => {
    const engine = createMediaEngine();
    const result = await engine.run("describe-crop", sampleImage);
    expect(result).toEqual(sampleImage);
  });

  it("provides a cost estimate for routing decisions", () => {
    const engine = new MediaEngine();
    engine.register(
      "upscale",
      (asset) => asset,
      (asset) => ({ relativeCost: asset.width && asset.width > 2000 ? "high" : "medium" }),
    );
    expect(engine.estimateCost("upscale", sampleImage).relativeCost).toBe("medium");
  });

  it("throws for an unregistered transform", async () => {
    const engine = new MediaEngine();
    await expect(engine.run("missing", sampleImage)).rejects.toThrow(/no media transform/);
  });
});
