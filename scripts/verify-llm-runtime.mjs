#!/usr/bin/env node
/**
 * Phase 13.9 real local-LLM verification script.
 *
 * Imports the ACTUAL compiled `platform/desktop-app`/`@ryper/local-runtime`
 * code (not a test double) and runs it against a real, externally
 * installed llama.cpp `llama-server` build, producing a JSON report of
 * what genuinely executed. Companion to `scripts/verify-voice-runtime.mjs`
 * (Phase 13.8) — same philosophy, same honesty guarantees: every field
 * is a real measurement/error, never invented.
 *
 * Usage:
 *   npm run build   # so dist/dist-electron are up to date
 *   node scripts/verify-llm-runtime.mjs
 *
 * Configuration (env vars, same ones `llm-model-provisioning.ts` reads):
 *   RYPER_LLAMA_SERVER_BINARY, RYPER_LLAMA_MODEL, RYPER_LLAMA_SERVER_PORT
 *
 * If `RYPER_LLAMA_MODEL` points at a real, valid GGUF chat model, this
 * script additionally sends one real chat completion request through
 * the real repo code and reports the real response. If it points at a
 * missing/invalid file, this script reports the real, honest failure
 * instead — it never fabricates a completion.
 */
import { access, readFile, writeFile, unlink, mkdir, stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeFileSystem } from "../core/local-runtime/dist/filesystem.js";
import { createNodeProcessRunner } from "../core/local-runtime/dist/runtime-providers/process-runner.js";
import { createLlamaCppProvider } from "../core/local-runtime/dist/runtime-providers/llama-cpp.js";
import {
  createLlamaServerManager,
  defaultLlamaServerPaths,
  detectLlamaModelStatus,
  LlamaServerStartError,
} from "../platform/desktop-app/dist-electron/llm-model-provisioning.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(__dirname, "..");

const fileSystem = createNodeFileSystem({ access, readFile, writeFile, unlink, mkdir, stat, readdir });
const processRunner = createNodeProcessRunner();

/** Minimal real HttpFetch backed by Node's global `fetch` (mirrors `core/ai-engine/src/providers/node-fetch.ts`). */
const httpFetch = async (url, init) => {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    text: () => response.text(),
    body: () => response.body,
  };
};

const paths = defaultLlamaServerPaths(repoRoot);
const overridePaths = {
  binaryPath: process.env["RYPER_LLAMA_SERVER_BINARY"] ?? paths.binaryPath,
  modelPath: process.env["RYPER_LLAMA_MODEL"] ?? paths.modelPath,
  port: Number(process.env["RYPER_LLAMA_SERVER_PORT"] ?? paths.port),
};

async function main() {
  const report = { ranAt: new Date().toISOString(), paths: overridePaths };

  report.diagnostics = await detectLlamaModelStatus(fileSystem, overridePaths);

  if (report.diagnostics.status !== "installed") {
    report.startResult = { skipped: true, reason: report.diagnostics.detail };
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const manager = createLlamaServerManager(processRunner, httpFetch);
  const start = Date.now();
  try {
    const baseUrl = await manager.start(overridePaths);
    report.startResult = { ok: true, baseUrl, elapsedMs: Date.now() - start };

    const provider = createLlamaCppProvider({ id: "verify-llama-cpp", baseUrl }, httpFetch);
    const chatStart = Date.now();
    let text = "";
    let error;
    try {
      for await (const event of provider.streamChat({
        messages: [{ role: "user", content: "Say 'hello' and nothing else." }],
      })) {
        if (event.type === "text_delta") text += event.delta;
      }
    } catch (err) {
      error = err instanceof Error ? { name: err.name, message: err.message } : String(err);
    }
    report.chatResult = { elapsedMs: Date.now() - chatStart, text, error };

    manager.stop();
  } catch (err) {
    report.startResult = {
      ok: false,
      elapsedMs: Date.now() - start,
      isLlamaServerStartError: err instanceof LlamaServerStartError,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error("verification script failed:", err);
  process.exitCode = 1;
});
