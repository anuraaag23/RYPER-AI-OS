import { access, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createNodeFileSystem } from "@ryper/local-runtime";
import { EventBus } from "@ryper/event-bus";
import { CapabilityBroker, type CapabilityRequest } from "@ryper/security";
import { createCapabilityManager } from "@ryper/platform-capability";
import {
  createWindowsAdapter,
  createPowerShellWindowsSystemApi,
  WINDOWS_CAPABILITY_DESCRIPTORS,
} from "@ryper/windows-agent";
import type { StreamEvent } from "@ryper/ai-engine";
import { bootstrapAIOrchestrator } from "../electron/ai-orchestrator-bootstrap.js";
import { createNodePowerShellExec } from "../electron/windows-shell-exec.js";

/**
 * REAL STRUCTURED TOOL-CALLING INTEGRATION TEST — Phase 13.12–13.14.
 *
 * Unlike `llm-runtime.real.test.ts` (Phase 13.9–13.11, real plain chat
 * completion + real cancellation only), this test drives the *entire*
 * path the user asked to have verified, with no mocks anywhere in it:
 *
 *   real Qwen3
 *     -> real llama-server (started by this repo's real
 *        `LlamaServerManager`, launched with `--jinja` — see
 *        `llm-model-provisioning.ts`)
 *     -> real `OpenAICompatibleProvider`/`createLlamaCppProvider`
 *        (Phase 13.9, unmodified)
 *     -> real `AIOrchestrator.sendMessage()` (unmodified)
 *     -> real `ToolRegistry.invoke()` — real structural argument
 *        validation, then real `CapabilityBroker.assertGranted()`
 *        (Phase 13.9's broker hook, exercised for the first time by
 *        `show_notification`, the only desktop tool with
 *        `requiredCapability` set — see `desktop-tools.ts` and
 *        `docs/adr/0021`)
 *     -> real `desktopActions.showNotification()`
 *     -> real `CapabilityManager.invoke()` — real permission check via
 *        `WINDOWS_CAPABILITY_DESCRIPTORS` (registered here exactly as
 *        `core-bootstrap.ts` now does for real desktop runs), which
 *        reaches real `CapabilityBroker.requestCapability()`
 *     -> real `WindowsAdapter.notificationManager` -> real
 *        `PowerShellWindowsSystemApi` -> real `powershell.exe`
 *        (via `createNodePowerShellExec()`, docs/adr/0021), now using
 *        a genuinely Windows-native WinRT toast notification command
 *        instead of the third-party BurntToast module cmdlet Phase
 *        13.12/13.13 mistakenly called without ever installing it
 *        (docs/adr/0023) -> a real Windows toast notification
 *     -> the real, authoritative `tool_result` event (docs/adr/0023 —
 *        added because Phase 13.13's real run showed the tool
 *        genuinely failing while the test still reported PASS, since
 *        a caught `execute()` failure becomes a normal `{ok: false}`
 *        tool result, not an orchestrator "error" event, and Qwen3
 *        narrated the failure gracefully enough that no other
 *        assertion caught it)
 *     -> the tool result is fed back to real Qwen3, which produces a
 *        real, final natural-language reply.
 *
 * This can only run for real on real Windows with a real `powershell.exe`
 * (there is none in this Linux build sandbox, matching every other real
 * hardware test in this repo), so it is skipped by default unless both
 * the same `RYPER_LLAMA_SERVER_BINARY`/`RYPER_LLAMA_MODEL` env vars
 * `llm-runtime.real.test.ts` uses are set *and* `process.platform ===
 * "win32"`.
 *
 * On real Windows hardware, Vitest's default worker-thread pool has been
 * observed to exit unexpectedly when this test spawns real
 * `llama-server`/`powershell.exe` child processes — run it with a single
 * forked process instead (this repo's installed Vitest 2.1.x supports
 * `--pool=forks`/`--poolOptions.forks.singleFork` as documented CLI
 * flags; no unsupported/invented option is used here):
 *
 *   npx vitest run platform/desktop-app/test/tool-calling.real.test.ts \
 *     --pool=forks --poolOptions.forks.singleFork
 *
 * The `ConsentPrompt` passed to `CapabilityBroker` here always approves.
 * This is not a mock of anything under test — it is the honest stand-in
 * for a real user clicking "Allow" on a real consent dialog, which this
 * repository does not have a UI for yet (`main.ts`'s real prompt, by
 * contrast, always denies — see its own comment — precisely because no
 * real UI exists there). Approving consent is a precondition for
 * reaching the code this test verifies, not a substitute for it: every
 * step downstream of that approval (schema validation, the broker's own
 * grant bookkeeping and audit log, the real PowerShell call, the real
 * model's final reply) is real, unmodified repository code.
 */

