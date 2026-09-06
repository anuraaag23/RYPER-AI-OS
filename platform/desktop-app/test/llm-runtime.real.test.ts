import { access, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createNodeFileSystem } from "@ryper/local-runtime";
import { createNodeProcessRunner, createLlamaCppProvider } from "@ryper/local-runtime";
import {
  createLlamaServerManager,
  detectLlamaModelStatus,
} from "../electron/llm-model-provisioning.js";

/**
 * REAL PROVIDER INTEGRATION TESTS — Phase 13.9.
 *
 * Unlike a unit test against a fake `ProcessRunner`, these start a
 * genuinely installed `llama-server` binary against a genuinely
 * installed GGUF model and assert on a real chat completion. No real
 * binary or model is ever committed to this repository, so — matching
 * `core/local-runtime/test/runtime-providers/voice-runtime.real.test.ts`'s
 * (Phase 13.8) precedent exactly — every test here is skipped by
 * default, with a clear reason, rather than failing CI on any machine
 * without a real local LLM installed.
 *
 * To actually run these: build/install a real `llama-server` and a
 * real GGUF chat model (see `docs/PROJECT_STATE.md`'s Phase 13.9
 * section), then set the same environment variables
 * `llm-model-provisioning.ts` reads:
 *
 *   RYPER_LLAMA_SERVER_BINARY, RYPER_LLAMA_MODEL, RYPER_LLAMA_SERVER_PORT
 *
 * and run: `RYPER_LLAMA_SERVER_BINARY=... npx vitest run llm-runtime.real.test.ts`
 */

const binaryPath = process.env["RYPER_LLAMA_SERVER_BINARY"];
const modelPath = process.env["RYPER_LLAMA_MODEL"];
const port = Number(process.env["RYPER_LLAMA_SERVER_PORT"] ?? 8095);

const fileSystem = createNodeFileSystem({
  access,
  readFile,
  writeFile,
  unlink,
  mkdir,
  stat,
  readdir,
});
const processRunner = createNodeProcessRunner();
const httpFetch = async (url, init) => {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
    // Must forward the real AbortSignal, or an aborted `streamChat()`
    // call never actually cancels the underlying request — matching
    // the real production adapter, `createNodeHttpFetch()`
    // (`core/ai-engine/src/providers/node-fetch.ts`), which already
    // does this correctly. Omitted here previously, which is why the
    // real cancellation test hung until Vitest's timeout instead of
    // rejecting quickly.
    ...(init.signal !== undefined ? { signal: init.signal } : {}),
  });
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    text: () => response.text(),
    body: () => response.body,
  };
};

describe.skipIf(!binaryPath || !modelPath)(
  "llama-server — REAL local LLM execution (Phase 13.9, opt-in)",
  () => {
    it("real, on-disk detection reports the real install as installed", async () => {
      const status = await detectLlamaModelStatus(fileSystem, { binaryPath, modelPath, port });
      expect(status.status).toBe("installed");
    });

    it("starts a real llama-server process and completes a real chat request through the actual repo provider code", async () => {
      const manager = createLlamaServerManager(processRunner, httpFetch);
      const baseUrl = await manager.start({ binaryPath, modelPath, port });
      try {
        const provider = createLlamaCppProvider({ id: "real-llama-cpp", baseUrl }, httpFetch);
        let text = "";
        // `LocalRuntimeProvider.streamChat` takes `(modelId, request)` — not the
        // single-argument `(request)` shape of `AIProvider.streamChat`. The real
        // production call site (`LocalRuntimeManager.streamChat`, see
        // `core/local-runtime/src/runtime-manager.ts`) always supplies a
        // `runtimeModelId`; llama.cpp's server ignores the value for a
        // single-loaded model, but the field must still be a string, so this
        // matches the repo's own convention (see
        // `platform/desktop-app/electron/ai-orchestrator-bootstrap.ts`, which
        // uses the same literal for its real llama-cpp provider).
        const runtimeModelId = "llama-cpp-local";
        for await (const event of provider.streamChat(runtimeModelId, {
          messages: [{ role: "user", content: "Reply with only the word: hello" }],
        })) {
          if (event.type === "text_delta") text += event.delta;
        }
        expect(text.length).toBeGreaterThan(0);
      } finally {
        manager.stop();
      }
    }, 60_000);

    it("real cancellation actually stops an in-flight request", async () => {
      const manager = createLlamaServerManager(processRunner, httpFetch);
      const baseUrl = await manager.start({ binaryPath, modelPath, port });
      try {
        const provider = createLlamaCppProvider(
          { id: "real-llama-cpp-cancel", baseUrl },
          httpFetch,
        );
        const controller = new AbortController();
        const iterate = async () => {
          for await (const _event of provider.streamChat("llama-cpp-local", {
            messages: [{ role: "user", content: "Write a very long story." }],
            signal: controller.signal,
          })) {
            // consume
          }
        };
        const promise = iterate();
        setTimeout(() => controller.abort(), 50);
        await expect(promise).rejects.toThrow();
      } finally {
        manager.stop();
      }
    }, 60_000);
  },
);
