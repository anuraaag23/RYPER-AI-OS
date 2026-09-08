// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { OnboardingModal } from "../src/components/OnboardingModal.js";
import { ErrorBoundary } from "../src/components/ErrorBoundary.js";
import {
  SettingsApp,
  formatSanitizedDiagnostics,
  sanitizeDiagnosticsText,
} from "../src/SettingsApp.js";
import { ChatPanel } from "../src/components/ChatPanel.js";
import type {
  AIStatusPayload,
  AppSettings,
  AudioDevicePayload,
  AudioStatusPayload,
  HealthCheckSummary,
  PermissionEntryPayload,
} from "../electron/ipc-contract.js";

afterEach(cleanup);

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
});

function installFakeRyper(overrides: {
  settings?: Partial<AppSettings>;
  health?: HealthCheckSummary;
  aiStatus?: AIStatusPayload;
  openLogsFolder?: () => Promise<void>;
  restartLocalAI?: () => Promise<{ ok: boolean; message: string }>;
} = {}) {
  const fake = {
    listConversations: vi.fn(async () => []),
    listMessages: vi.fn(async () => []),
    sendMessage: vi.fn(async () => ({ content: "ok", retrievedContext: [] })),
    deleteMessage: vi.fn(async () => undefined),
    regenerateMessage: vi.fn(async () => undefined),
    cancelTurn: vi.fn(async () => undefined),
    getCurrentReference: vi.fn(async () => undefined),
    getSettings: vi.fn(
      async (): Promise<AppSettings> => ({
        theme: "system",
        voiceEnabled: true,
        launchAtLogin: false,
        pushToTalkShortcut: "CommandOrControl+Shift+Space",
        hasCompletedOnboarding: true,
        ...overrides.settings,
      }),
    ),
    updateSettings: vi.fn(
      async (patch: Partial<AppSettings>): Promise<AppSettings> => ({
        theme: "system",
        voiceEnabled: true,
        launchAtLogin: false,
        pushToTalkShortcut: "CommandOrControl+Shift+Space",
        hasCompletedOnboarding: true,
        ...patch,
      }),
    ),
    onSettingsChanged: vi.fn(() => () => undefined),
    getHealth: vi.fn(
      async (): Promise<HealthCheckSummary> =>
        overrides.health ?? {
          status: "healthy",
          platform: "win32",
          platformVersion: "10.0.26100",
          capabilitiesSupported: 8,
          capabilitiesTotal: 8,
          details: ["gateway: active", "platform: win32"],
        },
    ),
    getAIStatus: vi.fn(
      async (): Promise<AIStatusPayload> =>
        overrides.aiStatus ?? {
          mode: "local",
          label: "Local AI • Qwen3-8B",
          ready: true,
          readinessState: "ready",
          detail: "Local model running on port 8090",
        },
    ),
    onAIStatusChanged: vi.fn(() => () => undefined),
    restartLocalAI:
      overrides.restartLocalAI ??
      vi.fn(async () => ({ ok: true, message: "Local AI service check completed." })),
    openLogsFolder: overrides.openLogsFolder ?? vi.fn(async () => undefined),
    listPermissions: vi.fn(
      async (): Promise<readonly PermissionEntryPayload[]> => [
        {
          id: "p1",
          category: "File Access",
          description: "Read documents folder",
          granted: true,
          isSessionOnly: true,
          requestedAt: new Date().toISOString(),
        },
      ],
    ),
    resetPermissions: vi.fn(async () => undefined),
    getAudioStatus: vi.fn(
      async (): Promise<AudioStatusPayload> => ({
        microphone: "available",
        speaker: "available",
      }),
    ),
    listAudioDevices: vi.fn(async (): Promise<readonly AudioDevicePayload[]> => []),
    selectAudioDevice: vi.fn(async () => undefined),
    requestAudioPermission: vi.fn(async () => true),
    onAudioStatusChanged: vi.fn(() => () => undefined),
    onVoiceState: vi.fn(() => () => undefined),
    onTurnProgress: vi.fn(() => () => undefined),
    onConversationUpdated: vi.fn(() => () => undefined),
  };

  Object.defineProperty(window, "ryper", { value: fake, writable: true, configurable: true });
  return fake;
}