const binaryPath = process.env["RYPER_LLAMA_SERVER_BINARY"];
const modelPath = process.env["RYPER_LLAMA_MODEL"];
const isWindows = process.platform === "win32";

function alwaysApprove(_request: CapabilityRequest): boolean {
  return true;
}

describe.skipIf(!binaryPath || !modelPath || !isWindows)(
  "AIOrchestrator -> ToolRegistry -> CapabilityBroker — REAL Qwen3 structured tool calling (Phase 13.12, opt-in)",
  () => {
    it("a real Qwen3 tool call runs through the real broker to a real Windows action and round-trips back to Qwen3", async () => {
      const fileSystem = createNodeFileSystem({
        access,
        readFile,
        writeFile,
        unlink,
        mkdir,
        stat,
        readdir,
      });
      const eventBus = new EventBus();
      const broker = new CapabilityBroker(alwaysApprove);
      const capabilityManager = createCapabilityManager({
        broker,
        platformDetector: () => "windows",
      });

      // Real PowerShell-backed system API, real capability descriptors —
      // exactly what core-bootstrap.ts now wires for real desktop runs
      // (docs/adr/0021), constructed directly here rather than through
      // bootstrapCore() since this test only needs the AI/capability
      // layers, not the full app (windows, tray, IPC, ...).
      const systemApi = createPowerShellWindowsSystemApi(createNodePowerShellExec());
      const windowsAdapter = await createWindowsAdapter({ systemApi });
      capabilityManager.registerAdapter(windowsAdapter);
      for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
        capabilityManager.registerCapability(descriptor);
      }

      const { orchestrator, llmDiagnostics, localLLMActive } = await bootstrapAIOrchestrator(
        capabilityManager,
        broker,
        eventBus,
        { modelCacheDir: tmpdir() },
        fileSystem,
      );

      // Real, on-disk detection genuinely found the real binary+model —
      // if this ever fails, every assertion below would otherwise be
      // silently exercising the HeuristicToolCallingProvider fallback
      // instead of real Qwen3, so this must be checked explicitly
      // rather than assumed.
      expect(llmDiagnostics.status).toBe("installed");
      expect(localLLMActive).toBe(true);

      // `ToolRegistry.invoke()`'s own `requiredCapability` check
      // (`this.broker.assertGranted(actorId, tool.requiredCapability)`)
      // is a hard *assertion*, not a request — it throws unless a grant
      // already exists. `AIOrchestrator` now explicitly passes
      // `actorId: "ai-orchestrator"` into `toolRegistry.invoke()`
      // (matching `desktop-tools.ts`'s own actor for the same logical
      // action's `CapabilityManager` self-granting flow — see
      // docs/adr/0021's "known follow-up" note and
      // PROJECT_STATE.md's Tier 1 completion notes for the full
      // reasoning). That alignment means a capability already granted
      // via `CapabilityManager`'s real, consent-prompting flow is
      // correctly recognized on every subsequent call in the same
      // broker instance — but the very first call to a
      // requiredCapability-gated tool can still be denied here before
      // `execute()` ever runs, since `assertGranted` is a pure check,
      // mirroring `@ryper/plugin-runtime`'s pattern of capabilities
      // being pre-granted through a separate onboarding/settings flow
      // that does not yet exist for AI tool actors. This pre-grant
      // mirrors what that future flow would already have done before
      // any tool call reached this point — it is a real, genuine call
      // into the same real `CapabilityBroker` under test, not a
      // stand-in for anything downstream of it.
      const preGrant = await broker.requestCapability({
        actorId: "ai-orchestrator",
        capability: "automation.execute",
        justification: "real end-to-end tool-calling verification (Phase 13.12)",
      });
      expect(preGrant.decision).toBe("granted");

      const events: StreamEvent[] = [];
      for await (const event of orchestrator.sendMessage(
        "real-tool-calling-session",
        "Please show a desktop notification with the title 'Ryper Test' and the message 'Real tool call verified.' Use the show_notification tool.",
        { device: { online: true } },
      )) {
        events.push(event);
      }

      // 1. Real Qwen3 actually produced a structurally valid tool call
      // for this specific tool, parsed by the real, unmodified
      // OpenAICompatibleProvider from a real streamed llama-server
      // response — not fabricated, not the heuristic fallback's
      // regex-based pattern match.
      const toolCallEvent = events.find(
        (e): e is Extract<StreamEvent, { type: "tool_call" }> =>
          e.type === "tool_call" && e.toolCall.name === "show_notification",
      );
      expect(toolCallEvent).toBeDefined();
      expect(typeof toolCallEvent?.toolCall.arguments["title"]).toBe("string");
      expect(typeof toolCallEvent?.toolCall.arguments["message"]).toBe("string");
      // Evidence #1: the exact tool call Qwen3 produced.
      // eslint-disable-next-line no-console
      console.log(
        "[Phase 13.14 evidence] real Qwen3 tool call:",
        JSON.stringify(toolCallEvent?.toolCall),
      );

      // 2. The real CapabilityBroker was genuinely consulted and
      // genuinely recorded a real grant + a real "used" audit entry for
      // the "automation.execute" capability — direct evidence the broker
      // sat on the real path.
      const auditLog = broker.getAuditLog();
      expect(auditLog.some((e) => e.capability === "automation.execute" && e.result === "granted")).toBe(
        true,
      );
      expect(auditLog.some((e) => e.capability === "automation.execute" && e.result === "used")).toBe(
        true,
      );
      // Evidence #2: the real broker's own audit trail for this run.
      // eslint-disable-next-line no-console
      console.log("[Phase 13.14 evidence] CapabilityBroker audit log:", JSON.stringify(auditLog));

      // 3. THE ACTUAL WINDOWS ACTION GENUINELY SUCCEEDED. Phase
      // 13.12/13.13's test only checked for the absence of an
      // orchestrator-level "error" event — but ToolRegistry.invoke()
      // catches a thrown execute() error and reports it as a normal
      // {ok: false} tool RESULT, not an orchestrator error event, and
      // Qwen3 is perfectly capable of narrating that failure
      // gracefully in its final reply. Phase 13.13's real run on the
      // user's hardware hit exactly this: a real PowerShell failure
      // (`New-BurntToastNotification` — a third-party BurntToast
      // module cmdlet this repo never installs — exiting with code 1)
      // that the old assertions did not catch. This test now asserts
      // directly on the real, authoritative `tool_result` event
      // (docs/adr/0023) instead of inferring success from the absence
      // of a different event type.
      expect(events.some((e) => e.type === "error")).toBe(false);
      const toolResultEvent = events.find(
        (e): e is Extract<StreamEvent, { type: "tool_result" }> => e.type === "tool_result",
      );
      expect(toolResultEvent).toBeDefined();
      expect(toolResultEvent?.ok).toBe(true);
      // Evidence #3: the real Windows action's own result, straight
      // from ToolRegistry.invoke() -> desktopActions.showNotification()
      // -> real CapabilityManager.invoke() -> real WindowsAdapter ->
      // real PowerShellWindowsSystemApi -> real powershell.exe.
      // eslint-disable-next-line no-console
      console.log(
        "[Phase 13.14 evidence] real Windows action tool_result:",
        JSON.stringify(toolResultEvent),
      );

      // 4. The turn finished normally and real Qwen3 produced a real
      // final reply incorporating the (successful) tool result, rather
      // than the orchestrator exhausting maxToolRounds or erroring out.
      const doneEvent = events.find(
        (e): e is Extract<StreamEvent, { type: "done" }> => e.type === "done",
      );
      expect(doneEvent?.finishReason).toBe("stop");
      const finalText = events
        .filter((e): e is Extract<StreamEvent, { type: "text_delta" }> => e.type === "text_delta")
        .map((e) => e.delta)
        .join("");
      expect(finalText.length).toBeGreaterThan(0);
      // The final reply must not read as a failure narration — a real,
      // if approximate, sanity check on top of the authoritative
      // tool_result.ok assertion above (which is what this test
      // actually relies on; wording checks alone would be fragile).
      const lowerFinalText = finalText.toLowerCase();
      const failureLanguage = ["couldn't", "could not", "failed", "error", "issue", "unable"];
      expect(failureLanguage.some((phrase) => lowerFinalText.includes(phrase))).toBe(false);
      // Evidence #4: the real, final Qwen3-generated reply after the
      // tool result was fed back to it.
      // eslint-disable-next-line no-console
      console.log("[Phase 13.14 evidence] real Qwen3 final reply:", finalText);
    }, 180_000);
  },
);
