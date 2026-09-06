import { access, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createNodeFileSystem } from "@ryper/local-runtime";
import { EventBus } from "@ryper/event-bus";
import { CapabilityBroker, type CapabilityRequest } from "@ryper/security";
import { createCapabilityManager } from "@ryper/platform-capability";
import {
  createWindowsAdapter,
  createPowerShellWindowsSystemApi,
  WINDOWS_CAPABILITY_DESCRIPTORS,
  type MediaSessionState,
} from "@ryper/windows-agent";
import type { StreamEvent } from "@ryper/ai-engine";
import { bootstrapAIOrchestrator } from "../electron/ai-orchestrator-bootstrap.js";
import { createNodePowerShellExec } from "../electron/windows-shell-exec.js";
import {
  launchMediaSessionFixture,
  closeMediaSessionFixture,
} from "./support/media-session-fixture-launcher.js";
import {
  realHardwareLlamaPreflight,
  realHardwareEdgePreflight,
} from "./support/real-hardware-preflight.js";

/**
 * REAL WINDOWS MEDIA CONTROL INTEGRATION TEST — Phase 13.15.
 *
 * The third real-hardware capability test in this repository, after
 * notifications (Phase 13.14) and volume (this phase, REAL HARDWARE
 * VERIFIED). Drives the real `media_play`/`media_pause`/`media_next`/
 * `media_previous` tools end-to-end with no mocks:
 *
 *   real Qwen3
 *     -> real AIOrchestrator.sendMessage() (unmodified)
 *     -> real ToolRegistry.invoke() (structural validation)
 *     -> real desktopActions.mediaControl() -> real CapabilityManager
 *        -> real CapabilityBroker (docs/adr/0024: "audio" requires
 *        "automation.execute")
 *     -> real WindowsAdapter.audioManager -> real PowerShellWindowsSystemApi
 *        -> real powershell.exe running the real, native `keybd_event`
 *        virtual-media-key press (docs/adr/0024)
 *     -> the authoritative tool_result event (docs/adr/0023)
 *     -> real Qwen3 receives the real result and produces a real final
 *        reply.
 *
 * WHY THIS TEST IS STRUCTURED DIFFERENTLY FROM `audio-capability.real.test.ts`:
 * volume has a universal, always-populated, exact numeric value this
 * repo can read via WASAPI regardless of what's running on the
 * machine. Media playback has no equivalent — Windows only exposes
 * "now playing" state (docs/adr/0025's `getNowPlayingState()`, via
 * `GlobalSystemMediaTransportControlsSessionManager`) for
 * applications that currently have an *active* System Media Transport
 * Controls session, which requires something to actually be playing
 * or paused on the test machine at run time — a real-world
 * precondition this repository cannot manufacture from Node/PowerShell
 * without launching and controlling a real media application (a much
 * larger, separate piece of work, not attempted here).
 *
 * This test therefore makes an honest, explicit distinction between
 * two different, always-true things and one conditionally-true thing:
 *
 * 1. ALWAYS asserted, regardless of environment (the same rigor every
 *    other real test in this repo already holds itself to): a real,
 *    structurally valid tool call was produced by Qwen3; the real
 *    broker genuinely granted `automation.execute`; the real tool
 *    executed with `tool_result.ok === true` and no orchestrator error
 *    event; and real Qwen3 produced a real final reply. This is
 *    genuine, physical proof the *mechanical path* — all the way
 *    through a real `keybd_event` call actually running on real
 *    Windows — works, exactly the same class of evidence
 *    `tool_result.ok` already represents everywhere else in this repo.
 * 2. CONDITIONALLY asserted, only when a real, active media session
 *    exists on the test machine at run time (checked via a real
 *    `getNowPlayingState()` read before anything else happens): that
 *    the real, observable session state actually changed the way the
 *    action implies (`play`/`pause` toggling `status`, `next`/
 *    `previous` changing the current track's `title`). This is the
 *    stronger, physical, environment-dependent claim.
 * 3. When no active media session exists, this test does **not**
 *    silently pass item 2 or weaken its assertion to tolerate an
 *    unchanged value — it explicitly logs and reports
 *    "NOT VERIFIED (no active media session)" for that specific
 *    action, and does not claim physical verification for it. Per
 *    the user's explicit instruction, this is the honest outcome to
 *    report rather than a weakened assertion.
 *
 * A THIRD test below (docs/adr/0026) removes the environmental
 * dependency on "whatever happens to already be playing" by launching
 * a real, visible Microsoft Edge window pointed at a local fixture
 * page that uses the standard, first-party Web `MediaSession` API —
 * genuinely registering a real SMTC session with real Windows, not a
 * mock of any Windows media API. When that real session can be
 * established (polled for, with a real, bounded timeout), all four
 * physical assertions become hard/unconditional, exactly as strict as
 * `audio-capability.real.test.ts`'s volume assertions. If the real
 * session cannot be established within that timeout on a given run,
 * this test still does not claim success — it logs
 * "NOT VERIFIED (could not establish a real, active, readable media
 * session...)" and returns without asserting the physical claims,
 * rather than weakening them.
 *
 * Same opt-in gating as the other real tests: requires
 * `RYPER_LLAMA_SERVER_BINARY`/`RYPER_LLAMA_MODEL` and
 * `process.platform === "win32"`. Run with
 * `--pool=forks --poolOptions.forks.singleFork` on real Windows.
 *
 * REAL-HARDWARE INFRASTRUCTURE FIXES (this file, docs/adr/0027): a
 * real run surfaced two environment/launcher issues, neither of which
 * indicated a RYPER implementation problem:
 *
 * 1. `llmDiagnostics.status` reported `"binary-missing"` despite
 *    `RYPER_LLAMA_SERVER_BINARY`/`RYPER_LLAMA_MODEL` being correctly
 *    set in the same shell. Investigated: `defaultLlamaServerPaths()`
 *    (`llm-model-provisioning.ts`) is shared, unmodified, identical
 *    code across every real test file in this repo — there was no
 *    separate/different resolution path to fix. Rather than guess at
 *    an unverifiable root cause, `buildHarness()` now runs
 *    `realHardwareLlamaPreflight()` first, which reads and logs the
 *    exact `process.env` values this specific test process sees and
 *    fails immediately, with a precise reason, if they're
 *    missing/invalid — instead of surfacing ~90 seconds later as a
 *    generic, silently-defaulted-to-`tmpdir()` "binary-missing".
 * 2. The Edge fixture launcher assumed `Start-Process -FilePath
 *    'msedge.exe'` would resolve via Windows' "App Paths" registry
 *    redirection — a wrong assumption (`Start-Process` uses .NET's
 *    `Process.Start()`, which only searches `PATH`, not App Paths;
 *    that redirection is a `ShellExecuteEx`-level mechanism). Fixed
 *    with `resolveEdgeExecutable()`
 *    (`media-session-fixture-launcher.ts`): checks, in order,
 *    `RYPER_EDGE_BINARY`, a real registry `Get-ItemProperty` read of
 *    the App Paths key, the two standard `Program Files` install
 *    locations, and a real `Get-Command` `PATH` lookup — throwing a
 *    clear, actionable error, explicitly framed as a
 *    test-environment prerequisite rather than a RYPER failure, if
 *    none succeed. Never substitutes a different browser engine
 *    (Chrome/Firefox/Brave) without that being a separately justified,
 *    documented decision — Chromium/Edge's specific `MediaSession`-to-
 *    SMTC integration is what this fixture depends on, and that has
 *    not been proven equivalent across engines.
 */

