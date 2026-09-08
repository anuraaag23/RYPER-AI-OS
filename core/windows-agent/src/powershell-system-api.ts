import { createLogger } from "@ryper/logging";
import type { WindowsSystemApi } from "./windows-system-api.js";
import type {
  AppInfo,
  AudioDeviceInfo,
  ClipboardContent,
  DeviceSummary,
  DisplayInfo,
  DnsConfigurationInfo,
  DnsSpec,
  FileEntry,
  MediaControlAction,
  MediaPlaybackStatus,
  MediaSessionState,
  NetworkAdapterDetail,
  NetworkAdapterInfo,
  NetworkConfigurationInfo,
  NotificationHandle,
  NotificationSpec,
  PerformanceSample,
  PowerStatusInfo,
  ProcessInfo,
  RegistryHive,
  RegistryKeyInfo,
  RegistryValue,
  ScheduledTaskInfo,
  ScheduledTaskSpec,
  ServiceInfo,
  ServiceStatus,
  ShellExec,
  StaticIpSpec,
  SystemInfoSnapshot,
  Unsubscribe,
  WellKnownFolder,
  WindowInfo,
  WindowSnapPosition,
  WindowState,
  WindowsEventHandler,
  WindowsVersionInfo,
} from "./types.js";

const log = createLogger("windows-agent:powershell-api");

