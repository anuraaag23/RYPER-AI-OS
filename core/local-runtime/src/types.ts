import type { AIProvider, ProviderChatRequest, StreamEvent } from "@ryper/ai-engine";

/** Every kind of model the runtime can register and route inference to. */
export type ModelType =
  "chat" | "embedding" | "asr" | "tts" | "ocr" | "vision" | "translation" | "image-editing";

/** Which local inference engine actually runs a model. */
export type RuntimeKind = "llama-cpp" | "ollama" | "onnx" | "mlx";

export interface ModelResourceRequirements {
  readonly minRamGB: number;
  readonly requiresGpu?: boolean;
  readonly approxDiskBytes: number;
}

export interface ModelMetadata {
  readonly id: string;
  readonly name: string;
  readonly type: ModelType;
  readonly runtime: RuntimeKind;
  readonly version: string;
  readonly requirements: ModelResourceRequirements;
  readonly downloadUrl: string;
  readonly sha256: string;
  readonly license: string;
  /** Runtime-specific handle the provider adapter uses to address this model (e.g. an Ollama tag, a GGUF filename). */
  readonly runtimeModelId: string;
}

export interface InstalledModel {
  readonly metadata: ModelMetadata;
  readonly localPath: string;
  readonly installedAt: string;
  readonly sizeBytes: number;
  readonly active: boolean;
}

// ---- Device capability detection ----

export interface DeviceCapabilities {
  readonly cpuCores: number;
  readonly totalRamGB: number;
  readonly freeRamGB: number;
  readonly hasGpu: boolean;
  readonly gpuVramGB?: number;
  readonly batteryPercent?: number;
  readonly isCharging?: boolean;
  readonly platform: "windows" | "macos" | "linux" | "android" | "ios" | "unknown";
  readonly isAppleSilicon: boolean;
}

// ---- Per-task-type inference request/result shapes ----

export interface EmbeddingRequest {
  readonly text: string;
}
export interface EmbeddingResult {
  readonly vector: readonly number[];
}

export interface OCRRequest {
  readonly imageBytes: Uint8Array;
}
export interface OCRResult {
  readonly text: string;
}

export interface TranslationRequest {
  readonly text: string;
  readonly targetLanguage: string;
  readonly sourceLanguage?: string;
}
export interface TranslationResult {
  readonly text: string;
}

export interface ASRRequest {
  readonly audioBytes: Uint8Array;
}
export interface ASRResult {
  readonly text: string;
}

export interface TTSRequest {
  readonly text: string;
  readonly voice?: string;
}
export interface TTSResult {
  readonly audioBytes: Uint8Array;
}

export interface VisionRequest {
  readonly imageBytes: Uint8Array;
  readonly prompt?: string;
}
export interface VisionResult {
  readonly description: string;
}

export interface ImageEditRequest {
  readonly imageBytes: Uint8Array;
  readonly instruction: string;
}
export interface ImageEditResult {
  readonly imageBytes: Uint8Array;
}

/**
 * The contract every local inference engine adapter implements. A provider
 * only implements the methods matching the model types it actually serves
 * (`supportedModelTypes` advertises which); the runtime manager never calls
 * a method a provider didn't declare support for. New runtimes (a second
 * ONNX variant, a future engine) are added by implementing this interface
 * and registering an instance — no change to the runtime manager or the
 * Core AI Engine is required.
 */
export interface LocalRuntimeProvider {
  readonly id: string;
  readonly kind: RuntimeKind;
  readonly supportedModelTypes: readonly ModelType[];

  /** Whether this runtime is currently usable (binary/server reachable, hardware supported). */
  isAvailable(): Promise<boolean>;

  streamChat?(modelId: string, request: ProviderChatRequest): AsyncIterable<StreamEvent>;
  embed?(modelId: string, request: EmbeddingRequest): Promise<EmbeddingResult>;
  ocr?(modelId: string, request: OCRRequest): Promise<OCRResult>;
  translate?(modelId: string, request: TranslationRequest): Promise<TranslationResult>;
  transcribe?(modelId: string, request: ASRRequest): Promise<ASRResult>;
  synthesizeSpeech?(modelId: string, request: TTSRequest): Promise<TTSResult>;
  describeImage?(modelId: string, request: VisionRequest): Promise<VisionResult>;
  editImage?(modelId: string, request: ImageEditRequest): Promise<ImageEditResult>;
}

/** Re-exported so consumers of this package don't need a direct `@ryper/ai-engine` import just for these. */
export type { AIProvider, ProviderChatRequest, StreamEvent };
