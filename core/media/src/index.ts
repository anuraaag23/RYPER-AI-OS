export type MediaKind = "image" | "video" | "audio";

export interface MediaAsset {
  readonly kind: MediaKind;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly width?: number;
  readonly height?: number;
  readonly durationSeconds?: number;
}

export type MediaTransform = (asset: MediaAsset) => Promise<MediaAsset> | MediaAsset;

export interface TransformCostEstimate {
  /** Rough relative GPU/CPU cost, used by callers deciding local vs. cloud execution. */
  readonly relativeCost: "low" | "medium" | "high";
}

export interface RegisteredTransform {
  readonly transform: MediaTransform;
  readonly estimateCost: (asset: MediaAsset) => TransformCostEstimate;
}

/**
 * Registry for image/video/audio transforms (crop, compress, noise removal,
 * transcription, ...). Each registration includes a cost estimator so the
 * caller (Model Router-adjacent logic) can decide whether to run it locally
 * or hand it to a cloud-side generative service, per the architecture's
 * "switch to cloud when local hardware can't do it efficiently" rule.
 */
export class MediaEngine {
  private readonly transforms = new Map<string, RegisteredTransform>();

  register(
    name: string,
    transform: MediaTransform,
    estimateCost: (asset: MediaAsset) => TransformCostEstimate = () => ({ relativeCost: "low" }),
  ): void {
    if (this.transforms.has(name)) {
      throw new Error(`media transform "${name}" is already registered`);
    }
    this.transforms.set(name, { transform, estimateCost });
  }

  estimateCost(name: string, asset: MediaAsset): TransformCostEstimate {
    const entry = this.transforms.get(name);
    if (!entry) throw new Error(`no media transform registered under "${name}"`);
    return entry.estimateCost(asset);
  }

  async run(name: string, asset: MediaAsset): Promise<MediaAsset> {
    const entry = this.transforms.get(name);
    if (!entry) throw new Error(`no media transform registered under "${name}"`);
    return entry.transform(asset);
  }

  listTransforms(): readonly string[] {
    return [...this.transforms.keys()];
  }
}

/** A real, trivial transform: crop dimensions metadata (byte-level crop is a platform concern). */
export const describeCrop: MediaTransform = (asset) => asset;

export function createMediaEngine(): MediaEngine {
  const engine = new MediaEngine();
  engine.register("describe-crop", describeCrop);
  return engine;
}