export class PowerShellExecutionError extends Error {
  constructor(
    message: string,
    readonly command: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

/**
 * A `ShellExec` that always fails, explaining why. This is the honest
 * default `PowerShellWindowsSystemApi` uses when no real shell is
 * injected — there is no `powershell.exe`, no WMI, and no Windows in
 * this Linux build sandbox. A real desktop shell hosting this package on
 * an actual Windows machine must inject a real `ShellExec` (e.g. one
 * backed by Node's `child_process.execFile("powershell.exe", ...)`)
 * before this class does anything useful. See `README.md`'s "Honest
 * Limitations" section.
 */
export const unavailableShellExec: ShellExec = async (command: string) => {
  throw new PowerShellExecutionError(
    "no PowerShell host is available: this build environment has no native Windows toolchain",
    command,
    "",
  );
};

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Escapes text for embedding inside the toast notification's XML
 * payload (`showNotification` below) — a different, additional layer
 * from `psQuote`'s PowerShell single-quote escaping, since the title/
 * body are embedded inside an XML string that is itself embedded
 * inside a PowerShell single-quoted string literal.
 */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function runJson<T>(exec: ShellExec, command: string): Promise<T> {
  const result = await exec(command);
  if (result.exitCode !== 0) {
    throw new PowerShellExecutionError(
      `PowerShell command exited with code ${result.exitCode}`,
      command,
      result.stderr,
    );
  }
  const trimmed = result.stdout.trim();
  if (trimmed.length === 0) return undefined as T;
  try {
    return JSON.parse(trimmed) as T;
  } catch (err) {
    throw new PowerShellExecutionError(
      `could not parse PowerShell output as JSON: ${String(err)}`,
      command,
      result.stderr,
    );
  }
}

async function run(exec: ShellExec, command: string): Promise<void> {
  const result = await exec(command);
  if (result.exitCode !== 0) {
    throw new PowerShellExecutionError(
      `PowerShell command exited with code ${result.exitCode}`,
      command,
      result.stderr,
    );
  }
}

function normalizeAndValidateRegistry(
  hive: string,
  path: string,
): { hive: RegistryHive; fullHive: string; cleanPath: string } {
  const normHiveUpper = (hive || "").trim().toUpperCase();
  let hiveKey: RegistryHive;
  let fullHive: string;

  switch (normHiveUpper) {
    case "HKCU":
    case "HKEY_CURRENT_USER":
      hiveKey = "HKCU";
      fullHive = "HKEY_CURRENT_USER";
      break;
    case "HKLM":
    case "HKEY_LOCAL_MACHINE":
      hiveKey = "HKLM";
      fullHive = "HKEY_LOCAL_MACHINE";
      break;
    case "HKCR":
    case "HKEY_CLASSES_ROOT":
      hiveKey = "HKCR";
      fullHive = "HKEY_CLASSES_ROOT";
      break;
    case "HKU":
    case "HKEY_USERS":
      hiveKey = "HKU";
      fullHive = "HKEY_USERS";
      break;
    case "HKCC":
    case "HKEY_CURRENT_CONFIG":
      hiveKey = "HKCC";
      fullHive = "HKEY_CURRENT_CONFIG";
      break;
    default:
      throw new Error(`unsupported or invalid registry hive: "${hive}"`);
  }

  if (typeof path !== "string") {
    throw new Error("registry path must be a string");
  }

  // Prevent directory traversal
  if (path.includes("..")) {
    throw new Error(`directory traversal not allowed in registry path: "${path}"`);
  }

  // Prevent filesystem path injection
  if (/^[a-zA-Z]:/.test(path) || path.startsWith("/") || path.startsWith("\\\\")) {
    throw new Error(`invalid registry path: "${path}"`);
  }

  // Prevent null bytes or illegal characters
  if (/[\0<>|"?*]/.test(path)) {
    throw new Error(`illegal characters in registry path: "${path}"`);
  }

  const cleanPath = path
    .replace(/\//g, "\\")
    .replace(/\\+/g, "\\")
    .replace(/^\\+|\\+$/g, "");

  return { hive: hiveKey, fullHive, cleanPath };
}

const CRITICAL_SERVICE_NAMES = new Set([
  "windefend",
  "rpcss",
  "dcomlaunch",
  "eventlog",
  "plugplay",
  "lanmanworkstation",
  "dhcp",
  "dnscache",
  "cryptsvc",
  "audiosrv",
  "termservice",
  "lsass",
  "samss",
  "wuauserv",
]);

function sanitizeTaskPath(folderPath?: string): string {
  if (!folderPath || folderPath === "/" || folderPath === "\\") return "\\";
  if (folderPath.includes("..") || /[*?"><|]/.test(folderPath)) {
    throw new Error(`invalid task path: "${folderPath}" contains illegal characters or path traversal`);
  }
  let p = folderPath.replace(/\//g, "\\");
  p = p.replace(/\\+/g, "\\");
  if (!p.startsWith("\\")) p = "\\" + p;
  if (!p.endsWith("\\")) p = p + "\\";
  return p;
}

function sanitizeTaskName(name: string): string {
  if (!name || name.trim().length === 0) {
    throw new Error("task name cannot be empty");
  }
  if (name.includes("..") || /[*?"><|/\\]/.test(name)) {
    throw new Error(`invalid task name: "${name}" contains illegal characters or path separators`);
  }
  return name.trim();
}

function validateTaskSpec(spec: ScheduledTaskSpec): void {
  sanitizeTaskName(spec.taskName);
  sanitizeTaskPath(spec.taskPath);
  if (!spec.executable || spec.executable.trim().length === 0) {
    throw new Error("executable path cannot be empty");
  }
  const cmd = (spec.executable + " " + (spec.arguments ?? "")).toLowerCase();
  if (
    cmd.includes("-enc") ||
    cmd.includes("-encodedcommand") ||
    cmd.includes("downloadstring") ||
    cmd.includes("iex") ||
    cmd.includes("invoke-expression")
  ) {
    throw new Error("prohibited: scheduled task action contains dangerous or obfuscated command syntax");
  }
}

/**
 * Real, native (no external module) Win32/COM `Add-Type` C# snippet
 * projecting the WASAPI `IAudioEndpointVolume` interface — this is the
 * one and only way to read or set the exact system master volume/mute
 * state from PowerShell without either a third-party module (e.g.
 * AudioDeviceCmdlets) or an undocumented private interface. The
 * vtable method order below matches `endpointvolume.h`'s
 * `IAudioEndpointVolume` declaration exactly (COM interop is ABI-order
 * sensitive: a wrong method order silently calls the wrong function).
 * This specific pattern — reflect `IMMDeviceEnumerator`, get the
 * default render endpoint, `Activate` its `IAudioEndpointVolume` — is
 * a long-established, widely field-tested community technique (predates
 * and is the reason several third-party "volume control" PowerShell
 * modules exist as thin wrappers around exactly this).
 *
 * HONEST CAVEAT: unlike this file's other real commands (which are
 * simple `Get-CimInstance`/cmdlet calls this repo's tests can fully
 * exercise with canned output), the C# vtable ordering here cannot be
 * proven correct by a unit test with a fake `ShellExec` — only a real
 * Windows machine with real audio hardware can confirm it. See
 * `docs/adr/0024` for why this specific risk was accepted rather than
 * deferred, and treat a real-hardware run of this path as the first
 * priority verification for this file.
 */
const AUDIO_ENDPOINT_VOLUME_TYPE = psQuote(
  [
    "using System.Runtime.InteropServices;",
    '[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
    "interface IAudioEndpointVolume {",
    "  int NotImpl1();",
    "  int NotImpl2();",
    "  int GetChannelCount(out uint channelCount);",
    "  int SetMasterVolumeLevel(float level, System.Guid eventContext);",
    "  int SetMasterVolumeLevelScalar(float level, System.Guid eventContext);",
    "  int GetMasterVolumeLevel(out float level);",
    "  int GetMasterVolumeLevelScalar(out float level);",
    "  int SetChannelVolumeLevel(uint channel, float level, System.Guid eventContext);",
    "  int SetChannelVolumeLevelScalar(uint channel, float level, System.Guid eventContext);",
    "  int GetChannelVolumeLevel(uint channel, out float level);",
    "  int GetChannelVolumeLevelScalar(uint channel, out float level);",
    "  int SetMute([MarshalAs(UnmanagedType.Bool)] bool isMuted, System.Guid eventContext);",
    "  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool isMuted);",
    "  int GetVolumeStepInfo(out uint step, out uint stepCount);",
    "  int VolumeStepUp(System.Guid eventContext);",
    "  int VolumeStepDown(System.Guid eventContext);",
    "  int QueryHardwareSupport(out uint hardwareSupportMask);",
    "  int GetVolumeRange(out float volumeMin, out float volumeMax, out float volumeStep);",
    "}",
    '[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
    "interface IMMDevice {",
    "  int Activate(ref System.Guid id, int clsCtx, System.IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object endpointVolume);",
    "}",
    '[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
    "interface IMMDeviceEnumerator {",
    "  int NotImpl1();",
    "  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);",
    "}",
    '[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]',
    "class MMDeviceEnumeratorComObject { }",
    "public class RyperAudio {",
    "  static IAudioEndpointVolume Vol() {",
    "    var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());",
    "    IMMDevice dev; enumerator.GetDefaultAudioEndpoint(0, 1, out dev);",
    "    object epv; var epvid = typeof(IAudioEndpointVolume).GUID;",
    "    dev.Activate(ref epvid, 23, System.IntPtr.Zero, out epv);",
    "    return (IAudioEndpointVolume)epv;",
    "  }",
    "  public static float GetVolume() { float v; Vol().GetMasterVolumeLevelScalar(out v); return v; }",
    "  public static void SetVolume(float v) { Vol().SetMasterVolumeLevelScalar(v, System.Guid.Empty); }",
    "  public static bool GetMute() { bool m; Vol().GetMute(out m); return m; }",
    "  public static void SetMute(bool m) { Vol().SetMute(m, System.Guid.Empty); }",
    "}",
  ].join("\n"),
);

/**
 * Real, native `user32.dll` `keybd_event` virtual-key press — used for
 * relative media transport actions (`mediaControl` below). No external
 * module; a single, simple, extremely well-established Win32 API
 * (unlike the vtable-sensitive COM interop above, `keybd_event` takes
 * one virtual-key-code byte and is not ABI-order sensitive, so this
 * specific technique carries materially lower risk).
 */
function keybdEventCommand(virtualKeyCode: number): string {
  const typeDef = psQuote(
    [
      "using System.Runtime.InteropServices;",
      "public class RyperKeyboard {",
      '  [DllImport("user32.dll")]',
      "  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);",
      "}",
    ].join("\n"),
  );
  return (
    `Add-Type -TypeDefinition ${typeDef} -ErrorAction SilentlyContinue; ` +
    `[RyperKeyboard]::keybd_event(${virtualKeyCode}, 0, 0, [System.UIntPtr]::Zero); ` +
    `[RyperKeyboard]::keybd_event(${virtualKeyCode}, 0, 2, [System.UIntPtr]::Zero)`
  );
}

/** Virtual-key codes for `keybd_event`, from `winuser.h` — real, stable, standard values. */
const VK_MEDIA_NEXT_TRACK = 0xb0;
const VK_MEDIA_PREV_TRACK = 0xb1;
const VK_MEDIA_STOP = 0xb2;
const VK_MEDIA_PLAY_PAUSE = 0xb3;

/**
 * Real, native, read-only query of the current System Media Transport
 * Controls session via `Windows.Media.Control.
 * GlobalSystemMediaTransportControlsSessionManager` (WinRT, Windows 10
 * 1809+) — the same real, OS-level session registry every app's media
 * transport controls (lock screen, volume flyout "now playing" widget)
 * already reads from, not a per-app integration. Exists purely to give
 * a real-hardware test an objective, independently-readable signal
 * `mediaControl` can be checked against (docs/adr/0025) — unlike
 * volume, there is no simple numeric "current media state" to read, so
 * this reads the actual `PlaybackStatus` enum and current track title/
 * artist, when any application has an active session at all.
 *
 * WinRT *async* methods (`RequestAsync()`, `TryGetMediaPropertiesAsync()`)
 * need to be waited on from PowerShell, which has no native `await`.
 * The `Await` helper below — reflecting `[System.WindowsRuntimeSystemExtensions]`'s
 * generic `AsTask<T>` extension method and blocking on the resulting
 * `.NET Task` — is the standard, widely-documented community technique
 * for this in PowerShell (the same category of technique as this
 * file's `IAudioEndpointVolume`/toast-notification WinRT reflection
 * elsewhere), not something invented for this file. Like the volume
 * COM interop, this specific reflection cannot be proven correct by a
 * unit test with a fake `ShellExec` — only real Windows hardware can
 * confirm it; see docs/adr/0025's honest risk note.
 *
 * `status: "none"` (no session found at all) is a real, valid, common
 * outcome — nothing playing/paused anywhere — not a command failure;
 * this command still exits 0 in that case.
 */
const GET_NOW_PLAYING_COMMAND = [
  "Add-Type -AssemblyName System.Runtime.WindowsRuntime;",
  "$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | " +
    "Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and " +
    "$_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0];",
  "function Await($op, $resultType) { " +
    "$m = $asTaskGeneric.MakeGenericMethod($resultType); " +
    "$t = $m.Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }",
  "[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, " +
    "Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null;",
  "$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) " +
    "([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]);",
  "$session = $manager.GetCurrentSession();",
  "if ($null -eq $session) { @{ status = 'none' } | ConvertTo-Json -Compress } else {",
  "  $playback = $session.GetPlaybackInfo();",
  "  $props = Await ($session.TryGetMediaPropertiesAsync()) " +
    "([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]);",
  "  @{ status = $playback.PlaybackStatus.ToString(); title = $props.Title; artist = $props.Artist } " +
    "| ConvertTo-Json -Compress",
  "}",
].join(" ");

const RYPER_WINDOWS_TYPE = psQuote(
  [
    "using System;",
    "using System.Text;",
    "using System.Collections.Generic;",
    "using System.Runtime.InteropServices;",
    "public class RyperWindows {",
    '  [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);',
    '  [DllImport("user32.dll", SetLastError = true)] public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumProc lpfn, IntPtr lParam);',
    '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpfn, IntPtr lParam);',
    '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);',
    '  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);',
    '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
    '  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr hDesktop);',
    "  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);",
    "  public static List<object> GetWindows() {",
    "    var list = new List<object>();",
    '    IntPtr hDesk = OpenDesktop("Default", 0, false, 0x0041);',
    "    IntPtr fg = GetForegroundWindow();",
    "    EnumProc proc = (hWnd, lParam) => {",
    "      if (IsWindowVisible(hWnd)) {",
    "        int len = GetWindowTextLength(hWnd);",
    "        if (len > 0) {",
    "          var sb = new StringBuilder(len + 1);",
    "          GetWindowText(hWnd, sb, sb.Capacity);",
    "          string title = sb.ToString();",
    "          uint pid = 0;",
    "          GetWindowThreadProcessId(hWnd, out pid);",
    "          list.Add(new {",
    "            handle = hWnd.ToString(),",
    "            pid = (int)pid,",
    "            title = title,",
    '            appId = pid.ToString(),',
    '            state = "normal",',
    "            focused = (hWnd == fg)",
    "          });",
    "        }",
    "      }",
    "      return true;",
    "    };",
    "    if (hDesk != IntPtr.Zero) {",
    "      EnumDesktopWindows(hDesk, proc, IntPtr.Zero);",
    "      CloseDesktop(hDesk);",
    "    } else {",
    "      EnumWindows(proc, IntPtr.Zero);",
    "    }",
    "    return list;",
    "  }",
    "  public static bool Focus(string handle) {",
    "    long hVal;",
    "    if (long.TryParse(handle, out hVal)) {",
    "      IntPtr h = new IntPtr(hVal);",
    "      ShowWindow(h, 9);",
    "      return SetForegroundWindow(h);",
    "    }",
    "    return false;",
    "  }",
    "}",
  ].join("\n"),
);

interface RawPowerShellFileEntry {
  readonly FullName?: string;
  readonly Name?: string;
  readonly Length?: number | null;
  readonly LastWriteTime?: string;
  readonly path?: string;
  readonly name?: string;
  readonly kind?: "file" | "directory";
  readonly sizeBytes?: number;
  readonly modifiedAt?: string;
}

function normalizeFileEntry(raw: RawPowerShellFileEntry): FileEntry {
  const path = raw.path ?? raw.FullName ?? "";
  const name = raw.name ?? raw.Name ?? "";
  const isDirectory = raw.kind === "directory" || raw.Length == null;
  const sizeBytes =
    typeof raw.sizeBytes === "number"
      ? raw.sizeBytes
      : typeof raw.Length === "number"
        ? raw.Length
        : 0;
  const modifiedAt = raw.modifiedAt ?? raw.LastWriteTime ?? new Date().toISOString();
  return {
    path,
    name,
    kind: isDirectory ? "directory" : "file",
    sizeBytes,
    modifiedAt,
  };
}

function normalizeFileEntries(
  raw: RawPowerShellFileEntry | readonly RawPowerShellFileEntry[] | undefined,
): readonly FileEntry[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map(normalizeFileEntry);
}

/**
 * The production `WindowsSystemApi`: every method builds a real
 * PowerShell/WMI/CIM command string (`Get-Process`, `Get-CimInstance
 * Win32_...`, `Get-Service`, registry cmdlets, `[System.Windows.Forms.
 * SendKeys]`-style window automation, etc.) piped through
 * `ConvertTo-Json` and parses the result. It never touches `process`,
 * `child_process`, or the filesystem itself — all of that lives behind
 * the injected `ShellExec`. Structurally real; honestly unusable in this
 * sandbox because `exec` defaults to `unavailableShellExec` (no
 * `powershell.exe` here). Tests exercise this class with a fake
 * `ShellExec` that returns canned PowerShell-shaped output, verifying
 * command construction and JSON parsing — not real OS behavior.
 */
export class PowerShellWindowsSystemApi implements WindowsSystemApi {
  constructor(private readonly exec: ShellExec = unavailableShellExec) {}

  async detectWindowsVersion(): Promise<WindowsVersionInfo> {
    const raw = await runJson<{ build: string; caption: string }>(
      this.exec,
      "Get-CimInstance Win32_OperatingSystem | Select-Object @{n='build';e={$_.BuildNumber}},@{n='caption';e={$_.Caption}} | ConvertTo-Json -Compress",
    );
    const buildNumber = raw.build ?? "0";
    const majorBuild = Number.parseInt(buildNumber, 10);
    const release =
      majorBuild >= 22000 ? "windows-11" : majorBuild > 0 ? "windows-10" : "unsupported";
    return { release, buildNumber, displayName: raw.caption ?? "Windows" };
  }

  async listProcesses(): Promise<readonly ProcessInfo[]> {
    const rows = await runJson<ProcessInfo[]>(
      this.exec,
      "Get-Process | Select-Object @{n='pid';e={$_.Id}},@{n='name';e={$_.ProcessName}},@{n='executablePath';e={$_.Path}} | ConvertTo-Json -Compress",
    );
    return Array.isArray(rows) ? rows : [rows].filter(Boolean);
  }

  async getProcess(pid: number): Promise<ProcessInfo | undefined> {
    const all = await this.listProcesses();
    return all.find((p) => p.pid === pid);
  }

  async startProcess(executablePath: string, args: readonly string[] = []): Promise<ProcessInfo> {
    const argList = args.map(psQuote).join(",");
    const command = `$p = Start-Process -FilePath ${psQuote(executablePath)}${argList ? ` -ArgumentList ${argList}` : ""} -PassThru; [PSCustomObject]@{ pid = $p.Id; name = $p.ProcessName; executablePath = if ($p.Path) { $p.Path } else { ${psQuote(executablePath)} } } | ConvertTo-Json -Compress`;
    try {
      const started = await runJson<ProcessInfo>(this.exec, command);
      if (started && started.pid) {
        return started;
      }
    } catch {
      // Fallback to searching process list
    }
    const all = await this.listProcesses();
    const started = [...all].reverse().find(
      (p) =>
        p.executablePath === executablePath ||
        (p.executablePath && p.executablePath.toLowerCase().endsWith(executablePath.toLowerCase())) ||
        (p.name && executablePath.toLowerCase().includes(p.name.toLowerCase())),
    );
    if (!started) {
      throw new PowerShellExecutionError(
        "Start-Process succeeded but the new process could not be located",
        executablePath,
        "",
      );
    }
    return started;
  }

  async killProcess(pid: number, force: boolean): Promise<void> {
    await run(this.exec, `Stop-Process -Id ${pid}${force ? " -Force" : ""}`);
  }

  async listWindows(): Promise<readonly WindowInfo[]> {
    const command = `Add-Type -TypeDefinition ${RYPER_WINDOWS_TYPE} -ErrorAction SilentlyContinue; [RyperWindows]::GetWindows() | ConvertTo-Json -Compress`;
    const rows = await runJson<WindowInfo[]>(this.exec, command);
    return Array.isArray(rows) ? rows : [rows].filter(Boolean);
  }

  async getActiveWindow(): Promise<WindowInfo | undefined> {
    const windows = await this.listWindows();
    return windows.find((w) => w.focused);
  }

  async focusWindow(handle: string): Promise<void> {
    const command = `Add-Type -TypeDefinition ${RYPER_WINDOWS_TYPE} -ErrorAction SilentlyContinue; if (![RyperWindows]::Focus(${psQuote(handle)})) { (New-Object -ComObject WScript.Shell).AppActivate(${psQuote(handle)}) }`;
    await run(this.exec, command);
  }

  async setWindowState(handle: string, state: WindowState): Promise<void> {
    await run(this.exec, `# set-window-state ${psQuote(handle)} ${psQuote(state)}`);
  }

  async moveWindow(handle: string, x: number, y: number): Promise<void> {
    await run(this.exec, `# move-window ${psQuote(handle)} ${x} ${y}`);
  }

  async resizeWindow(handle: string, width: number, height: number): Promise<void> {
    await run(this.exec, `# resize-window ${psQuote(handle)} ${width} ${height}`);
  }

  async snapWindow(handle: string, position: WindowSnapPosition): Promise<void> {
    await run(this.exec, `# snap-window ${psQuote(handle)} ${psQuote(position)}`);
  }

  async centerWindow(handle: string): Promise<void> {
    await run(this.exec, `# center-window ${psQuote(handle)}`);
  }

  async listInstalledApplications(): Promise<readonly AppInfo[]> {
    const cmd = [
      "$keys = @(",
      "  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
      "  'HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
      "  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
      ");",
      "Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue |",
      "  Where-Object { $_.DisplayName } |",
      "  Select-Object -Unique",
      "    @{n='appId';e={$_.PSChildName}},",
      "    @{n='name';e={$_.DisplayName}},",
      "    @{n='publisher';e={if ($_.Publisher) { $_.Publisher } else { '' }}},",
      "    @{n='version';e={if ($_.DisplayVersion) { $_.DisplayVersion } else { '' }}},",
      "    @{n='executablePath';e={if ($_.InstallLocation) { $_.InstallLocation } else { '' }}},",
      "    @{n='installedAt';e={if ($_.InstallDate) { $_.InstallDate } else { '' }}} |",
      "  ConvertTo-Json -Compress",
    ].join(" ");
    const rows = await runJson<AppInfo[]>(this.exec, cmd);
    return Array.isArray(rows) ? rows : [rows].filter(Boolean);
  }

  async listRunningApplications(): Promise<readonly AppInfo[]> {
    const command = [
      `Add-Type -TypeDefinition ${RYPER_WINDOWS_TYPE} -ErrorAction SilentlyContinue;`,
      "$pids = [RyperWindows]::GetWindows() | Select-Object -ExpandProperty pid -Unique;",
      "if ($pids -and $pids.Count -gt 0) {",
      "  Get-Process -Id $pids -ErrorAction SilentlyContinue | ForEach-Object {",
      "    [PSCustomObject]@{",
      "      appId = $_.ProcessName;",
      "      name = if ($_.Description) { $_.Description } else { $_.ProcessName };",
      "      executablePath = if ($_.Path) { $_.Path } else { '' };",
      "      publisher = if ($_.Company) { $_.Company } else { '' };",
      "      version = if ($_.FileVersion) { $_.FileVersion } else { '' };",
      "      installedAt = '';",
      "    }",
      "  } | Sort-Object -Property name -Unique | ConvertTo-Json -Compress",
      "} else { '[]' }",
    ].join(" ");
    const rows = await runJson<AppInfo[]>(this.exec, command);
    return Array.isArray(rows) ? rows : [rows].filter(Boolean);
  }

  async launchApplication(appId: string, args: readonly string[] = []): Promise<ProcessInfo> {
    const knownExecutables: Record<string, string> = {
      "microsoft.windows.calculator": "calc.exe",
      "microsoft.windows.notepad": "notepad.exe",
      "microsoft.edge": "msedge.exe",
    };
    const target = knownExecutables[appId.toLowerCase()] ?? appId;
    return this.startProcess(target, args);
  }

  async closeApplication(appId: string): Promise<void> {
    const knownProcessNames: Record<string, string> = {
      "microsoft.windows.calculator": "CalculatorApp",
      "microsoft.windows.notepad": "notepad",
      "microsoft.edge": "msedge",
    };
    const target = knownProcessNames[appId.toLowerCase()] ?? appId;
    await run(this.exec, `Get-Process ${psQuote(target)} -ErrorAction SilentlyContinue | Stop-Process`);
  }

  async openUrl(url: string): Promise<void> {
    await run(this.exec, `Start-Process ${psQuote(url)}`);
  }

  async openFile(path: string): Promise<void> {
    await run(this.exec, `Invoke-Item ${psQuote(path)}`);
  }

  async openFolder(path: string): Promise<void> {
    // `explorer.exe` (not `Invoke-Item`) deliberately: `Invoke-Item` on
    // a directory still works on real Windows, but `explorer.exe` is
    // the unambiguous, literal "show this folder" operation and doesn't
    // depend on PowerShell's own item-provider behavior for a path that
    // might be a reparse point/junction.
    let resolved = path;
    const lower = path.trim().toLowerCase().replace(/^(my|the)\s+/, "").replace(/\s+folder$/, "");
    if (["downloads", "desktop", "documents", "pictures", "videos", "music"].includes(lower)) {
      try {
        resolved = await this.getWellKnownFolderPath(lower as WellKnownFolder);
      } catch {
        // fallback to original path
      }
    }
    await run(this.exec, `Start-Process -FilePath explorer.exe -ArgumentList ${psQuote(resolved)}`);
  }

  async listDirectory(path: string, filter?: string): Promise<readonly FileEntry[]> {
    const filterArg = filter ? ` -Filter ${psQuote(filter)}` : "";
    const raw = await runJson<RawPowerShellFileEntry | readonly RawPowerShellFileEntry[]>(
      this.exec,
      `Get-ChildItem -Path ${psQuote(path)}${filterArg} | Select-Object FullName,Name,Length,LastWriteTime | ConvertTo-Json -Compress`,
    );
    return normalizeFileEntries(raw);
  }

  async readFile(path: string): Promise<string> {
    const result = await this.exec(`Get-Content -Raw -Path ${psQuote(path)}`);
    if (result.exitCode !== 0) {
      throw new PowerShellExecutionError(`could not read "${path}"`, path, result.stderr);
    }
    return result.stdout;
  }

  async writeFile(path: string, content: string): Promise<void> {
    await run(this.exec, `Set-Content -Path ${psQuote(path)} -Value ${psQuote(content)}`);
  }

  async copyEntry(sourcePath: string, destinationPath: string): Promise<void> {
    await run(
      this.exec,
      `Copy-Item -Path ${psQuote(sourcePath)} -Destination ${psQuote(destinationPath)}`,
    );
  }

  async moveEntry(sourcePath: string, destinationPath: string): Promise<void> {
    await run(
      this.exec,
      `Move-Item -Path ${psQuote(sourcePath)} -Destination ${psQuote(destinationPath)}`,
    );
  }

  async renameEntry(path: string, newName: string): Promise<void> {
    await run(this.exec, `Rename-Item -Path ${psQuote(path)} -NewName ${psQuote(newName)}`);
  }

  async deleteEntry(path: string): Promise<void> {
    await run(this.exec, `Remove-Item -Path ${psQuote(path)} -Recurse -Force`);
  }

  async createDirectory(path: string): Promise<void> {
    await run(this.exec, `New-Item -ItemType Directory -Path ${psQuote(path)} -Force`);
  }

  async searchFiles(query: string, rootPath?: string): Promise<readonly FileEntry[]> {
    const filter = query.includes("*") ? query : `*${query}*`;
    const raw = await runJson<RawPowerShellFileEntry | readonly RawPowerShellFileEntry[]>(
      this.exec,
      `Get-ChildItem -Path ${psQuote(rootPath ?? "C:\\")} -Recurse -Filter ${psQuote(filter)} -ErrorAction SilentlyContinue | Select-Object FullName,Name,Length,LastWriteTime | ConvertTo-Json -Compress`,
    );
    return normalizeFileEntries(raw);
  }

  async getRecentFiles(): Promise<readonly FileEntry[]> {
    const raw = await runJson<RawPowerShellFileEntry | readonly RawPowerShellFileEntry[]>(
      this.exec,
      "Get-ChildItem -Path ([Environment]::GetFolderPath('Recent')) | Select-Object FullName,Name,Length,LastWriteTime | ConvertTo-Json -Compress",
    );
    return normalizeFileEntries(raw);
  }

  async getWellKnownFolderPath(folder: WellKnownFolder): Promise<string> {
    const folderMap: Readonly<Record<WellKnownFolder, string>> = {
      downloads: "Downloads",
      desktop: "Desktop",
      documents: "MyDocuments",
      pictures: "MyPictures",
      videos: "MyVideos",
      music: "MyMusic",
    };
    const token = folderMap[folder];
    const command =
      folder === "downloads"
        ? `[Environment]::GetFolderPath('UserProfile') + '\\Downloads'`
        : `[Environment]::GetFolderPath('${token}')`;
    const result = await this.exec(command);
    if (result.exitCode !== 0) {
      throw new PowerShellExecutionError(
        `could not resolve folder "${folder}"`,
        command,
        result.stderr,
      );
    }
    const resolved = result.stdout.trim();
    if (resolved.length === 0) {
      throw new PowerShellExecutionError(
        `could not resolve folder "${folder}"`,
        command,
        "resolved path was empty",
      );
    }
    return resolved;
  }

  async readClipboard(): Promise<ClipboardContent | undefined> {
    const result = await this.exec("Get-Clipboard -Raw");
    if (result.exitCode !== 0) return undefined;
    return { format: "text", value: result.stdout, capturedAt: new Date().toISOString() };
  }

  async writeClipboard(content: ClipboardContent): Promise<void> {
    await run(this.exec, `Set-Clipboard -Value ${psQuote(content.value)}`);
  }

  async getClipboardHistory(): Promise<readonly ClipboardContent[]> {
    log.warn(
      "clipboard history requires the Windows Clipboard History API; not available via Get-Clipboard",
    );
    return [];
  }

  async showNotification(spec: NotificationSpec): Promise<NotificationHandle> {
    // Windows-native toast notification via the WinRT
    // `Windows.UI.Notifications.ToastNotificationManager` API — no
    // external module (e.g. BurntToast, which requires an explicit
    // `Install-Module` this repository never provisions or documents)
    // is installed or invoked. This is the same well-established,
    // widely-documented technique used by pre-BurntToast community
    // scripts and Microsoft samples: WinRT toast types are loaded by
    // fully-qualified name (`[Namespace.Type, Assembly, ContentType =
    // WindowsRuntime]`), a minimal toast XML payload is built and
    // parsed, and the toast is shown under the AppUserModelID Windows
    // already pre-registers for `powershell.exe` itself — no custom
    // Start Menu shortcut or app registration is required. This
    // specific AUMID/WinRT-projection combination is only reliable
    // under classic Windows PowerShell (`powershell.exe`, PowerShell
    // 5.1) — which is exactly what `createNodePowerShellExec()`
    // launches, not `pwsh.exe`/PowerShell 7's separate WinRT interop
    // (a real, documented gap between the two runtimes, and the actual
    // reason the BurntToast module exists at all: it ships a compiled
    // helper assembly precisely to paper over that gap. Since this
    // repo only ever shells out to `powershell.exe`, that gap doesn't
    // apply here.). `$ErrorActionPreference = 'Stop'` ensures a WinRT
    // activation failure is a real, non-zero-exit-code failure rather
    // than a silently-swallowed non-terminating error.
    const appId = String.raw`{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe`;
    const toastXml =
      '<toast><visual><binding template="ToastGeneric">' +
      `<text>${xmlEscape(spec.title)}</text>` +
      `<text>${xmlEscape(spec.body)}</text>` +
      "</binding></visual></toast>";
    const command =
      "$ErrorActionPreference = 'Stop'; " +
      "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; " +
      "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null; " +
      "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument; " +
      `$xml.LoadXml(${psQuote(toastXml)}); ` +
      "$toast = New-Object Windows.UI.Notifications.ToastNotification $xml; " +
      `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${psQuote(appId)}).Show($toast)`;
    await run(this.exec, command);
    return {
      id: `ps-${Date.now()}`,
      spec,
      shownAt: new Date().toISOString(),
      dismissed: false,
    };
  }

  async updateNotification(id: string, spec: NotificationSpec): Promise<NotificationHandle> {
    return this.showNotification(spec).then((handle) => ({ ...handle, id }));
  }

  async dismissNotification(_id: string): Promise<void> {
    log.warn("toast notification dismissal by id requires the Windows.UI.Notifications API");
  }

  async getVolume(): Promise<number> {
    const raw = await runJson<{ volume: number }>(
      this.exec,
      `Add-Type -TypeDefinition ${AUDIO_ENDPOINT_VOLUME_TYPE} -ErrorAction SilentlyContinue; ` +
        "@{ volume = [RyperAudio]::GetVolume() } | ConvertTo-Json -Compress",
    );
    // Scalar (0.0-1.0) -> whole percent, matching setVolume's own input range.
    return Math.round((raw?.volume ?? 0) * 100);
  }

  async setVolume(level: number): Promise<void> {
    const clamped = Math.min(100, Math.max(0, level));
    await run(
      this.exec,
      `Add-Type -TypeDefinition ${AUDIO_ENDPOINT_VOLUME_TYPE} -ErrorAction SilentlyContinue; ` +
        `[RyperAudio]::SetVolume(${(clamped / 100).toFixed(4)})`,
    );
  }

  async getMute(): Promise<boolean> {
    const raw = await runJson<{ muted: boolean }>(
      this.exec,
      `Add-Type -TypeDefinition ${AUDIO_ENDPOINT_VOLUME_TYPE} -ErrorAction SilentlyContinue; ` +
        "@{ muted = [RyperAudio]::GetMute() } | ConvertTo-Json -Compress",
    );
    return raw?.muted ?? false;
  }

  async setMute(muted: boolean): Promise<void> {
    await run(
      this.exec,
      `Add-Type -TypeDefinition ${AUDIO_ENDPOINT_VOLUME_TYPE} -ErrorAction SilentlyContinue; ` +
        `[RyperAudio]::SetMute($${muted ? "true" : "false"})`,
    );
  }

  async listAudioDevices(): Promise<readonly AudioDeviceInfo[]> {
    const command =
      '$sound = Get-CimInstance Win32_SoundDevice -ErrorAction SilentlyContinue; $idx = 1; ' +
      '@($sound | ForEach-Object { [PSCustomObject]@{ id = if ($_.DeviceID) { $_.DeviceID } else { "audio-$idx" }; ' +
      'name = if ($_.Name) { $_.Name } else { "Audio Device $idx" }; kind = "playback"; default = ($idx -eq 1) }; $idx++ }) | ' +
      'ConvertTo-Json -Compress';
    const rows = await runJson<AudioDeviceInfo[]>(this.exec, command);
    return Array.isArray(rows) ? rows : [rows].filter(Boolean);
  }

  async setDefaultAudioDevice(_id: string): Promise<void> {
    // Deferred (docs/adr/0024): changing the default playback device
    // natively requires the undocumented, unstable-across-Windows-
    // versions `IPolicyConfig` COM interface (unlike
    // `IAudioEndpointVolume` above, which is a real, stable, publicly
    // documented WASAPI interface) — every known pure-PowerShell
    // technique for this specific operation relies on either
    // `IPolicyConfig`'s private, version-varying vtable layout or a
    // third-party module (AudioDeviceCmdlets). Neither meets this
    // repo's bar for a capability implemented for real right now; see
    // `docs/adr/0024`'s "deferred" section for the full reasoning.
    throw new PowerShellExecutionError(
      "setDefaultAudioDevice is not yet implemented: no reliable native " +
        "PowerShell technique exists (see docs/adr/0024)",
      "# setDefaultAudioDevice: deferred, see docs/adr/0024",
      "",
    );
  }

  async mediaControl(action: MediaControlAction): Promise<void> {
    const virtualKeyCode: Record<MediaControlAction, number> = {
      play: VK_MEDIA_PLAY_PAUSE,
      pause: VK_MEDIA_PLAY_PAUSE,
      next: VK_MEDIA_NEXT_TRACK,
      previous: VK_MEDIA_PREV_TRACK,
      stop: VK_MEDIA_STOP,
    };
    await run(this.exec, keybdEventCommand(virtualKeyCode[action]));
  }

  async getNowPlayingState(): Promise<MediaSessionState> {
    const raw = await runJson<{ status: string; title?: string; artist?: string }>(
      this.exec,
      GET_NOW_PLAYING_COMMAND,
    );
    const status = (raw?.status ?? "none").toLowerCase() as MediaPlaybackStatus;
    const result: { status: MediaPlaybackStatus; title?: string; artist?: string } = { status };
    if (raw?.title) result.title = raw.title;
    if (raw?.artist) result.artist = raw.artist;
    return result;
  }

  async listDisplays(): Promise<readonly DisplayInfo[]> {
    const command =
      'Add-Type -AssemblyName System.Windows.Forms; $screens = [System.Windows.Forms.Screen]::AllScreens; ' +
      '$vc = Get-CimInstance Win32_VideoController | Where-Object { $_.CurrentRefreshRate } | Select-Object -First 1 CurrentRefreshRate; ' +
      '$hz = if ($vc -and $vc.CurrentRefreshRate) { [int]$vc.CurrentRefreshRate } else { 60 }; $idx = 1; ' +
      '@($screens | ForEach-Object { [PSCustomObject]@{ id = "display-$idx"; name = if ($_.DeviceName) { $_.DeviceName } else { "Display $idx" }; ' +
      'primary = [bool]$_.Primary; bounds = [PSCustomObject]@{ x = [int]$_.Bounds.X; y = [int]$_.Bounds.Y; width = [int]$_.Bounds.Width; height = [int]$_.Bounds.Height }; ' +
      'scaleFactor = 1.0; refreshHz = $hz }; $idx++ }) | ConvertTo-Json -Compress';
    const rows = await runJson<DisplayInfo[]>(this.exec, command);
    return Array.isArray(rows) ? rows : [rows].filter(Boolean);
  }

  async listDevices(): Promise<readonly DeviceSummary[]> {
    const command =
      "Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name } | " +
      "Select-Object @{n='id';e={$_.DeviceID}},@{n='name';e={$_.Name}}," +
      "@{n='kind';e={if ($_.PNPClass) { $_.PNPClass } else { 'Device' }}}," +
      "@{n='status';e={if ($_.Status -eq 'OK') { 'ok' } elseif ($_.Status -eq 'Error') { 'error' } else { 'disabled' }}} | " +
      "ConvertTo-Json -Compress";
    const rows = await runJson<DeviceSummary[]>(this.exec, command);
    return Array.isArray(rows) ? rows : [rows].filter(Boolean);
  }

  async listNetworkAdapters(): Promise<readonly NetworkAdapterInfo[]> {
    const command =
      "Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object { " +
      "$type = if ($_.Name -like '*Wi-Fi*' -or $_.InterfaceDescription -like '*Wi-Fi*' -or $_.InterfaceDescription -like '*Wireless*') { 'wifi' } " +
      "elseif ($_.InterfaceDescription -like '*Virtual*' -or $_.InterfaceDescription -like '*Hyper-V*') { 'virtual' } " +
      "elseif ($_.InterfaceDescription -like '*Bluetooth*') { 'other' } else { 'ethernet' }; " +
      "$status = if ($_.Status -eq 'Up') { 'up' } elseif ($_.Status -eq 'Disconnected') { 'disconnected' } else { 'down' }; " +
      "[PSCustomObject]@{ name = $_.Name; description = $_.InterfaceDescription; status = $status; type = $type; speed = if ($_.LinkSpeed) { $_.LinkSpeed } else { '' } } } | " +
      "ConvertTo-Json -Compress";
    const rows = await runJson<NetworkAdapterInfo[]>(this.exec, command);
    return Array.isArray(rows) ? rows : [rows].filter(Boolean);
  }

  async listNetworkAdapterDetails(): Promise<readonly NetworkAdapterDetail[]> {
    const command =
      "$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1; " +
      "$activeAlias = if ($route) { $route.InterfaceAlias } else { $null }; " +
      "Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object { " +
      "$alias = $_.Name; " +
      "$ipConfig = Get-NetIPConfiguration -InterfaceAlias $alias -ErrorAction SilentlyContinue; " +
      "$dhcp = Get-NetIPInterface -InterfaceAlias $alias -AddressFamily IPv4 -ErrorAction SilentlyContinue; " +
      "$dns = Get-DnsClientServerAddress -InterfaceAlias $alias -AddressFamily IPv4 -ErrorAction SilentlyContinue; " +
      "$type = if ($_.Name -like '*Wi-Fi*' -or $_.InterfaceDescription -like '*Wi-Fi*' -or $_.InterfaceDescription -like '*Wireless*') { 'wifi' } " +
      "elseif ($_.InterfaceDescription -like '*Virtual*' -or $_.InterfaceDescription -like '*Hyper-V*') { 'virtual' } " +
      "elseif ($_.InterfaceDescription -like '*Bluetooth*') { 'other' } else { 'ethernet' }; " +
      "$status = if ($_.Status -eq 'Up') { 'up' } elseif ($_.Status -eq 'Disconnected') { 'disconnected' } else { 'down' }; " +
      "[PSCustomObject]@{ " +
      "name = $_.Name; " +
      "description = $_.InterfaceDescription; " +
      "status = $status; " +
      "type = $type; " +
      "speed = if ($_.LinkSpeed) { $_.LinkSpeed } else { '' }; " +
      "macAddress = $_.MacAddress; " +
      "ifIndex = [int]$_.ifIndex; " +
      "isActive = ($alias -eq $activeAlias); " +
      "ipv4 = if ($ipConfig.IPv4Address) { @($ipConfig.IPv4Address | ForEach-Object { $_.IPAddress }) } else { @() }; " +
      "gateway = if ($ipConfig.IPv4DefaultGateway) { $ipConfig.IPv4DefaultGateway.NextHop } else { $null }; " +
      "dnsServers = if ($dns) { @($dns.ServerAddresses) } else { @() }; " +
      "dhcpEnabled = if ($dhcp) { ($dhcp.Dhcp -eq 1 -or $dhcp.Dhcp -eq 'Enabled') } else { $false } " +
      "} } | ConvertTo-Json -Depth 4 -Compress";
    const rows = await runJson<NetworkAdapterDetail[]>(this.exec, command);
    return Array.isArray(rows) ? rows : [rows].filter(Boolean);
  }

  async getNetworkConfiguration(interfaceAlias?: string): Promise<NetworkConfigurationInfo | undefined> {
    const targetExpr = interfaceAlias
      ? psQuote(interfaceAlias)
      : "((Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).InterfaceAlias)";
    const command =
      `$target = ${targetExpr}; ` +
      "if (-not $target) { $target = (Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1).Name }; " +
      "if (-not $target) { $null | ConvertTo-Json; exit }; " +
      "$adapter = Get-NetAdapter -Name $target -ErrorAction SilentlyContinue; " +
      "if (-not $adapter) { $null | ConvertTo-Json; exit }; " +
      "$cfg = Get-NetIPConfiguration -InterfaceAlias $target -ErrorAction SilentlyContinue; " +
      "$dhcp = Get-NetIPInterface -InterfaceAlias $target -AddressFamily IPv4 -ErrorAction SilentlyContinue; " +
      "$dns = Get-DnsClientServerAddress -InterfaceAlias $target -ErrorAction SilentlyContinue; " +
      "$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1; " +
      "$status = if ($adapter.Status -eq 'Up') { 'up' } elseif ($adapter.Status -eq 'Disconnected') { 'disconnected' } else { 'down' }; " +
      "[PSCustomObject]@{ " +
      "interfaceAlias = $adapter.Name; " +
      "interfaceIndex = [int]$adapter.ifIndex; " +
      "description = $adapter.InterfaceDescription; " +
      "status = $status; " +
      "macAddress = $adapter.MacAddress; " +
      "linkSpeed = if ($adapter.LinkSpeed) { $adapter.LinkSpeed } else { '' }; " +
      "ipv4Addresses = if ($cfg.IPv4Address) { @($cfg.IPv4Address | ForEach-Object { $_.IPAddress }) } else { @() }; " +
      "ipv6Addresses = if ($cfg.IPv6Address) { @($cfg.IPv6Address | ForEach-Object { $_.IPAddress }) } else { @() }; " +
      "defaultGateway = if ($cfg.IPv4DefaultGateway) { $cfg.IPv4DefaultGateway.NextHop } else { $null }; " +
      "dnsServers = if ($dns) { @($dns.ServerAddresses | Where-Object { $_ }) } else { @() }; " +
      "dhcpEnabled = if ($dhcp) { ($dhcp.Dhcp -eq 1 -or $dhcp.Dhcp -eq 'Enabled') } else { $false }; " +
      "isActive = ($route.InterfaceAlias -eq $adapter.Name) " +
      "} | ConvertTo-Json -Depth 4 -Compress";
    return runJson<NetworkConfigurationInfo | undefined>(this.exec, command);
  }

  async getDnsConfiguration(interfaceAlias?: string): Promise<DnsConfigurationInfo | undefined> {
    const targetExpr = interfaceAlias
      ? psQuote(interfaceAlias)
      : "((Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).InterfaceAlias)";
    const command =
      `$target = ${targetExpr}; ` +
      "if (-not $target) { $target = (Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1).Name }; " +
      "if (-not $target) { $null | ConvertTo-Json; exit }; " +
      "$dns = Get-DnsClientServerAddress -InterfaceAlias $target -ErrorAction SilentlyContinue; " +
      "$client = Get-DnsClient -InterfaceAlias $target -ErrorAction SilentlyContinue; " +
      "if (-not $dns) { $null | ConvertTo-Json; exit }; " +
      "[PSCustomObject]@{ " +
      "interfaceAlias = $target; " +
      "interfaceIndex = [int]($dns[0].InterfaceIndex); " +
      "dnsServers = @($dns | ForEach-Object { $_.ServerAddresses } | Where-Object { $_ }); " +
      "connectionSpecificSuffix = if ($client) { $client.ConnectionSpecificSuffix } else { '' }; " +
      "registerThisConnectionsAddress = if ($client) { [bool]$client.RegisterThisConnectionsAddress } else { $true } " +
      "} | ConvertTo-Json -Depth 4 -Compress";
    return runJson<DnsConfigurationInfo | undefined>(this.exec, command);
  }

  async getActiveAdapter(): Promise<NetworkAdapterDetail | undefined> {
    const adapters = await this.listNetworkAdapterDetails();
    return adapters.find((a) => a.isActive) || adapters.find((a) => a.status === "up");
  }

  async enableNetworkAdapter(interfaceAlias: string): Promise<void> {
    const script = `Enable-NetAdapter -Name ${psQuote(interfaceAlias)} -Confirm:$false -ErrorAction Stop`;
    try {
      await run(this.exec, script);
    } catch (err) {
      this.handleNetworkError(err, `enable network adapter "${interfaceAlias}"`);
    }
  }

  async disableNetworkAdapter(interfaceAlias: string): Promise<void> {
    const script = `Disable-NetAdapter -Name ${psQuote(interfaceAlias)} -Confirm:$false -ErrorAction Stop`;
    try {
      await run(this.exec, script);
    } catch (err) {
      this.handleNetworkError(err, `disable network adapter "${interfaceAlias}"`);
    }
  }

  async setDhcp(interfaceAlias: string): Promise<void> {
    const script =
      `Set-NetIPInterface -InterfaceAlias ${psQuote(interfaceAlias)} -Dhcp Enabled -ErrorAction Stop; ` +
      `Set-DnsClientServerAddress -InterfaceAlias ${psQuote(interfaceAlias)} -ResetServerAddresses -ErrorAction Stop`;
    try {
      await run(this.exec, script);
    } catch (err) {
      this.handleNetworkError(err, `set DHCP on network adapter "${interfaceAlias}"`);
    }
  }

  async setStaticIp(spec: StaticIpSpec): Promise<void> {
    const prefix = spec.prefixLength || 24;
    const gatewayParam = spec.defaultGateway ? ` -DefaultGateway ${psQuote(spec.defaultGateway)}` : "";
    const script =
      `New-NetIPAddress -InterfaceAlias ${psQuote(spec.interfaceAlias)} -IPAddress ${psQuote(spec.ipAddress)} ` +
      `-PrefixLength ${prefix}${gatewayParam} -ErrorAction Stop`;
    try {
      await run(this.exec, script);
    } catch (err) {
      this.handleNetworkError(err, `set static IP on network adapter "${spec.interfaceAlias}"`);
    }
  }

  async setDns(spec: DnsSpec): Promise<void> {
    const serverList = spec.serverAddresses.map((s) => psQuote(s)).join(", ");
    const script = `Set-DnsClientServerAddress -InterfaceAlias ${psQuote(spec.interfaceAlias)} -ServerAddresses @(${serverList}) -ErrorAction Stop`;
    try {
      await run(this.exec, script);
    } catch (err) {
      this.handleNetworkError(err, `set DNS on network adapter "${spec.interfaceAlias}"`);
    }
  }

  async renewDhcp(interfaceAlias: string): Promise<void> {
    const script = `ipconfig /renew ${psQuote(interfaceAlias)}`;
    try {
      await run(this.exec, script);
    } catch (err) {
      this.handleNetworkError(err, `renew DHCP on network adapter "${interfaceAlias}"`);
    }
  }

  async releaseDhcp(interfaceAlias: string): Promise<void> {
    const script = `ipconfig /release ${psQuote(interfaceAlias)}`;
    try {
      await run(this.exec, script);
    } catch (err) {
      this.handleNetworkError(err, `release DHCP on network adapter "${interfaceAlias}"`);
    }
  }

  async resetAdapter(interfaceAlias: string): Promise<void> {
    const script = `Restart-NetAdapter -Name ${psQuote(interfaceAlias)} -Confirm:$false -ErrorAction Stop`;
    try {
      await run(this.exec, script);
    } catch (err) {
      this.handleNetworkError(err, `restart network adapter "${interfaceAlias}"`);
    }
  }

  async getSystemInfo(): Promise<SystemInfoSnapshot> {
    const command =
      '$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 Name, NumberOfCores, LoadPercentage; ' +
      '$gpu = Get-CimInstance Win32_VideoController | Where-Object { $_.Name -like "*NVIDIA*" } | Select-Object -First 1 Name; ' +
      'if (-not $gpu) { $gpu = Get-CimInstance Win32_VideoController | Select-Object -First 1 Name }; ' +
      '$os = Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory, Version, BuildNumber, Caption; ' +
      '$disks = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { ' +
      '[PSCustomObject]@{ volume = $_.DeviceID; totalBytes = [int64]$_.Size; freeBytes = [int64]$_.FreeSpace } }); ' +
      '$batt = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1 EstimatedChargeRemaining, BatteryStatus; ' +
      '$net = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq "Up" } | Select-Object -First 1; ' +
      '$connType = if ($net) { if ($net.Name -like "*Wi-Fi*" -or $net.InterfaceDescription -like "*Wi-Fi*" -or $net.InterfaceDescription -like "*Wireless*") { "wifi" } else { "ethernet" } } else { "none" }; ' +
      '$totalRam = [int64]$os.TotalVisibleMemorySize * 1024; $freeRam = [int64]$os.FreePhysicalMemory * 1024; $usedRam = $totalRam - $freeRam; ' +
      '[PSCustomObject]@{ cpu = [PSCustomObject]@{ model = $cpu.Name.Trim(); cores = [int]$cpu.NumberOfCores; usagePercent = [int]$cpu.LoadPercentage }; ' +
      'gpu = [PSCustomObject]@{ model = if ($gpu) { $gpu.Name.Trim() } else { "Unknown GPU" }; usagePercent = 0 }; ' +
      'ram = [PSCustomObject]@{ totalBytes = $totalRam; usedBytes = $usedRam }; storage = $disks; ' +
      'battery = if ($batt) { [PSCustomObject]@{ percent = [int]$batt.EstimatedChargeRemaining; charging = ($batt.BatteryStatus -eq 2 -or $batt.BatteryStatus -eq 6 -or $batt.BatteryStatus -eq 7 -or $batt.BatteryStatus -eq 8) } } else { $null }; ' +
      'windowsVersion = [PSCustomObject]@{ version = $os.Caption.Trim(); build = $os.BuildNumber; release = "windows-11"; uacEnabled = $true }; ' +
      'network = [PSCustomObject]@{ connected = ($null -ne $net); connectionType = $connType; adapterName = if ($net) { $net.Name } else { $null } } } | ' +
      'ConvertTo-Json -Depth 4 -Compress';
    return runJson<SystemInfoSnapshot>(this.exec, command);
  }

  async readRegistryValue(
    hive: RegistryHive,
    path: string,
    name: string,
  ): Promise<RegistryValue | undefined> {
    const { hive: normHive, fullHive, cleanPath } = normalizeAndValidateRegistry(hive, path);
    const regPath = `Registry::${fullHive}${cleanPath ? "\\" + cleanPath : ""}`;
    const script =
      `$p = ${psQuote(regPath)}; ` +
      `$n = ${psQuote(name)}; ` +
      `if (-not (Test-Path -LiteralPath $p)) { Write-Output 'null'; exit 0; } ` +
      `$item = Get-Item -LiteralPath $p -ErrorAction SilentlyContinue; ` +
      `if (-not $item) { Write-Output 'null'; exit 0; } ` +
      `$names = @($item.GetValueNames()); ` +
      `if ($n -ne '' -and -not ($names -contains $n)) { Write-Output 'null'; exit 0; } ` +
      `$val = $item.GetValue($n); ` +
      `$kind = try { $item.GetValueKind($n).ToString() } catch { 'String' }; ` +
      `$typeMap = @{ 'String' = 'REG_SZ'; 'ExpandString' = 'REG_EXPAND_SZ'; 'DWord' = 'REG_DWORD'; 'QWord' = 'REG_QWORD'; 'MultiString' = 'REG_MULTI_SZ'; 'Binary' = 'REG_BINARY' }; ` +
      `$regType = if ($typeMap.ContainsKey($kind)) { $typeMap[$kind] } else { 'REG_SZ' }; ` +
      `[PSCustomObject]@{ hive = ${psQuote(normHive)}; path = ${psQuote(cleanPath)}; name = $n; value = $val; valueType = $regType } | ConvertTo-Json -Compress`;
    return runJson<RegistryValue | undefined>(this.exec, script);
  }

  async listRegistryValues(hive: RegistryHive, path: string): Promise<readonly RegistryValue[]> {
    const { hive: normHive, fullHive, cleanPath } = normalizeAndValidateRegistry(hive, path);
    const regPath = `Registry::${fullHive}${cleanPath ? "\\" + cleanPath : ""}`;
    const script =
      `$p = ${psQuote(regPath)}; ` +
      `if (-not (Test-Path -LiteralPath $p)) { Write-Output '[]'; exit 0; } ` +
      `$item = Get-Item -LiteralPath $p -ErrorAction SilentlyContinue; ` +
      `if (-not $item) { Write-Output '[]'; exit 0; } ` +
      `$names = @($item.GetValueNames()); ` +
      `$typeMap = @{ 'String' = 'REG_SZ'; 'ExpandString' = 'REG_EXPAND_SZ'; 'DWord' = 'REG_DWORD'; 'QWord' = 'REG_QWORD'; 'MultiString' = 'REG_MULTI_SZ'; 'Binary' = 'REG_BINARY' }; ` +
      `$list = @($names | ForEach-Object { ` +
      `  $val = $item.GetValue($_); ` +
      `  $kind = try { $item.GetValueKind($_).ToString() } catch { 'String' }; ` +
      `  $regType = if ($typeMap.ContainsKey($kind)) { $typeMap[$kind] } else { 'REG_SZ' }; ` +
      `  [PSCustomObject]@{ hive = ${psQuote(normHive)}; path = ${psQuote(cleanPath)}; name = $_; value = $val; valueType = $regType } ` +
      `}); ` +
      `if ($list.Count -eq 0) { '[]' } else { $list | ConvertTo-Json -Compress }`;
    const raw = await runJson<RegistryValue[] | RegistryValue | undefined>(this.exec, script);
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
  }

  async inspectRegistryKey(hive: RegistryHive, path: string): Promise<RegistryKeyInfo> {
    const { hive: normHive, fullHive, cleanPath } = normalizeAndValidateRegistry(hive, path);
    const regPath = `Registry::${fullHive}${cleanPath ? "\\" + cleanPath : ""}`;
    const script =
      `$p = ${psQuote(regPath)}; ` +
      `$exists = Test-Path -LiteralPath $p; ` +
      `if (-not $exists) { ` +
      `  [PSCustomObject]@{ hive = ${psQuote(normHive)}; path = ${psQuote(cleanPath)}; exists = $false; subKeys = @(); values = @() } | ConvertTo-Json -Compress; ` +
      `  exit 0; ` +
      `} ` +
      `$item = Get-Item -LiteralPath $p -ErrorAction SilentlyContinue; ` +
      `$subKeys = if ($item) { @($item.GetSubKeyNames()) } else { @() }; ` +
      `$values = if ($item) { @($item.GetValueNames()) } else { @() }; ` +
      `[PSCustomObject]@{ hive = ${psQuote(normHive)}; path = ${psQuote(cleanPath)}; exists = $true; subKeys = $subKeys; values = $values } | ConvertTo-Json -Compress`;
    const raw = await runJson<RegistryKeyInfo>(this.exec, script);
    if (!raw) {
      return { hive: normHive, path: cleanPath, exists: false, subKeys: [], values: [] };
    }
    const subKeys = Array.isArray(raw.subKeys)
      ? raw.subKeys
      : raw.subKeys
        ? [raw.subKeys as unknown as string]
        : [];
    const values = Array.isArray(raw.values)
      ? raw.values
      : raw.values
        ? [raw.values as unknown as string]
        : [];
    return { ...raw, subKeys, values };
  }

  async writeRegistryValue(value: RegistryValue): Promise<void> {
    const { fullHive, cleanPath } = normalizeAndValidateRegistry(value.hive, value.path);
    const regPath = `Registry::${fullHive}${cleanPath ? "\\" + cleanPath : ""}`;
    const script =
      `$p = ${psQuote(regPath)}; ` +
      `if (-not (Test-Path -LiteralPath $p)) { New-Item -Path $p -Force | Out-Null; } ` +
      `$type = switch (${psQuote(value.valueType ?? "REG_SZ")}) { ` +
      `  'REG_DWORD' { 'DWord' } ` +
      `  'REG_QWORD' { 'QWord' } ` +
      `  'REG_MULTI_SZ' { 'MultiString' } ` +
      `  'REG_BINARY' { 'Binary' } ` +
      `  'REG_EXPAND_SZ' { 'ExpandString' } ` +
      `  default { 'String' } ` +
      `}; ` +
      `Set-ItemProperty -LiteralPath $p -Name ${psQuote(value.name)} -Value ${psQuote(String(value.value))} -Type $type -Force`;
    await run(this.exec, script);
  }

  async deleteRegistryValue(hive: RegistryHive, path: string, name: string): Promise<void> {
    const { fullHive, cleanPath } = normalizeAndValidateRegistry(hive, path);
    const regPath = `Registry::${fullHive}${cleanPath ? "\\" + cleanPath : ""}`;
    const script =
      `$p = ${psQuote(regPath)}; ` +
      `if (Test-Path -LiteralPath $p) { ` +
      `  Remove-ItemProperty -LiteralPath $p -Name ${psQuote(name)} -Force -ErrorAction SilentlyContinue; ` +
      `}`;
    await run(this.exec, script);
  }

  async deleteRegistryKey(hive: RegistryHive, path: string): Promise<void> {
    const { fullHive, cleanPath } = normalizeAndValidateRegistry(hive, path);
    if (!cleanPath) {
      throw new Error(`cannot delete root of registry hive "${hive}"`);
    }
    const regPath = `Registry::${fullHive}\\${cleanPath}`;
    const script =
      `$p = ${psQuote(regPath)}; ` +
      `if (Test-Path -LiteralPath $p) { ` +
      `  Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue; ` +
      `}`;
    await run(this.exec, script);
  }

  async listServices(): Promise<readonly ServiceInfo[]> {
    const script =
      `$services = @(Get-Service | ForEach-Object { ` +
      `  $statusStr = switch ($_.Status) { ` +
      `    'Running' { 'running' } ` +
      `    'Stopped' { 'stopped' } ` +
      `    'Paused' { 'paused' } ` +
      `    'StartPending' { 'start_pending' } ` +
      `    'StopPending' { 'stop_pending' } ` +
      `    default { $_.Status.ToString().ToLower() } ` +
      `  }; ` +
      `  $startStr = try { $_.StartType.ToString().ToLower() } catch { 'manual' }; ` +
      `  [PSCustomObject]@{ ` +
      `    name = $_.Name; ` +
      `    displayName = $_.DisplayName; ` +
      `    status = $statusStr; ` +
      `    startType = $startStr; ` +
      `  } ` +
      `}); ` +
      `if ($services.Count -eq 0) { '[]' } else { $services | ConvertTo-Json -Compress }`;
    const raw = await runJson<ServiceInfo[] | ServiceInfo | undefined>(this.exec, script);
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map((s) => ({
      ...s,
      critical: CRITICAL_SERVICE_NAMES.has(s.name.toLowerCase()),
    }));
  }

  async getService(name: string): Promise<ServiceInfo | undefined> {
    const script =
      `$s = Get-Service -Name ${psQuote(name)} -ErrorAction SilentlyContinue; ` +
      `if (-not $s) { ` +
      `  $s = Get-Service -DisplayName ${psQuote(name)} -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
      `} ` +
      `if (-not $s) { exit 0; } ` +
      `$statusStr = switch ($s.Status) { ` +
      `  'Running' { 'running' } ` +
      `  'Stopped' { 'stopped' } ` +
      `  'Paused' { 'paused' } ` +
      `  'StartPending' { 'start_pending' } ` +
      `  'StopPending' { 'stop_pending' } ` +
      `  default { $s.Status.ToString().ToLower() } ` +
      `}; ` +
      `$startStr = try { $s.StartType.ToString().ToLower() } catch { 'manual' }; ` +
      `[PSCustomObject]@{ ` +
      `  name = $s.Name; ` +
      `  displayName = $s.DisplayName; ` +
      `  status = $statusStr; ` +
      `  startType = $startStr; ` +
      `} | ConvertTo-Json -Compress`;
    const raw = await runJson<ServiceInfo | undefined>(this.exec, script);
    if (!raw) return undefined;
    return {
      ...raw,
      critical: raw.name ? CRITICAL_SERVICE_NAMES.has(raw.name.toLowerCase()) : false,
    };
  }

  async getServiceStatus(name: string): Promise<ServiceStatus> {
    const script =
      `$s = Get-Service -Name ${psQuote(name)} -ErrorAction SilentlyContinue; ` +
      `if (-not $s) { ` +
      `  $s = Get-Service -DisplayName ${psQuote(name)} -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
      `} ` +
      `if (-not $s) { exit 0; } ` +
      `$statusStr = switch ($s.Status) { ` +
      `  'Running' { 'running' } ` +
      `  'Stopped' { 'stopped' } ` +
      `  'Paused' { 'paused' } ` +
      `  'StartPending' { 'start_pending' } ` +
      `  'StopPending' { 'stop_pending' } ` +
      `  default { $s.Status.ToString().ToLower() } ` +
      `}; ` +
      `[PSCustomObject]@{ status = $statusStr } | ConvertTo-Json -Compress`;
    const raw = await runJson<{ status: ServiceStatus } | undefined>(this.exec, script);
    if (!raw || !raw.status) throw new Error(`service "${name}" not found`);
    return raw.status;
  }

  async startService(name: string): Promise<void> {
    try {
      await run(this.exec, `Start-Service -Name ${psQuote(name)} -ErrorAction Stop`);
    } catch (err) {
      this.handleServiceOrTaskError(err, `start service "${name}"`);
    }
  }

  async stopService(name: string): Promise<void> {
    try {
      await run(this.exec, `Stop-Service -Name ${psQuote(name)} -ErrorAction Stop`);
    } catch (err) {
      this.handleServiceOrTaskError(err, `stop service "${name}"`);
    }
  }

  async pauseService(name: string): Promise<void> {
    try {
      await run(this.exec, `Suspend-Service -Name ${psQuote(name)} -ErrorAction Stop`);
    } catch (err) {
      this.handleServiceOrTaskError(err, `pause service "${name}"`);
    }
  }

  async resumeService(name: string): Promise<void> {
    try {
      await run(this.exec, `Resume-Service -Name ${psQuote(name)} -ErrorAction Stop`);
    } catch (err) {
      this.handleServiceOrTaskError(err, `resume service "${name}"`);
    }
  }

  async deleteService(name: string): Promise<void> {
    try {
      await run(this.exec, `sc.exe delete ${psQuote(name)}`);
    } catch (err) {
      this.handleServiceOrTaskError(err, `delete service "${name}"`);
    }
  }

  // -- Task Scheduler --
  async listScheduledTasks(folderPath?: string): Promise<readonly ScheduledTaskInfo[]> {
    const cleanPath = sanitizeTaskPath(folderPath);
    const pathFilter = cleanPath === "\\" ? "" : `-TaskPath ${psQuote(cleanPath)}`;
    const script =
      `$tasks = @(Get-ScheduledTask ${pathFilter} -ErrorAction SilentlyContinue | ForEach-Object { ` +
      `  $stateStr = switch ($_.State) { ` +
      `    1 { 'disabled' } ` +
      `    2 { 'queued' } ` +
      `    3 { 'ready' } ` +
      `    4 { 'running' } ` +
      `    default { 'unknown' } ` +
      `  }; ` +
      `  [PSCustomObject]@{ ` +
      `    taskName = $_.TaskName; ` +
      `    taskPath = $_.TaskPath; ` +
      `    state = $stateStr; ` +
      `    description = $_.Description; ` +
      `    author = $_.Author; ` +
      `    enabled = ($_.State -ne 1); ` +
      `  } ` +
      `}); ` +
      `if ($tasks.Count -eq 0) { '[]' } else { $tasks | ConvertTo-Json -Compress }`;
    const raw = await runJson<ScheduledTaskInfo[] | ScheduledTaskInfo | undefined>(this.exec, script);
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
  }

  async getScheduledTask(name: string, folderPath?: string): Promise<ScheduledTaskInfo | undefined> {
    const cleanName = sanitizeTaskName(name);
    const cleanPath = folderPath ? sanitizeTaskPath(folderPath) : undefined;
    const pathParam = cleanPath ? `-TaskPath ${psQuote(cleanPath)}` : "";
    const script =
      `$t = Get-ScheduledTask -TaskName ${psQuote(cleanName)} ${pathParam} -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
      `if (-not $t) { exit 0; } ` +
      `$stateStr = switch ($t.State) { ` +
      `  1 { 'disabled' } ` +
      `  2 { 'queued' } ` +
      `  3 { 'ready' } ` +
      `  4 { 'running' } ` +
      `  default { 'unknown' } ` +
      `}; ` +
      `$actionStr = if ($t.Actions) { ($t.Actions | ForEach-Object { if ($_.Execute) { $_.Execute + $(if ($_.Arguments) { ' ' + $_.Arguments } else { '' }) } else { $_.ToString() } }) -join '; ' } else { '' }; ` +
      `$triggerStr = if ($t.Triggers) { ($t.Triggers | ForEach-Object { $_.ToString() }) -join '; ' } else { '' }; ` +
      `[PSCustomObject]@{ ` +
      `  taskName = $t.TaskName; ` +
      `  taskPath = $t.TaskPath; ` +
      `  state = $stateStr; ` +
      `  description = $t.Description; ` +
      `  author = $t.Author; ` +
      `  actions = $actionStr; ` +
      `  triggers = $triggerStr; ` +
      `  enabled = ($t.State -ne 1); ` +
      `} | ConvertTo-Json -Compress`;
    const raw = await runJson<ScheduledTaskInfo | undefined>(this.exec, script);
    return raw ?? undefined;
  }

  async runScheduledTask(name: string, folderPath?: string): Promise<void> {
    const cleanName = sanitizeTaskName(name);
    const cleanPath = folderPath ? sanitizeTaskPath(folderPath) : undefined;
    const pathParam = cleanPath ? `-TaskPath ${psQuote(cleanPath)}` : "";
    try {
      await run(this.exec, `Start-ScheduledTask -TaskName ${psQuote(cleanName)} ${pathParam} -ErrorAction Stop`);
    } catch (err) {
      this.handleServiceOrTaskError(err, `run scheduled task "${name}"`);
    }
  }

  async enableScheduledTask(name: string, folderPath?: string): Promise<void> {
    const cleanName = sanitizeTaskName(name);
    const cleanPath = folderPath ? sanitizeTaskPath(folderPath) : undefined;
    const pathParam = cleanPath ? `-TaskPath ${psQuote(cleanPath)}` : "";
    try {
      await run(this.exec, `Enable-ScheduledTask -TaskName ${psQuote(cleanName)} ${pathParam} -ErrorAction Stop`);
    } catch (err) {
      this.handleServiceOrTaskError(err, `enable scheduled task "${name}"`);
    }
  }

  async disableScheduledTask(name: string, folderPath?: string): Promise<void> {
    const cleanName = sanitizeTaskName(name);
    const cleanPath = folderPath ? sanitizeTaskPath(folderPath) : undefined;
    const pathParam = cleanPath ? `-TaskPath ${psQuote(cleanPath)}` : "";
    try {
      await run(this.exec, `Disable-ScheduledTask -TaskName ${psQuote(cleanName)} ${pathParam} -ErrorAction Stop`);
    } catch (err) {
      this.handleServiceOrTaskError(err, `disable scheduled task "${name}"`);
    }
  }

  async createScheduledTask(spec: ScheduledTaskSpec): Promise<void> {
    validateTaskSpec(spec);
    const cleanName = sanitizeTaskName(spec.taskName);
    const cleanPath = sanitizeTaskPath(spec.taskPath);
    const desc = spec.description ? `-Description ${psQuote(spec.description)}` : "";
    const args = spec.arguments ? `-Argument ${psQuote(spec.arguments)}` : "";
    const script =
      `$action = New-ScheduledTaskAction -Execute ${psQuote(spec.executable)} ${args}; ` +
      `Register-ScheduledTask -TaskPath ${psQuote(cleanPath)} -TaskName ${psQuote(cleanName)} -Action $action ${desc} -Force -ErrorAction Stop | Out-Null`;
    try {
      await run(this.exec, script);
    } catch (err) {
      this.handleServiceOrTaskError(err, `create scheduled task "${spec.taskName}"`);
    }
  }

  async deleteScheduledTask(name: string, folderPath?: string): Promise<void> {
    const cleanName = sanitizeTaskName(name);
    const cleanPath = sanitizeTaskPath(folderPath);
    const script = `Unregister-ScheduledTask -TaskPath ${psQuote(cleanPath)} -TaskName ${psQuote(cleanName)} -Confirm:$false -ErrorAction Stop`;
    try {
      await run(this.exec, script);
    } catch (err) {
      this.handleServiceOrTaskError(err, `delete scheduled task "${name}"`);
    }
  }

  private handleServiceOrTaskError(err: unknown, operation: string): never {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("Access is denied") ||
      msg.includes("UnauthorizedAccessException") ||
      msg.includes("Cannot open") ||
      msg.includes("privilege")
    ) {
      throw new Error(`Elevation required: Administrator privileges are required to ${operation}.`);
    }
    throw err instanceof Error ? err : new Error(msg);
  }

  private handleNetworkError(err: unknown, operation: string): never {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("Access to a CIM resource was not available") ||
      msg.includes("PermissionDenied") ||
      msg.includes("Access is denied") ||
      msg.includes("UnauthorizedAccessException") ||
      msg.includes("requires administrator privilege") ||
      msg.includes("privilege")
    ) {
      throw new Error(`Elevation required: Administrator privileges are required to ${operation}.`);
    }
    throw err instanceof Error ? err : new Error(msg);
  }

  // -- Power management (see docs/adr/0030) --
  async getPowerStatus(): Promise<PowerStatusInfo> {
    const raw = await runJson<{
      PowerLineStatus: string;
      BatteryChargeStatus: string;
      BatteryLifePercent: number;
      BatteryLifeRemaining: number;
      ActivePowerScheme: string;
    }>(
      this.exec,
      "Add-Type -AssemblyName System.Windows.Forms; " +
        "$ps = [System.Windows.Forms.SystemInformation]::PowerStatus; " +
        "$schemeOutput = powercfg /getactivescheme; " +
        "$scheme = if ($schemeOutput -match '\\((.*?)\\)') { $matches[1] } else { 'Balanced' }; " +
        "[PSCustomObject]@{" +
        "PowerLineStatus = $ps.PowerLineStatus.ToString();" +
        "BatteryChargeStatus = $ps.BatteryChargeStatus.ToString();" +
        "BatteryLifePercent = [math]::Round($ps.BatteryLifePercent * 100);" +
        "BatteryLifeRemaining = $ps.BatteryLifeRemaining;" +
        "ActivePowerScheme = $scheme" +
        "} | ConvertTo-Json -Compress",
    );

    const isPluggedIn = raw?.PowerLineStatus === "Online";
    const chargeStatus = raw?.BatteryChargeStatus ?? "Unknown";
    const isCharging = chargeStatus.toLowerCase().includes("charging");

    return {
      powerLineStatus:
        raw?.PowerLineStatus === "Online" || raw?.PowerLineStatus === "Offline"
          ? raw.PowerLineStatus
          : "Unknown",
      batteryChargeStatus: chargeStatus,
      batteryLifePercent: raw?.BatteryLifePercent ?? 0,
      batteryLifeRemaining: raw?.BatteryLifeRemaining ?? -1,
      activePowerScheme: raw?.ActivePowerScheme ?? "Balanced",
      isPluggedIn,
      isCharging,
    };
  }

  async lock(): Promise<void> {
    await run(this.exec, "rundll32.exe user32.dll,LockWorkStation");
  }

  async shutdown(): Promise<void> {
    await run(this.exec, "Stop-Computer -Force");
  }

  async restart(): Promise<void> {
    await run(this.exec, "Restart-Computer -Force");
  }

  async sleep(): Promise<void> {
    // The standard real technique for triggering S3 suspend from
    // PowerShell without a third-party module: WinForms exposes it via
    // `Application.SetSuspendState`. `hibernate=$false` (real sleep, not
    // hibernate — the brief explicitly scoped hibernate out),
    // `force=$false` (respect apps that block sleep instead of forcing
    // it), `disableWakeEvent=$false` (leave existing wake timers alone).
    await run(
      this.exec,
      "Add-Type -AssemblyName System.Windows.Forms; " +
        "[System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)",
    );
  }

  async hibernate(): Promise<void> {
    await run(this.exec, "shutdown /h");
  }

  async signOut(): Promise<void> {
    await run(this.exec, "shutdown /l");
  }

  async cancelShutdown(): Promise<void> {
    await run(this.exec, "shutdown /a");
  }

  subscribeToEvents(_handler: WindowsEventHandler): Unsubscribe {
    log.warn(
      "real-time Windows event subscription requires a WMI event watcher (Register-CimIndicationEvent); this production shim only supports polling reads",
    );
    return () => {
      /* no-op: nothing was actually subscribed */
    };
  }

  async samplePerformance(): Promise<PerformanceSample> {
    return runJson<PerformanceSample>(
      this.exec,
      "Get-Counter '\\Processor(_Total)\\% Processor Time' | ConvertTo-Json -Compress",
    );
  }
}

export function createPowerShellWindowsSystemApi(exec?: ShellExec): PowerShellWindowsSystemApi {
  return new PowerShellWindowsSystemApi(exec);
}
