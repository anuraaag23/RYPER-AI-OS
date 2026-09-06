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
 * REAL WINDOWS AUDIO CAPABILITY INTEGRATION TEST — Phase 13.15.
 *
 * The second real-hardware capability test in this repository (after
 * `tool-calling.real.test.ts`'s notification path, confirmed passing
 * on real hardware in Phase 13.14). Drives the real `volume_up` tool
 * end-to-end with no mocks:
 *
 *   real Qwen3
 *     -> real AIOrchestrator.sendMessage() (unmodified)
 *     -> real ToolRegistry.invoke() (structural validation)
 *     -> real desktopActions.volumeUp() -> real CapabilityManager.invoke()
 *        -> real CapabilityPermissions.requestPermission() -> real
 *        CapabilityBroker.requestCapability() (docs/adr/0024: "audio"
 *        now requires "automation.execute", the first time this
 *        domain's broker gate has ever been reachable)
 *     -> real WindowsAdapter.audioManager -> real PowerShellWindowsSystemApi
 *        -> real powershell.exe running the real, native
 *        `IAudioEndpointVolume` COM interop this phase added
 *        (docs/adr/0024) -> a real system volume change
 *     -> the authoritative tool_result event (docs/adr/0023)
 *     -> real Qwen3 receives the real result and produces a real final
 *        reply.
 *
 * HONEST NOTE ON WHAT THIS TEST CAN AND CANNOT PROVE ON ITS OWN: unlike
 * a round-trippable action (write X, read X back), "volume went up"
 * has no assertion this test can make purely from Node without a
 * second, independent real-volume read. This test therefore reads the
 * real volume via `get_volume` (also using the same new COM interop)
 * both before and after the tool call, and asserts the value actually
 * increased — real, physical evidence the COM code path genuinely
 * works, not just that PowerShell exited 0.
 *
 * BOUNDARY SAFETY (fixed after a real run at max volume): `volumeUp`
 * (`desktop-actions.ts`) computes `Math.min(100, current + 10)` —
 * correct, intentional clamping, mirroring how a real volume-up key
 * behaves at max volume on any OS. At exactly 100, that means the
 * computed target *equals* the current value, so the real WASAPI call
 * still genuinely runs and succeeds (`tool_result.ok === true`), but
 * there is nothing left to observe change — a real run against a
 * machine already at 100% produced exactly that: a correct success
 * with no numeric delta, which an earlier version of this test
 * incorrectly treated as a failure. This is a **test design fix**, not
 * an implementation fix — `setVolume`/`volumeUp`/`volumeDown`'s
 * clamping in `desktop-actions.ts`/`powershell-system-api.ts` was
 * re-inspected and found correct at both the 0% and 100% boundaries;
 * see the boundary-logic unit tests added alongside this fix in
 * `powershell-system-api.test.ts` and `desktop-actions.test.ts`. This
 * test now establishes a real, headroom-guaranteeing baseline (50%)
 * whenever the real starting volume is already at/near the maximum,
 * verifies that baseline actually took effect, and — critically —
 * restores the user's real original volume in a `finally` block that
 * runs whether the test passes or fails.
 *
 * Same opt-in gating as `tool-calling.real.test.ts`: requires
 * `RYPER_LLAMA_SERVER_BINARY`/`RYPER_LLAMA_MODEL` and
 * `process.platform === "win32"`. Run with
 * `--pool=forks --poolOptions.forks.singleFork` on real Windows for
 * the same reason documented in `tool-calling.real.test.ts`.
 */

const binaryPath = process.env["RYPER_LLAMA_SERVER_BINARY"];
const modelPath = process.env["RYPER_LLAMA_MODEL"];
const isWindows = process.platform === "win32";

function alwaysApprove(_request: CapabilityRequest): boolean {
  return true;
}

/**
 * Above this, `volumeUp`'s `Math.min(100, current + 10)` clamp would
 * produce the same value as `current` — no headroom left to prove an
 * increase. Not exactly 100 alone: anything within one +10 step of the
 * ceiling that could round awkwardly is treated the same way, so the
 * baseline is only ever trusted when there is real, unambiguous room
 * to grow.
 */
const NEEDS_BASELINE_RESET_ABOVE = 90;
const SAFE_BASELINE_VOLUME = 50;

describe.skipIf(!binaryPath || !modelPath || !isWindows)(
  "AIOrchestrator -> ToolRegistry -> CapabilityBroker — REAL Qwen3 volume control (Phase 13.15, opt-in)",
  () => {
    it("a real Qwen3 volume_up tool call runs through the real broker and genuinely increases the real system volume", async () => {
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

      const systemApi = createPowerShellWindowsSystemApi(createNodePowerShellExec());
      const windowsAdapter = await createWindowsAdapter({ systemApi });
      capabilityManager.registerAdapter(windowsAdapter);
      for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
        capabilityManager.registerCapability(descriptor);
      }

      // The real volume as the user actually has it right now — this
      // is what gets restored, no matter what happens below.
      const originalVolume = await systemApi.getVolume();
      // eslint-disable-next-line no-console
      console.log(`[Phase 13.15 evidence] original real volume=${originalVolume}`);

      try {
        // Establish a real, headroom-guaranteeing baseline whenever
        // the real starting volume leaves volume_up nothing to prove
        // (see this file's top comment). This is a real setVolume
        // call through the same real COM interop under test — not a
        // fake/skipped step.
        let baseline = originalVolume;
        if (originalVolume > NEEDS_BASELINE_RESET_ABOVE) {
          await systemApi.setVolume(SAFE_BASELINE_VOLUME);
          baseline = await systemApi.getVolume();
          // eslint-disable-next-line no-console
          console.log(
            `[Phase 13.15 evidence] real volume was too close to the ceiling to prove an ` +
              `increase (${originalVolume}) — reset to a real baseline, confirmed at ${baseline}`,
          );
          expect(baseline).toBeLessThanOrEqual(NEEDS_BASELINE_RESET_ABOVE);
        } else {
          // eslint-disable-next-line no-console
          console.log(
            `[Phase 13.15 evidence] real starting volume (${originalVolume}) already has ` +
              `headroom — using it as the test baseline directly`,
          );
        }
        // eslint-disable-next-line no-console
        console.log(`[Phase 13.15 evidence] test baseline volume=${baseline}`);

        const { orchestrator, llmDiagnostics, localLLMActive } = await bootstrapAIOrchestrator(
          capabilityManager,
          broker,
          eventBus,
          { modelCacheDir: tmpdir() },
          fileSystem,
        );

        expect(llmDiagnostics.status).toBe("installed");
        expect(localLLMActive).toBe(true);

        const events: StreamEvent[] = [];
        for await (const event of orchestrator.sendMessage(
          "real-volume-session",
          "Please turn the volume up. Use the volume_up tool.",
          { device: { online: true } },
        )) {
          events.push(event);
        }

        const toolCallEvent = events.find(
          (e): e is Extract<StreamEvent, { type: "tool_call" }> =>
            e.type === "tool_call" && e.toolCall.name === "volume_up",
        );
        expect(toolCallEvent).toBeDefined();
        // eslint-disable-next-line no-console
        console.log(
          "[Phase 13.15 evidence] real Qwen3 tool call:",
          JSON.stringify(toolCallEvent?.toolCall),
        );

        const auditLog = broker.getAuditLog();
        expect(
          auditLog.some((e) => e.capability === "automation.execute" && e.result === "granted"),
        ).toBe(true);
        // eslint-disable-next-line no-console
        console.log("[Phase 13.15 evidence] CapabilityBroker audit log:", JSON.stringify(auditLog));

        expect(events.some((e) => e.type === "error")).toBe(false);
        const toolResultEvent = events.find(
          (e): e is Extract<StreamEvent, { type: "tool_result" }> => e.type === "tool_result",
        );
        expect(toolResultEvent).toBeDefined();
        expect(toolResultEvent?.ok).toBe(true);
        // eslint-disable-next-line no-console
        console.log(
          "[Phase 13.15 evidence] real Windows action tool_result:",
          JSON.stringify(toolResultEvent),
        );

        // The real, physical proof: the actual system volume
        // increased from the real, verified, headroom-guaranteed
        // baseline — not merely "changed" (which a decrease would
        // also satisfy) and not merely "did not throw."
        const afterVolumeUp = await systemApi.getVolume();
        // eslint-disable-next-line no-console
        console.log(`[Phase 13.15 evidence] real volume after volume_up=${afterVolumeUp}`);
        expect(afterVolumeUp).toBeGreaterThan(baseline);

        const doneEvent = events.find(
          (e): e is Extract<StreamEvent, { type: "done" }> => e.type === "done",
        );
        expect(doneEvent?.finishReason).toBe("stop");
        const finalText = events
          .filter((e): e is Extract<StreamEvent, { type: "text_delta" }> => e.type === "text_delta")
          .map((e) => e.delta)
          .join("");
        expect(finalText.length).toBeGreaterThan(0);
        // eslint-disable-next-line no-console
        console.log("[Phase 13.15 evidence] real Qwen3 final reply:", finalText);
      } finally {
        // Restore the user's real original volume regardless of
        // whether the assertions above passed or failed — this test
        // must never leave the machine's volume different from how
        // it found it.
        await systemApi.setVolume(originalVolume);
        const restoredVolume = await systemApi.getVolume();
        // eslint-disable-next-line no-console
        console.log(
          `[Phase 13.15 evidence] restored real volume to original=${originalVolume}, ` +
            `confirmed at=${restoredVolume}`,
        );
      }
    }, 180_000);
  },
);
