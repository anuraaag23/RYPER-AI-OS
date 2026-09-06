import { describe, expect, it } from "vitest";
import {
  createOnnxRuntimeProvider,
  type OnnxSession,
  type OnnxTensor,
} from "../../src/runtime-providers/onnx.js";

function fakeSession(outputs: Readonly<Record<string, OnnxTensor>>): OnnxSession {
  return { run: async () => outputs };
}

describe("createOnnxRuntimeProvider", () => {
  it("advertises only the model types with a configured pipeline", () => {
    const provider = createOnnxRuntimeProvider({
      id: "onnx",
      sessionLoader: async () => fakeSession({}),
      checkAvailable: async () => true,
      embedPipeline: {
        preprocess: () => ({}),
        postprocess: () => ({ vector: [] }),
      },
    });
    expect(provider.supportedModelTypes).toEqual(["embedding"]);
    expect(provider.ocr).toBeUndefined();
  });

  it("isAvailable() delegates entirely to the injected check", async () => {
    const provider = createOnnxRuntimeProvider({
      id: "onnx",
      sessionLoader: async () => fakeSession({}),
      checkAvailable: async () => false,
    });
    expect(await provider.isAvailable()).toBe(false);
  });

  it("embed() runs preprocess -> session.run -> postprocess", async () => {
    const outputs: Record<string, OnnxTensor> = {
      embedding: { data: new Float32Array([1, 2, 3]), dims: [3] },
    };
    const provider = createOnnxRuntimeProvider({
      id: "onnx",
      sessionLoader: async () => fakeSession(outputs),
      checkAvailable: async () => true,
      embedPipeline: {
        preprocess: (request) => ({
          input_ids: { data: new Int32Array([request.text.length]), dims: [1] },
        }),
        postprocess: (result) => ({ vector: Array.from(result.embedding?.data ?? []) }),
      },
    });

    const result = await provider.embed!("minilm", { text: "hello" });
    expect(result.vector).toEqual([1, 2, 3]);
  });

  it("ocr() runs its own pipeline independently of embed", async () => {
    const outputs: Record<string, OnnxTensor> = { text: { data: ["recognized text"], dims: [1] } };
    const provider = createOnnxRuntimeProvider({
      id: "onnx",
      sessionLoader: async () => fakeSession(outputs),
      checkAvailable: async () => true,
      ocrPipeline: {
        preprocess: (request) => ({
          pixels: { data: new Float32Array(request.imageBytes), dims: [request.imageBytes.length] },
        }),
        postprocess: (result) => ({ text: String(result.text?.data[0] ?? "") }),
      },
    });

    const result = await provider.ocr!("trocr", { imageBytes: new Uint8Array([1, 2, 3]) });
    expect(result.text).toBe("recognized text");
  });
});
