import type { ModelMetadata, DeviceCapabilities } from "../src/types.js";
import type { HttpFetch, HttpResponseLike } from "@ryper/ai-engine";
import { sha256Hex } from "../src/checksum.js";

export function sampleModel(overrides: Partial<ModelMetadata> = {}): ModelMetadata {
  return {
    id: "chat-small",
    name: "Chat Small",
    type: "chat",
    runtime: "ollama",
    version: "1.0.0",
    requirements: { minRamGB: 2, approxDiskBytes: 1024, requiresGpu: false },
    downloadUrl: "https://models.example.com/chat-small.bin",
    sha256: sha256Hex(new TextEncoder().encode("chat-small-bytes")),
    license: "Apache-2.0",
    runtimeModelId: "chat-small:latest",
    ...overrides,
  };
}

export function sampleDevice(overrides: Partial<DeviceCapabilities> = {}): DeviceCapabilities {
  return {
    cpuCores: 8,
    totalRamGB: 16,
    freeRamGB: 8,
    hasGpu: false,
    platform: "linux",
    isAppleSilicon: false,
    ...overrides,
  };
}

async function* toByteChunks(bytes: Uint8Array, chunkSize = 16): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < bytes.length; i += chunkSize) {
    yield bytes.slice(i, i + chunkSize);
  }
}

export function fakeBytesFetch(bytes: Uint8Array, status = 200): HttpFetch {
  return async (): Promise<HttpResponseLike> => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: async () => new TextDecoder().decode(bytes),
    body: () => toByteChunks(bytes),
  });
}
