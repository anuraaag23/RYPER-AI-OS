import type {
  EmbeddingRequest,
  EmbeddingResult,
  LocalRuntimeProvider,
  ModelType,
  OCRRequest,
  OCRResult,
} from "../types.js";

export interface OnnxTensor {
  readonly data: Float32Array | Int32Array | readonly string[];
  readonly dims: readonly number[];
}

/** Matches the shape of `InferenceSession.run()` in the real `onnxruntime-node`/`onnxruntime-web` packages, so a real binding drops in as `sessionLoader` with no adapter changes. */
export interface OnnxSession {
  run(feeds: Readonly<Record<string, OnnxTensor>>): Promise<Readonly<Record<string, OnnxTensor>>>;
}

export type OnnxSessionLoader = (modelId: string) => Promise<OnnxSession>;

/** Pure request→tensors and tensors→result mapping — the adapter's only job is to call these around `session.run`. */
export interface OnnxPipeline<TRequest, TResult> {
  preprocess(request: TRequest): Readonly<Record<string, OnnxTensor>>;
  postprocess(outputs: Readonly<Record<string, OnnxTensor>>): TResult;
}

export interface OnnxRuntimeConfig {
  readonly id: string;
  readonly sessionLoader: OnnxSessionLoader;
  /** Required rather than guessed: whether the native ONNX Runtime binding is actually loadable on this device/build. */
  readonly checkAvailable: () => Promise<boolean>;
  readonly embedPipeline?: OnnxPipeline<EmbeddingRequest, EmbeddingResult>;
  readonly ocrPipeline?: OnnxPipeline<OCRRequest, OCRResult>;
}

/**
 * A real onnxruntime-node/onnxruntime-web install requires native/WASM
 * binaries this sandboxed build environment doesn't have — so, exactly
 * like `HttpFetch` elsewhere in this codebase, the session itself is
 * injected. Everything this file does around that injected session
 * (choosing which pipeline to run, marshalling request/result shapes) is
 * real orchestration logic with full test coverage; only the tensor math
 * inside `sessionLoader`/the pipelines is supplied by the caller.
 */
export function createOnnxRuntimeProvider(config: OnnxRuntimeConfig): LocalRuntimeProvider {
  const supportedModelTypes: ModelType[] = [];
  if (config.embedPipeline) supportedModelTypes.push("embedding");
  if (config.ocrPipeline) supportedModelTypes.push("ocr");

  const provider: LocalRuntimeProvider = {
    id: config.id,
    kind: "onnx",
    supportedModelTypes,
    isAvailable: config.checkAvailable,
  };

  if (config.embedPipeline) {
    const pipeline = config.embedPipeline;
    provider.embed = async (modelId, request) => {
      const session = await config.sessionLoader(modelId);
      const outputs = await session.run(pipeline.preprocess(request));
      return pipeline.postprocess(outputs);
    };
  }

  if (config.ocrPipeline) {
    const pipeline = config.ocrPipeline;
    provider.ocr = async (modelId, request) => {
      const session = await config.sessionLoader(modelId);
      const outputs = await session.run(pipeline.preprocess(request));
      return pipeline.postprocess(outputs);
    };
  }

  return provider;
}