describe("P3-1: First-Run Onboarding Modal", () => {
  it("renders Step 1 with on-device privacy information", () => {
    const onComplete = vi.fn();
    render(<OnboardingModal onComplete={onComplete} />);

    expect(screen.getByText("Welcome to RYPER AI OS")).toBeTruthy();
    expect(screen.getByText(/On-Device Intelligence & Privacy/i)).toBeTruthy();
    expect(screen.getByLabelText("Step 1 of 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Skip/i })).toBeTruthy();
  });

  it("navigates through 3 steps and completes onboarding", () => {
    const onComplete = vi.fn();
    render(<OnboardingModal onComplete={onComplete} />);

    // Advance to Step 2
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Hands-Free Desktop Power")).toBeTruthy();
    expect(screen.getByText("Control Windows with Your Consent")).toBeTruthy();
    expect(screen.getByLabelText("Step 2 of 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();

    // Advance to Step 3
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Speak or Type Anytime")).toBeTruthy();
    expect(screen.getByText("Natural Multilingual Voice")).toBeTruthy();
    expect(screen.getByLabelText("Step 3 of 3")).toBeTruthy();

    // Click "Get Started" to complete
    const getStartedBtn = screen.getByRole("button", { name: "Get Started" });
    expect(getStartedBtn).toBeTruthy();
    fireEvent.click(getStartedBtn);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("can be skipped directly from step 1", () => {
    const onComplete = vi.fn();
    render(<OnboardingModal onComplete={onComplete} />);

    fireEvent.click(screen.getByRole("button", { name: /Skip/i }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("can be dismissed with Escape key", () => {
    const onComplete = vi.fn();
    render(<OnboardingModal onComplete={onComplete} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("P3-2 & P3-3: Local AI Readiness & Crash Recovery", () => {
  it("renders local AI readiness badge in ChatPanel popover", async () => {
    installFakeRyper({
      aiStatus: {
        mode: "local",
        label: "Local AI • Qwen3-8B",
        ready: true,
        readinessState: "ready",
        detail: "Engine running",
      },
    });

    render(<ChatPanel conversationId="c1" />);
    const indicator = await screen.findByRole("status", { name: /Local AI/i });
    fireEvent.click(indicator);

    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("ErrorBoundary catches runtime render error and shows recovery UI without leaking call stacks", () => {
    const ThrowError = (): JSX.Element => {
      throw new Error("Simulated fatal render error at C:\\Users\\user\\secret.ts");
    };

    // Suppress console.error in vitest output for intentional error boundary test
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something unexpected happened")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload Application" })).toBeTruthy();
    // Verify user profile paths or secrets are never exposed in UI
    expect(screen.queryByText(/secret\.ts/)).toBeNull();

    consoleSpy.mockRestore();
  });
});

describe("P3-4: Diagnostics & Support UX", () => {
  it("strictly sanitizes user paths, registry keys, and authentication tokens", () => {
    const raw =
      "Failed to read C:\\Users\\alice\\AppData\\secret.json with token=super_secret_token123 in HKLM\\Software\\Ryper";
    const sanitized = sanitizeDiagnosticsText(raw);

    expect(sanitized).not.toContain("alice");
    expect(sanitized).not.toContain("super_secret_token123");
    expect(sanitized).not.toContain("HKLM\\Software\\Ryper");
    expect(sanitized).toContain("[USER_PATH]");
    expect(sanitized).toContain("token=[REDACTED]");
    expect(sanitized).toContain("[REGISTRY_KEY]");
  });

  it("formats valid sanitized diagnostics JSON report", () => {
    const health: HealthCheckSummary = {
      status: "healthy",
      platform: "win32",
      platformVersion: "10.0.26100",
      capabilitiesSupported: 12,
      capabilitiesTotal: 12,
      details: [
        "Store at C:\\Users\\admin\\db.sqlite",
        "auth token abc12345 active",
      ],
    };
    const aiStatus: AIStatusPayload = {
      mode: "local",
      label: "Local AI • Qwen3-8B",
      ready: true,
      readinessState: "ready",
      detail: "Listening on 8090",
    };

    const jsonStr = formatSanitizedDiagnostics(health, aiStatus);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.app).toBe("RYPER AI OS");
    expect(parsed.version).toBe("0.1.2");
    expect(parsed.channel).toBe("Stable (Windows x64)");
    expect(parsed.runtime.gatewayStatus).toBe("healthy");
    expect(parsed.localAI.readinessState).toBe("ready");
    expect(parsed.capabilities.supportedCount).toBe(12);

    // Verify sanitized details do not contain admin username or auth token
    const joinedDetails = parsed.healthDetails.join(" ");
    expect(joinedDetails).not.toContain("admin");
    expect(joinedDetails).not.toContain("abc12345");
  });

  it("SettingsApp renders structured health cards and triggers diagnostics actions", async () => {
    const fake = installFakeRyper();
    render(<SettingsApp />);

    await screen.findByText("Diagnostics & System Health");

    expect(screen.getByText("Core Gateway")).toBeTruthy();
    expect(screen.getByText("Local AI Runtime")).toBeTruthy();
    expect(screen.getByText("Platform & OS")).toBeTruthy();
    expect(screen.getByText("Memory Subsystem")).toBeTruthy();
    expect(screen.getByText("Capability Broker")).toBeTruthy();

    // Run Health Check action
    const runHealthCheckBtn = screen.getByRole("button", { name: "Run Health Check" });
    fireEvent.click(runHealthCheckBtn);
    await waitFor(() => {
      expect(fake.getHealth).toHaveBeenCalled();
    });

    // Open Logs Folder action
    const openLogsBtn = screen.getByRole("button", { name: "Open Logs Folder" });
    fireEvent.click(openLogsBtn);
    expect(fake.openLogsFolder).toHaveBeenCalled();
  });
});

describe("P3-5: Version & Update UX Foundation", () => {
  it("renders 0.1.1 version, Stable Windows channel, and honest update notice", async () => {
    installFakeRyper();
    render(<SettingsApp />);

    await screen.findByText("About & Updates");

    expect(screen.getByText("RYPER AI OS")).toBeTruthy();
    expect(screen.getByText("v0.1.2")).toBeTruthy();
    expect(screen.getByText("Stable (Windows x64)")).toBeTruthy();
    expect(
      screen.getByText(/Official releases are distributed via verified release packages/i),
    ).toBeTruthy();

    const checkUpdatesBtn = screen.getByRole("button", { name: "Check for Updates" });
    expect(checkUpdatesBtn).toBeTruthy();

    // Trigger update check
    fireEvent.click(checkUpdatesBtn);
    expect(await screen.findByText(/Checking release channel/i)).toBeTruthy();
  });
});
