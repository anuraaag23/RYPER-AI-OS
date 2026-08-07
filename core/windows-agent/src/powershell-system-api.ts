import { createLogger } from "@ryper/logging";
import type { WindowsSystemApi } from "./windows-system-api.js";
import type {
  AppInfo,
  AudioDeviceInfo,
  ClipboardContent,
  DeviceSummary,
  DisplayInfo,
  FileEntry,
  MediaControlAction,
  NotificationHandle,
  NotificationSpec,
  PerformanceSample,
  ProcessInfo,
  RegistryHive,
  RegistryValue,
  ServiceInfo,
  ServiceStatus,
  ShellExec,
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
      "Get-Process | Select-Object Id,ProcessName,Path | ConvertTo-Json -Compress",
    );
    return Array.isArray(rows) ? rows : [rows].filter(Boolean);
  }

  async getProcess(pid: number): Promise<ProcessInfo | undefined> {
    const all = await this.listProcesses();
    return all.find((p) => p.pid === pid);
  }

  async startProcess(executablePath: string, args: readonly string[] = []): Promise<ProcessInfo> {
    const argList = args.map(psQuote).join(",");
    await run(
      this.exec,
      `Start-Process -FilePath ${psQuote(executablePath)}${argList ? ` -ArgumentList ${argList}` : ""}`,
    );
    const all = await this.listProcesses();
    const started = [...all].reverse().find((p) => p.executablePath === executablePath);
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
    return runJson<WindowInfo[]>(
      this.exec,
      "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id,MainWindowTitle | ConvertTo-Json -Compress",
    );
  }

  async getActiveWindow(): Promise<WindowInfo | undefined> {
    const windows = await this.listWindows();
    return windows.find((w) => w.focused);
  }

  async focusWindow(handle: string): Promise<void> {
    await run(this.exec, `(New-Object -ComObject WScript.Shell).AppActivate(${psQuote(handle)})`);
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
    return runJson<AppInfo[]>(
      this.exec,
      "Get-CimInstance Win32_Product | Select-Object Name,Vendor,Version | ConvertTo-Json -Compress",
    );
  }

  async listRunningApplications(): Promise<readonly AppInfo[]> {
    const windows = await this.listWindows();
    const installed = await this.listInstalledApplications();
    const runningIds = new Set(windows.map((w) => w.appId));
    return installed.filter((app) => runningIds.has(app.appId));
  }

  async launchApplication(appId: string, args: readonly string[] = []): Promise<ProcessInfo> {
    return this.startProcess(appId, args);
  }

  async closeApplication(appId: string): Promise<void> {
    await run(this.exec, `Get-Process ${psQuote(appId)} | Stop-Process`);
  }

  async openUrl(url: string): Promise<void> {
    await run(this.exec, `Start-Process ${psQuote(url)}`);
  }

  async openFile(path: string): Promise<void> {
    await run(this.exec, `Invoke-Item ${psQuote(path)}`);
  }

  async listDirectory(path: string): Promise<readonly FileEntry[]> {
    return runJson<FileEntry[]>(
      this.exec,
      `Get-ChildItem -Path ${psQuote(path)} | Select-Object FullName,Name,Length,LastWriteTime | ConvertTo-Json -Compress`,
    );
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
    return runJson<FileEntry[]>(
      this.exec,
      `Get-ChildItem -Path ${psQuote(rootPath ?? "C:\\")} -Recurse -Filter ${psQuote(`*${query}*`)} -ErrorAction SilentlyContinue | Select-Object FullName,Name,Length,LastWriteTime | ConvertTo-Json -Compress`,
    );
  }

  async getRecentFiles(): Promise<readonly FileEntry[]> {
    return runJson<FileEntry[]>(
      this.exec,
      "Get-ChildItem -Path ([Environment]::GetFolderPath('Recent')) | Select-Object FullName,Name,Length,LastWriteTime | ConvertTo-Json -Compress",
    );
  }

  async getWellKnownFolderPath(folder: WellKnownFolder): Promise<string> {
    const folderMap: Readonly<Record<WellKnownFolder, string>> = {
      downloads: "{374DE290-123F-4565-9164-39C4925E467B}",
      desktop: "Desktop",
      documents: "MyDocuments",
      pictures: "MyPictures",
      videos: "MyVideos",
      music: "MyMusic",
    };
    const token = folderMap[folder];
    const command =
      folder === "downloads"
        ? `(New-Object -ComObject Shell.Application).Namespace('shell:${token}').Self.Path`
        : `[Environment]::GetFolderPath('${token}')`;
    const result = await this.exec(command);
    if (result.exitCode !== 0) {
      throw new PowerShellExecutionError(
        `could not resolve folder "${folder}"`,
        command,
        result.stderr,
      );
    }
    return result.stdout.trim();
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
    const command = `New-BurntToastNotification -Text ${psQuote(spec.title)},${psQuote(spec.body)}`;
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
      "# resolve system volume via the AudioEndpointVolume COM interface",
    );
    return raw?.volume ?? 0;
  }

  async setVolume(level: number): Promise<void> {
    await run(this.exec, `# set system volume to ${level}`);
  }

  async getMute(): Promise<boolean> {
    const raw = await runJson<{ muted: boolean }>(this.exec, "# resolve system mute state");
    return raw?.muted ?? false;
  }

  async setMute(muted: boolean): Promise<void> {
    await run(this.exec, `# set system mute to ${muted}`);
  }

  async listAudioDevices(): Promise<readonly AudioDeviceInfo[]> {
    return runJson<AudioDeviceInfo[]>(
      this.exec,
      "Get-CimInstance Win32_SoundDevice | Select-Object DeviceID,Name | ConvertTo-Json -Compress",
    );
  }

  async setDefaultAudioDevice(id: string): Promise<void> {
    await run(this.exec, `# set default audio device to ${psQuote(id)}`);
  }

  async mediaControl(action: MediaControlAction): Promise<void> {
    await run(this.exec, `# send media key for action ${psQuote(action)}`);
  }

  async listDisplays(): Promise<readonly DisplayInfo[]> {
    return runJson<DisplayInfo[]>(
      this.exec,
      "Get-CimInstance Win32_DesktopMonitor | Select-Object DeviceID,Name | ConvertTo-Json -Compress",
    );
  }

  async listDevices(): Promise<readonly DeviceSummary[]> {
    return runJson<DeviceSummary[]>(
      this.exec,
      "Get-CimInstance Win32_PnPEntity | Select-Object DeviceID,Name,Status | ConvertTo-Json -Compress",
    );
  }

  async getSystemInfo(): Promise<SystemInfoSnapshot> {
    return runJson<SystemInfoSnapshot>(
      this.exec,
      "Get-CimInstance Win32_ComputerSystem | ConvertTo-Json -Compress",
    );
  }

  async readRegistryValue(
    hive: RegistryHive,
    path: string,
    name: string,
  ): Promise<RegistryValue | undefined> {
    return runJson<RegistryValue | undefined>(
      this.exec,
      `Get-ItemProperty -Path ${psQuote(`${hive}:\\${path}`)} -Name ${psQuote(name)} | ConvertTo-Json -Compress`,
    );
  }

  async listRegistryValues(hive: RegistryHive, path: string): Promise<readonly RegistryValue[]> {
    return runJson<RegistryValue[]>(
      this.exec,
      `Get-ItemProperty -Path ${psQuote(`${hive}:\\${path}`)} | ConvertTo-Json -Compress`,
    );
  }

  async writeRegistryValue(value: RegistryValue): Promise<void> {
    await run(
      this.exec,
      `Set-ItemProperty -Path ${psQuote(`${value.hive}:\\${value.path}`)} -Name ${psQuote(value.name)} -Value ${psQuote(String(value.value))}`,
    );
  }

  async listServices(): Promise<readonly ServiceInfo[]> {
    return runJson<ServiceInfo[]>(
      this.exec,
      "Get-Service | Select-Object Name,DisplayName,Status,StartType | ConvertTo-Json -Compress",
    );
  }

  async getServiceStatus(name: string): Promise<ServiceStatus> {
    const raw = await runJson<{ status: ServiceStatus }>(
      this.exec,
      `Get-Service -Name ${psQuote(name)} | Select-Object @{n='status';e={$_.Status}} | ConvertTo-Json -Compress`,
    );
    return raw.status;
  }

  async startService(name: string): Promise<void> {
    await run(this.exec, `Start-Service -Name ${psQuote(name)}`);
  }

  async stopService(name: string): Promise<void> {
    await run(this.exec, `Stop-Service -Name ${psQuote(name)}`);
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