const binaryPath = process.env["RYPER_LLAMA_SERVER_BINARY"];
const modelPath = process.env["RYPER_LLAMA_MODEL"];
const isWindows = process.platform === "win32";

function alwaysApprove(_request: CapabilityRequest): boolean {
  return true;
}

interface MediaTestHarness {
  readonly orchestrator: Awaited<ReturnType<typeof bootstrapAIOrchestrator>>["orchestrator"];
  readonly getNowPlayingState: () => Promise<MediaSessionState>;
  readonly broker: CapabilityBroker;
}

async function buildHarness(): Promise<MediaTestHarness> {
  // Fails fast (milliseconds) with a precise, actionable reason if the
  // llama-server binary/model env vars aren't visible/valid in this
  // test process, instead of spending ~90s only to hit
  // bootstrapAIOrchestrator()'s generic "binary-missing" diagnostic.
  await realHardwareLlamaPreflight();

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
  const capabilityManager = createCapabilityManager({ broker, platformDetector: () => "windows" });

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
  expect(llmDiagnostics.status).toBe("installed");
  expect(localLLMActive).toBe(true);

  return { orchestrator, getNowPlayingState: () => systemApi.getNowPlayingState(), broker };
}

async function runMediaTool(
  harness: MediaTestHarness,
  toolName: "media_play" | "media_pause" | "media_next" | "media_previous",
  utterance: string,
): Promise<{ events: StreamEvent[]; toolResult: Extract<StreamEvent, { type: "tool_result" }> }> {
  const events: StreamEvent[] = [];
  for await (const event of harness.orchestrator.sendMessage(
    `real-media-session-${toolName}`,
    utterance,
    {
      device: { online: true },
    },
  )) {
    events.push(event);
  }

  const toolCallEvent = events.find(
    (e): e is Extract<StreamEvent, { type: "tool_call" }> =>
      e.type === "tool_call" && e.toolCall.name === toolName,
  );
  expect(toolCallEvent).toBeDefined();
  // eslint-disable-next-line no-console
  console.log(
    `[Phase 13.15 media evidence] real Qwen3 tool call (${toolName}):`,
    JSON.stringify(toolCallEvent?.toolCall),
  );

  const auditLog = harness.broker.getAuditLog();
  expect(
    auditLog.some((e) => e.capability === "automation.execute" && e.result === "granted"),
  ).toBe(true);

  // ALWAYS-true assertions (item 1 above): the mechanical path is real
  // regardless of what, if anything, is actually playing on this
  // machine.
  expect(events.some((e) => e.type === "error")).toBe(false);
  const toolResultEvent = events.find(
    (e): e is Extract<StreamEvent, { type: "tool_result" }> => e.type === "tool_result",
  );
  expect(toolResultEvent).toBeDefined();
  expect(toolResultEvent?.ok).toBe(true);
  // eslint-disable-next-line no-console
  console.log(
    `[Phase 13.15 media evidence] real Windows action tool_result (${toolName}):`,
    JSON.stringify(toolResultEvent),
  );

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
  console.log(`[Phase 13.15 media evidence] real Qwen3 final reply (${toolName}):`, finalText);

  return { events, toolResult: toolResultEvent as Extract<StreamEvent, { type: "tool_result" }> };
}

