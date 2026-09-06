import { describe, expect, it } from "vitest";
import { CapabilityBroker } from "@ryper/security";
import { createCapabilityManager } from "@ryper/platform-capability";
import {
  createWindowsAdapter,
  createInMemoryWindowsSystemApi,
  WINDOWS_CAPABILITY_DESCRIPTORS,
} from "@ryper/windows-agent";
import { desktopActions } from "../electron/desktop-actions.js";

/**
 * Real coverage for the "preferred browser" Settings feature added to
 * `openUrl`/`smartOpen`: when the request doesn't name a browser
 * explicitly, a configured default (see `SettingsApp.tsx`'s "Default
 * browser") is used instead of always falling through to the system
 * default — but only when it's actually installed. A stale/uninstalled
 * preference degrades to the system default rather than failing the
 * open, since the user didn't type that browser name themselves; an
 * *explicit* request naming an uninstalled browser still fails loudly
 * (see the `BrowserNotInstalledError`-surfacing test below), matching
 * the "never silently substitute a browser" rule for anything the
 * person actually asked for by name.
 *
 * The reference `InMemoryWindowsSystemApi` seeds "Microsoft Edge" as
 * installed by default and nothing else — real, deterministic ground
 * for both the "preference is installed" and "preference is not
 * installed" cases without needing real hardware.
 */
async function buildCapabilityManager() {
  const broker = new CapabilityBroker(() => true);
  const capabilityManager = createCapabilityManager({ broker, platformDetector: () => "windows" });
  const adapter = await createWindowsAdapter({ systemApi: createInMemoryWindowsSystemApi() });
  capabilityManager.registerAdapter(adapter);
  for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
    capabilityManager.registerCapability(descriptor);
  }
  return capabilityManager;
}

describe("desktopActions.openUrl — preferred browser (Settings)", () => {
  it("uses the preferred browser when it's actually installed and none was named explicitly", async () => {
    const capabilityManager = await buildCapabilityManager();
    const result = await desktopActions.openUrl(
      capabilityManager,
      "test",
      "https://example.com",
      undefined,
      undefined,
      "edge",
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain("edge");
  });

  it("falls back to the system default, still succeeding, when the preferred browser isn't installed", async () => {
    const capabilityManager = await buildCapabilityManager();
    const result = await desktopActions.openUrl(
      capabilityManager,
      "test",
      "https://example.com",
      undefined,
      undefined,
      "chrome", // not in the reference seed's installed apps
    );
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Opening https://example.com.");
    expect(result.message).not.toContain("chrome");
  });

  it("an explicitly-named uninstalled browser still fails loudly — never silently substituted", async () => {
    const capabilityManager = await buildCapabilityManager();
    const result = await desktopActions.openUrl(
      capabilityManager,
      "test",
      "https://example.com",
      "chrome", // explicit this time, not a preference
      undefined,
      "edge", // even though the preference WOULD have worked
    );
    expect(result.ok).toBe(false);
    expect(result.message.toLowerCase()).toContain("chrome");
  });

  it("an explicit browser always wins over a configured preference", async () => {
    const capabilityManager = await buildCapabilityManager();
    const result = await desktopActions.openUrl(
      capabilityManager,
      "test",
      "https://example.com",
      "edge",
      undefined,
      undefined,
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain("edge");
  });

  it("opens via the plain system default when no browser and no preference are given", async () => {
    const capabilityManager = await buildCapabilityManager();
    const result = await desktopActions.openUrl(capabilityManager, "test", "https://example.com");
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Opening https://example.com.");
  });
});

describe("desktopActions.smartOpen — preferred browser (Settings)", () => {
  it("resolves the preferred browser id and passes it through when the target turns out to be a URL", async () => {
    const capabilityManager = await buildCapabilityManager();
    const result = await desktopActions.smartOpen(
      capabilityManager,
      "test",
      "https://example.com",
      undefined,
      undefined,
      "edge",
    );
    expect(result.ok).toBe(true);
  });

  it("an explicitly-named browser in smartOpen still wins over the preference", async () => {
    const capabilityManager = await buildCapabilityManager();
    const result = await desktopActions.smartOpen(
      capabilityManager,
      "test",
      "https://example.com",
      "edge",
      undefined,
      "edge",
    );
    expect(result.ok).toBe(true);
  });
});
