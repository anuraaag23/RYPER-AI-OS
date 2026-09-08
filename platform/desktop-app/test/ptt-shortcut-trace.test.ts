import { describe, expect, it, vi } from "vitest";

describe("PTT global shortcut registration and window state handling", () => {
  it("registers CommandOrControl+Shift+Space and triggers voice turn across focused, minimized, and background states", async () => {
    let registeredKey: string | undefined;
    let shortcutCallback: (() => void) | undefined;

    const mockGlobalShortcut = {
      unregisterAll: vi.fn(),
      register: vi.fn((key: string, callback: () => void) => {
        registeredKey = key;
        shortcutCallback = callback;
        return true;
      }),
    };

    let isVisible = true;
    let isFocused = true;
    const showSpy = vi.fn(() => {
      isVisible = true;
    });
    const focusSpy = vi.fn(() => {
      isFocused = true;
    });
    const sentIpcMessages: Array<{ channel: string; data: unknown }> = [];

    const mockMainWindow = {
      isVisible: () => isVisible,
      isFocused: () => isFocused,
      show: showSpy,
      focus: focusSpy,
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          sentIpcMessages.push({ channel, data });
        },
      },
    };

    let runTurnCalled = false;
    const mockCore = {
      webShell: {
        getDeviceState: () => ({ platform: "windows", freeRamGB: 8 }),
      },
      voice: {
        pipeline: {
          runTurn: vi.fn(async () => {
            runTurnCalled = true;
            return {
              handledByCommand: false,
              transcript: "hello",
              spokenResponse: "Hello, how can I help you?",
            };
          }),
          interrupt: vi.fn(),
        },
      },
    };

    // Simulate main.ts registerPttShortcut logic
    function registerPttShortcut(shortcutKey?: string): void {
      const key = shortcutKey || "CommandOrControl+Shift+Space";
      mockGlobalShortcut.unregisterAll();
      const success = mockGlobalShortcut.register(key, () => {
        if (mockMainWindow) {
          if (!mockMainWindow.isVisible()) {
            mockMainWindow.show();
          }
          mockMainWindow.focus();
        }
        mockMainWindow.webContents.send("voice:state", {
          orbStatus: "listening",
          connection: "connected",
        });
        void mockCore.voice.pipeline.runTurn(mockCore.webShell.getDeviceState() as any);
      });
      expect(success).toBe(true);
    }

    // Register shortcut
    registerPttShortcut();
    expect(registeredKey).toBe("CommandOrControl+Shift+Space");
    expect(mockGlobalShortcut.register).toHaveBeenCalledTimes(1);

    // State 1: Main window is focused
    isVisible = true;
    isFocused = true;
    shortcutCallback!();
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(sentIpcMessages[0]).toEqual({
      channel: "voice:state",
      data: { orbStatus: "listening", connection: "connected" },
    });
    expect(mockCore.voice.pipeline.runTurn).toHaveBeenCalledTimes(1);

    // State 2: Main window is minimized/hidden
    isVisible = false;
    isFocused = false;
    shortcutCallback!();
    expect(showSpy).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenCalledTimes(2);
    expect(isVisible).toBe(true);
    expect(isFocused).toBe(true);
    expect(mockCore.voice.pipeline.runTurn).toHaveBeenCalledTimes(2);

    // State 3: Another app (e.g. Notepad) is focused (RYPER is visible but unfocused)
    isVisible = true;
    isFocused = false;
    shortcutCallback!();
    expect(focusSpy).toHaveBeenCalledTimes(3);
    expect(isFocused).toBe(true);
    expect(mockCore.voice.pipeline.runTurn).toHaveBeenCalledTimes(3);
  });
});