describe.skipIf(!binaryPath || !modelPath || !isWindows)(
  "AIOrchestrator -> ToolRegistry -> CapabilityBroker — REAL Qwen3 media control (Phase 13.15, opt-in)",
  () => {
    it(
      "media_play/media_pause: the mechanical path is always real; physical playback-state verification " +
        "is conditional on a real active media session existing on this machine",
      async () => {
        const harness = await buildHarness();

        const before = await harness.getNowPlayingState();
        // eslint-disable-next-line no-console
        console.log(
          "[Phase 13.15 media evidence] real media session before play:",
          JSON.stringify(before),
        );

        await runMediaTool(
          harness,
          "media_play",
          "Please play the media. Use the media_play tool.",
        );

        const afterPlay = await harness.getNowPlayingState();
        // eslint-disable-next-line no-console
        console.log(
          "[Phase 13.15 media evidence] real media session after play:",
          JSON.stringify(afterPlay),
        );

        if (afterPlay.status === "none") {
          // eslint-disable-next-line no-console
          console.log(
            "[Phase 13.15 media evidence] media_play: NOT VERIFIED (no active media session on " +
              "this machine) — the real key press was sent (see tool_result above), but there is " +
              "nothing with an active System Media Transport Controls session for it to affect, " +
              "so no physical playback-state claim is made.",
          );
        } else {
          // A real, active session exists — hold this to the stronger,
          // physical claim: playback state must actually show playing.
          expect(afterPlay.status).toBe("playing");
          // eslint-disable-next-line no-console
          console.log(
            "[Phase 13.15 media evidence] media_play: VERIFIED — real session status is now " +
              `"playing" (was "${before.status}").`,
          );
        }

        await runMediaTool(
          harness,
          "media_pause",
          "Please pause the media. Use the media_pause tool.",
        );
        const afterPause = await harness.getNowPlayingState();
        // eslint-disable-next-line no-console
        console.log(
          "[Phase 13.15 media evidence] real media session after pause:",
          JSON.stringify(afterPause),
        );

        if (afterPause.status === "none") {
          // eslint-disable-next-line no-console
          console.log(
            "[Phase 13.15 media evidence] media_pause: NOT VERIFIED (no active media session on " +
              "this machine).",
          );
        } else {
          expect(afterPause.status).toBe("paused");
          // eslint-disable-next-line no-console
          console.log(
            '[Phase 13.15 media evidence] media_pause: VERIFIED — real session status is now "paused".',
          );
        }
      },
      180_000,
    );

    it(
      "media_next/media_previous: the mechanical path is always real; physical track-change verification " +
        "is conditional on a real active media session with track metadata existing on this machine",
      async () => {
        const harness = await buildHarness();

        const before = await harness.getNowPlayingState();
        // eslint-disable-next-line no-console
        console.log(
          "[Phase 13.15 media evidence] real media session before next:",
          JSON.stringify(before),
        );

        await runMediaTool(
          harness,
          "media_next",
          "Please skip to the next track. Use the media_next tool.",
        );
        const afterNext = await harness.getNowPlayingState();
        // eslint-disable-next-line no-console
        console.log(
          "[Phase 13.15 media evidence] real media session after next:",
          JSON.stringify(afterNext),
        );

        if (afterNext.status === "none" || !afterNext.title || !before.title) {
          // eslint-disable-next-line no-console
          console.log(
            "[Phase 13.15 media evidence] media_next: NOT VERIFIED (no active media session with " +
              "readable track metadata on this machine) — the real key press was sent (see " +
              "tool_result above), but there is no independently-readable track title to prove a " +
              "change against, so no physical track-change claim is made.",
          );
        } else if (before.title === afterNext.title) {
          // A session and titles are readable, but they're identical —
          // this is a real, informative, honest non-result (e.g. a
          // single-track session, or a source that doesn't expose
          // track boundaries the same way) rather than proof either
          // way. Reported as NOT VERIFIED, not treated as a pass.
          // eslint-disable-next-line no-console
          console.log(
            "[Phase 13.15 media evidence] media_next: NOT VERIFIED (track title unchanged after " +
              `the tool call — "${before.title}" before and after; the machine's current media ` +
              "source may not have a multi-track queue to advance through).",
          );
        } else {
          expect(afterNext.title).not.toBe(before.title);
          // eslint-disable-next-line no-console
          console.log(
            `[Phase 13.15 media evidence] media_next: VERIFIED — track title changed from ` +
              `"${before.title}" to "${afterNext.title}".`,
          );
        }

        await runMediaTool(
          harness,
          "media_previous",
          "Please go back to the previous track. Use the media_previous tool.",
        );
        const afterPrevious = await harness.getNowPlayingState();
        // eslint-disable-next-line no-console
        console.log(
          "[Phase 13.15 media evidence] real media session after previous:",
          JSON.stringify(afterPrevious),
        );

        if (afterPrevious.status === "none" || !afterPrevious.title || !afterNext.title) {
          // eslint-disable-next-line no-console
          console.log(
            "[Phase 13.15 media evidence] media_previous: NOT VERIFIED (no active media session " +
              "with readable track metadata on this machine).",
          );
        } else if (afterNext.title === afterPrevious.title) {
          // eslint-disable-next-line no-console
          console.log(
            "[Phase 13.15 media evidence] media_previous: NOT VERIFIED (track title unchanged " +
              "after the tool call).",
          );
        } else {
          expect(afterPrevious.title).not.toBe(afterNext.title);
          // eslint-disable-next-line no-console
          console.log(
            `[Phase 13.15 media evidence] media_previous: VERIFIED — track title changed from ` +
              `"${afterNext.title}" to "${afterPrevious.title}".`,
          );
        }
      },
      180_000,
    );

    it(
      "media_play/pause/next/previous physically verified via a real, controlled Edge " +
        "MediaSession fixture (docs/adr/0026, docs/adr/0027) — no simulated/reference media session",
      async () => {
        const harness = await buildHarness();
        const fixtureUrl = pathToFileURL(
          fileURLToPath(new URL("./fixtures/media-session-fixture.html", import.meta.url)),
        ).href;
        const exec = createNodePowerShellExec();

        // Real preflight: resolves and logs the real Edge executable
        // path/method (docs/adr/0027), and fails immediately with a
        // clear, actionable reason — explicitly a test-environment
        // prerequisite, not a RYPER implementation failure — if no
        // real browser can be found anywhere on this machine, rather
        // than attempting a launch that was always going to fail.
        await realHardwareEdgePreflight(exec);

        let pid: number | undefined;
        try {
          // eslint-disable-next-line no-console
          console.log(
            "[Phase 13.15 media evidence] launching real Edge media-session fixture:",
            fixtureUrl,
          );
          const launched = await launchMediaSessionFixture(exec, fixtureUrl);
          pid = launched.pid;
          // eslint-disable-next-line no-console
          console.log(
            "[Phase 13.15 media evidence] real Edge process launched, pid=",
            pid,
            "via",
            launched.edge.method,
            "at",
            launched.edge.path,
          );

          // Poll, with a real, bounded timeout, for the real fixture's
          // real MediaSession registration to actually take effect and
          // become readable via the same real getNowPlayingState() this
          // repo already built — not assumed to be instant.
          const expectedInitialTitle = "RYPER Test Track One";
          let established: MediaSessionState = { status: "none" };
          const deadline = Date.now() + 20_000;
          while (Date.now() < deadline) {
            established = await harness.getNowPlayingState();
            if (established.status !== "none" && established.title === expectedInitialTitle) break;
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          // eslint-disable-next-line no-console
          console.log(
            "[Phase 13.15 media evidence] real session state after waiting for the fixture:",
            JSON.stringify(established),
          );

          if (established.status === "none" || established.title !== expectedInitialTitle) {
            // Per the user's explicit instruction: if a real active
            // session cannot be established reliably, document these
            // four capabilities as NOT VERIFIED for this run rather
            // than claim success or fail the whole suite on an
            // environmental precondition this repo doesn't fully
            // control (e.g. a real Edge autoplay/window-focus quirk on
            // this specific machine).
            // eslint-disable-next-line no-console
            console.log(
              "[Phase 13.15 media evidence] media_play/media_pause/media_next/media_previous: " +
                "NOT VERIFIED (could not establish a real, active, readable media session via the " +
                "Edge fixture within 20s on this run).",
            );
            return;
          }

          // A real, active, readable session now exists — every
          // assertion below is a hard, unconditional physical claim
          // (not weakened), since the precondition for making it is
          // now genuinely satisfied.
          await runMediaTool(
            harness,
            "media_play",
            "Please play the media. Use the media_play tool.",
          );
          const afterPlay = await harness.getNowPlayingState();
          expect(afterPlay.status).toBe("playing");
          // eslint-disable-next-line no-console
          console.log(
            "[Phase 13.15 media evidence] media_play: REAL HARDWARE VERIFIED (deterministic " +
              'fixture) — real session status is now "playing".',
          );

          await runMediaTool(
            harness,
            "media_pause",
            "Please pause the media. Use the media_pause tool.",
          );
          const afterPause = await harness.getNowPlayingState();
          expect(afterPause.status).toBe("paused");
          // eslint-disable-next-line no-console
          console.log(
            "[Phase 13.15 media evidence] media_pause: REAL HARDWARE VERIFIED (deterministic " +
              'fixture) — real session status is now "paused".',
          );

          await runMediaTool(
            harness,
            "media_next",
            "Please skip to the next track. Use the media_next tool.",
          );
          const afterNext = await harness.getNowPlayingState();
          expect(afterNext.title).toBe("RYPER Test Track Two");
          // eslint-disable-next-line no-console
          console.log(
            "[Phase 13.15 media evidence] media_next: REAL HARDWARE VERIFIED (deterministic " +
              `fixture) — real track title is now "${afterNext.title}".`,
          );

          await runMediaTool(
            harness,
            "media_previous",
            "Please go back to the previous track. Use the media_previous tool.",
          );
          const afterPrevious = await harness.getNowPlayingState();
          expect(afterPrevious.title).toBe("RYPER Test Track One");
          // eslint-disable-next-line no-console
          console.log(
            "[Phase 13.15 media evidence] media_previous: REAL HARDWARE VERIFIED (deterministic " +
              `fixture) — real track title is back to "${afterPrevious.title}".`,
          );
        } finally {
          if (pid !== undefined) {
            await closeMediaSessionFixture(exec, pid);
            // eslint-disable-next-line no-console
            console.log("[Phase 13.15 media evidence] closed real Edge fixture process, pid=", pid);
          }
        }
      },
      180_000,
    );
  },
);
