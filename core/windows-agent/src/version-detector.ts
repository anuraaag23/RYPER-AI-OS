import type { WindowsSystemApi } from "./windows-system-api.js";
import type { WindowsRelease, WindowsVersionInfo } from "./types.js";

/**
 * Features that only exist, or only work fully, on one supported release.
 * `WindowsAdapter.supports()` consults this before ever claiming a
 * domain/operation is available — the brief's "detect Windows version
 * automatically, gracefully disable unsupported features" made concrete.
 * Anything not listed here is assumed available on both releases.
 */
const WINDOWS_10_UNSUPPORTED_OPERATIONS: ReadonlySet<string> = new Set([
  // Clipboard History (Win+V) shipped in the Windows 10 October 2018 Update; the
  // reference/production implementations both treat it as Windows 11-only for
  // simplicity, matching the "graceful degradation" brief requirement.
  "clipboard.history",
  // Window snap layouts (hover-to-see-layout-flyout) is a Windows 11 shell feature;
  // Windows 10's snap is more limited (still exposed, just via "window_management.snap").
  "window_management.snap_layout_flyout",
]);

export function isSupportedOnRelease(release: WindowsRelease, operationKey: string): boolean {
  if (release === "unsupported") return false;
  if (release === "windows-10") return !WINDOWS_10_UNSUPPORTED_OPERATIONS.has(operationKey);
  return true;
}

export class UnsupportedWindowsReleaseError extends Error {}

/**
 * Wraps `WindowsSystemApi.detectWindowsVersion()` with a small in-process
 * cache (version detection is assumed stable for a process's lifetime)
 * and turns the raw build number into the `WindowsRelease` union the
 * rest of this package reasons about.
 */
export class WindowsVersionDetector {
  private cached: WindowsVersionInfo | undefined;

  constructor(private readonly systemApi: WindowsSystemApi) {}

  async detect(): Promise<WindowsVersionInfo> {
    if (!this.cached) {
      this.cached = await this.systemApi.detectWindowsVersion();
    }
    return this.cached;
  }

  async assertSupported(): Promise<WindowsVersionInfo> {
    const info = await this.detect();
    if (info.release === "unsupported") {
      throw new UnsupportedWindowsReleaseError(
        `Windows build ${info.buildNumber} ("${info.displayName}") is not a supported release — only Windows 10 and Windows 11 are supported`,
      );
    }
    return info;
  }

  /** Synchronous check against the last-detected release; call `detect()` first. */
  supportsOperation(operationKey: string): boolean {
    if (!this.cached) return true; // optimistic until detection has actually run once
    return isSupportedOnRelease(this.cached.release, operationKey);
  }

  /** The last-detected version, synchronously, or `undefined` if `detect()` hasn't run yet. */
  cachedVersion(): WindowsVersionInfo | undefined {
    return this.cached;
  }
}

export function createWindowsVersionDetector(systemApi: WindowsSystemApi): WindowsVersionDetector {
  return new WindowsVersionDetector(systemApi);
}
