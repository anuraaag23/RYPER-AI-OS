import { access } from "node:fs/promises";
import type { ShellExec } from "@ryper/windows-agent";
import { resolveEdgeExecutable, type EdgeResolution } from "./media-session-fixture-launcher.js";

async function realFileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface LlamaPreflightResult {
  readonly llamaBinaryPath: string;
  readonly llamaModelPath: string;
}

/**
 * Real-hardware preflight for the llama-server binary/model
 * `RYPER_LLAMA_SERVER_BINARY`/`RYPER_LLAMA_MODEL` env vars — the exact
 * same two variables `llm-runtime.real.test.ts` and
 * `tool-calling.real.test.ts` read via the shared, unmodified
 * `defaultLlamaServerPaths()` (`llm-model-provisioning.ts`). This
 * preflight does not change that resolution path or introduce a
 * second one; it reads the identical `process.env` values directly
 * and checks them explicitly, *before* `bootstrapAIOrchestrator()` is
 * ever called, so a genuinely missing/invisible env var fails in
 * milliseconds with a precise, actionable reason — logging exactly
 * what this process saw — instead of surfacing ~90 seconds later as
 * `bootstrapAIOrchestrator()`'s generic `llmDiagnostics.status ===
 * "binary-missing"` (which silently falls back to a `tmpdir()`-based
 * default path with no indication that's what happened).
 *
 * If a real run reports `RYPER_LLAMA_SERVER_BINARY is not set in this
 * test process` here despite being set in the shell used to launch
 * `npx vitest`, the two most common real causes are: (1) not using
 * `--pool=forks --poolOptions.forks.singleFork` (this repo's
 * documented invocation for every real-hardware test — see this
 * file's own header comment in the calling test), so a different
 * Vitest worker pool is in play; or (2) the variable being set in a
 * different shell/session than the one that actually launched Vitest.
 * This preflight cannot distinguish between those on its own — it
 * exists to surface the discrepancy immediately and precisely rather
 * than leave it to be inferred from a confusing downstream failure.
 */
export async function realHardwareLlamaPreflight(): Promise<LlamaPreflightResult> {
  const llamaBinaryPath = process.env["RYPER_LLAMA_SERVER_BINARY"];
  const llamaModelPath = process.env["RYPER_LLAMA_MODEL"];

  // eslint-disable-next-line no-console
  console.log(
    "[media preflight] llama binary:",
    llamaBinaryPath ?? "(RYPER_LLAMA_SERVER_BINARY is not set in this test process)",
  );
  // eslint-disable-next-line no-console
  console.log(
    "[media preflight] model:",
    llamaModelPath ?? "(RYPER_LLAMA_MODEL is not set in this test process)",
  );

  if (!llamaBinaryPath) {
    throw new Error(
      "Real-hardware preflight failed: RYPER_LLAMA_SERVER_BINARY is not set in this test " +
        "process, even though this test's own describe.skipIf() gate did not skip (so it was " +
        "set at module-load time). Most likely causes: (1) this was run without " +
        "--pool=forks --poolOptions.forks.singleFork, the documented invocation for every " +
        "real-hardware test in this repo, so a different Vitest worker pool is handling this " +
        "test's environment; or (2) the variable was set in a different shell/session than the " +
        "one that launched `npx vitest`.",
    );
  }
  if (!(await realFileExists(llamaBinaryPath))) {
    throw new Error(
      `Real-hardware preflight failed: RYPER_LLAMA_SERVER_BINARY is set to ` +
        `"${llamaBinaryPath}" in this test process, but no file exists there.`,
    );
  }
  if (!llamaModelPath) {
    throw new Error(
      "Real-hardware preflight failed: RYPER_LLAMA_MODEL is not set in this test process " +
        "(see RYPER_LLAMA_SERVER_BINARY's preflight message above for the likely causes).",
    );
  }
  if (!(await realFileExists(llamaModelPath))) {
    throw new Error(
      `Real-hardware preflight failed: RYPER_LLAMA_MODEL is set to "${llamaModelPath}" in ` +
        "this test process, but no file exists there.",
    );
  }

  return { llamaBinaryPath, llamaModelPath };
}

/**
 * Real-hardware preflight for the Edge executable used by the
 * media-session fixture — resolves it (see `resolveEdgeExecutable()`
 * for the full discovery order and why a bare `Start-Process
 * -FilePath 'msedge.exe'` doesn't work) and logs the real, resolved
 * path and method *before* attempting to launch anything, so a
 * missing-browser environment fails immediately with a precise reason
 * rather than after a real Qwen3/tool-calling round trip has already
 * run.
 */
export async function realHardwareEdgePreflight(exec: ShellExec): Promise<EdgeResolution> {
  const edge = await resolveEdgeExecutable(exec);
  // eslint-disable-next-line no-console
  console.log("[media preflight] Edge:", `${edge.path} (resolved via ${edge.method})`);
  return edge;
}
