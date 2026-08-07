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
  SystemInfoSnapshot,
  Unsubscribe,
  WellKnownFolder,
  WindowInfo,
  WindowSnapPosition,
  WindowState,
  WindowsEventHandler,
  WindowsSystemEvent,
  WindowsVersionInfo,
} from "./types.js";

export class WindowsSystemApiError extends Error {}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export interface InMemoryWindowsSystemApiOptions {
  readonly windowsVersion?: WindowsVersionInfo;
  readonly seedProcesses?: readonly ProcessInfo[];
  readonly seedWindows?: readonly WindowInfo[];
  readonly seedInstalledApps?: readonly AppInfo[];
  readonly seedFiles?: Readonly<Record<string, string>>;
  readonly seedServices?: readonly ServiceInfo[];
}

const DEFAULT_WINDOWS_VERSION: WindowsVersionInfo = {
  release: "windows-11",
  buildNumber: "10.0.22631",
  displayName: "Windows 11 23H2",
};

function defaultProcesses(): ProcessInfo[] {
  const now = new Date().toISOString();
  return [
    {
      pid: 4,
      name: "System",
      executablePath: "",
      commandLine: "",
      startedAt: now,
      memoryBytes: 1_048_576,
      cpuPercent: 0.1,
      responding: true,
      critical: true,
    },
    {
      pid: 1234,
      name: "explorer.exe",
      executablePath: "C:\\Windows\\explorer.exe",
      commandLine: "C:\\Windows\\explorer.exe",
      startedAt: now,
      memoryBytes: 83_886_080,
      cpuPercent: 1.2,
      responding: true,
      critical: true,
    },
    {
      pid: 5678,
      name: "notepad.exe",
      executablePath: "C:\\Windows\\System32\\notepad.exe",
      commandLine: "C:\\Windows\\System32\\notepad.exe",
      startedAt: now,
      memoryBytes: 12_582_912,
      cpuPercent: 0.0,
      responding: true,
      critical: false,
    },
  ];
}

function defaultWindows(): WindowInfo[] {
  return [
    {
      handle: "hwnd-1",
      pid: 5678,
      title: "Untitled - Notepad",
      appId: "microsoft.windows.notepad",
      state: "normal",
      bounds: { x: 100, y: 100, width: 800, height: 600 },
      monitorId: "monitor-1",
      focused: true,
    },
    {
      handle: "hwnd-2",
      pid: 1234,
      title: "File Explorer",
      appId: "microsoft.windows.explorer",
      state: "maximized",
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      monitorId: "monitor-1",
      focused: false,
    },
  ];
}

function defaultInstalledApps(): AppInfo[] {
  return [
    {
      appId: "microsoft.windows.notepad",
      name: "Notepad",
      executablePath: "C:\\Windows\\System32\\notepad.exe",
      publisher: "Microsoft Corporation",
      version: "11.2401.0.0",
      installedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      appId: "microsoft.windows.calculator",
      name: "Calculator",
      executablePath: "C:\\Program Files\\WindowsApps\\Microsoft.WindowsCalculator\\Calculator.exe",
      publisher: "Microsoft Corporation",
      version: "11.2401.0.0",
      installedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      appId: "microsoft.edge",
      name: "Microsoft Edge",
      executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      publisher: "Microsoft Corporation",
      version: "120.0.0.0",
      installedAt: "2024-01-01T00:00:00.000Z",
    },
  ];
}

function defaultServices(): ServiceInfo[] {
  return [
    {
      name: "Spooler",
      displayName: "Print Spooler",
      status: "running",
      startType: "automatic",
      critical: false,
    },
    {
      name: "WinDefend",
      displayName: "Microsoft Defender Antivirus Service",
      status: "running",
      startType: "automatic",
      critical: true,
    },
    {
      name: "wuauserv",
      displayName: "Windows Update",
      status: "stopped",
      startType: "manual",
      critical: false,
    },
  ];
}

const WELL_KNOWN_FOLDER_PATHS: Readonly<Record<WellKnownFolder, string>> = {
  downloads: "C:\\Users\\ryper\\Downloads",
  desktop: "C:\\Users\\ryper\\Desktop",
  documents: "C:\\Users\\ryper\\Documents",
  pictures: "C:\\Users\\ryper\\Pictures",
  videos: "C:\\Users\\ryper\\Videos",
  music: "C:\\Users\\ryper\\Music",
};

/**
 * A real, fully functional `WindowsSystemApi` backed entirely by
 * in-process state — a virtual process table, window list, filesystem,
 * registry, service list, and event log. Every operation actually does
 * something and can be observed by a caller (e.g. `killProcess` really
 * removes the process from `listProcesses()`'s next result). This is the
 * default `WindowsSystemApi` and what every test in this package runs
 * against, matching Phase 6's `AudioDeviceSource`/Phase 9's sandbox
 * pattern of "the reference implementation is real, not a stub."
 */
export class InMemoryWindowsSystemApi implements WindowsSystemApi {
  private readonly windowsVersion: WindowsVersionInfo;
  private processes: ProcessInfo[];
  private windows: WindowInfo[];
  private readonly installedApps: AppInfo[];
  private readonly files = new Map<string, string>();
  private readonly directories = new Set<string>();
  private clipboard: ClipboardContent | undefined;
  private readonly clipboardHistory: ClipboardContent[] = [];
  private readonly notifications = new Map<string, NotificationHandle>();
  private volume = 50;
  private muted = false;
  private readonly audioDevices: AudioDeviceInfo[] = [
    { id: "speakers-default", name: "Speakers (Realtek Audio)", kind: "output", isDefault: true },
    { id: "mic-default", name: "Microphone Array", kind: "input", isDefault: true },
  ];
  private readonly displays: DisplayInfo[] = [
    {
      id: "monitor-1",
      name: "Generic PnP Monitor",
      primary: true,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
      refreshHz: 60,
    },
  ];
  private readonly devices: DeviceSummary[] = [
    { id: "dev-1", name: "USB Root Hub", kind: "usb", status: "ok" },
    { id: "dev-2", name: "Realtek Audio", kind: "audio", status: "ok" },
  ];
  private readonly registry = new Map<string, RegistryValue>();
  private services: ServiceInfo[];
  private readonly eventHandlers = new Set<WindowsEventHandler>();

  constructor(options: InMemoryWindowsSystemApiOptions = {}) {
    this.windowsVersion = options.windowsVersion ?? DEFAULT_WINDOWS_VERSION;
    this.processes = [...(options.seedProcesses ?? defaultProcesses())];
    this.windows = [...(options.seedWindows ?? defaultWindows())];
    this.installedApps = [...(options.seedInstalledApps ?? defaultInstalledApps())];
    this.services = [...(options.seedServices ?? defaultServices())];

    for (const path of Object.values(WELL_KNOWN_FOLDER_PATHS)) this.directories.add(path);
    for (const [path, content] of Object.entries(options.seedFiles ?? {})) {
      this.files.set(path, content);
      this.directories.add(dirname(path));
    }

    this.registry.set(registryKey("HKCU", "Software\\Ryper", "InstallPath"), {
      hive: "HKCU",
      path: "Software\\Ryper",
      name: "InstallPath",
      value: "C:\\Program Files\\Ryper",
      valueType: "REG_SZ",
    });
  }

  private emit(type: WindowsSystemEvent["type"], payload: Readonly<Record<string, unknown>>): void {
    const event: WindowsSystemEvent = { type, at: new Date().toISOString(), payload };
    for (const handler of this.eventHandlers) handler(event);
  }

  // -- Version --
  async detectWindowsVersion(): Promise<WindowsVersionInfo> {
    return this.windowsVersion;
  }

  // -- Processes --
  async listProcesses(): Promise<readonly ProcessInfo[]> {
    return [...this.processes];
  }

  async getProcess(pid: number): Promise<ProcessInfo | undefined> {
    return this.processes.find((p) => p.pid === pid);
  }

  async startProcess(executablePath: string, args: readonly string[] = []): Promise<ProcessInfo> {
    const pid = 10_000 + this.processes.length + Math.floor(Math.random() * 1000);
    const name = executablePath.split("\\").pop() ?? executablePath;
    const process: ProcessInfo = {
      pid,
      name,
      executablePath,
      commandLine: [executablePath, ...args].join(" "),
      startedAt: new Date().toISOString(),
      memoryBytes: 8_388_608,
      cpuPercent: 0,
      responding: true,
      critical: false,
    };
    this.processes.push(process);
    this.emit("process_started", { pid, name });
    return process;
  }

  async killProcess(pid: number, _force: boolean): Promise<void> {
    const process = this.processes.find((p) => p.pid === pid);
    if (!process) throw new WindowsSystemApiError(`no process with pid ${pid}`);
    this.processes = this.processes.filter((p) => p.pid !== pid);
    this.windows = this.windows.filter((w) => w.pid !== pid);
    this.emit("process_exited", { pid, name: process.name });
  }

  // -- Windows --
  async listWindows(): Promise<readonly WindowInfo[]> {
    return [...this.windows];
  }

  async getActiveWindow(): Promise<WindowInfo | undefined> {
    return this.windows.find((w) => w.focused);
  }

  private requireWindow(handle: string): WindowInfo {
    const window = this.windows.find((w) => w.handle === handle);
    if (!window) throw new WindowsSystemApiError(`no window with handle "${handle}"`);
    return window;
  }

  private replaceWindow(handle: string, patch: Partial<WindowInfo>): void {
    this.windows = this.windows.map((w) => (w.handle === handle ? { ...w, ...patch } : w));
  }

  async focusWindow(handle: string): Promise<void> {
    this.requireWindow(handle);
    this.windows = this.windows.map((w) => ({ ...w, focused: w.handle === handle }));
    this.emit("window_focus_changed", { handle });
  }

  async setWindowState(handle: string, state: WindowState): Promise<void> {
    this.requireWindow(handle);
    this.replaceWindow(handle, { state });
  }

  async moveWindow(handle: string, x: number, y: number): Promise<void> {
    const window = this.requireWindow(handle);
    this.replaceWindow(handle, { bounds: { ...window.bounds, x, y } });
  }

  async resizeWindow(handle: string, width: number, height: number): Promise<void> {
    const window = this.requireWindow(handle);
    this.replaceWindow(handle, { bounds: { ...window.bounds, width, height } });
  }

  async snapWindow(handle: string, position: WindowSnapPosition): Promise<void> {
    const display = this.displays.find((d) => d.primary) ?? this.displays[0];
    if (!display) throw new WindowsSystemApiError("no display available to snap against");
    const half = { width: Math.floor(display.bounds.width / 2), height: display.bounds.height };
    const quarter = { width: half.width, height: Math.floor(display.bounds.height / 2) };
    const bounds =
      position === "left"
        ? { x: 0, y: 0, ...half }
        : position === "right"
          ? { x: half.width, y: 0, ...half }
          : position === "top"
            ? {
                x: 0,
                y: 0,
                width: display.bounds.width,
                height: Math.floor(display.bounds.height / 2),
              }
            : position === "bottom"
              ? {
                  x: 0,
                  y: Math.floor(display.bounds.height / 2),
                  width: display.bounds.width,
                  height: Math.floor(display.bounds.height / 2),
                }
              : position === "top-left"
                ? { x: 0, y: 0, ...quarter }
                : position === "top-right"
                  ? { x: half.width, y: 0, ...quarter }
                  : position === "bottom-left"
                    ? { x: 0, y: quarter.height, ...quarter }
                    : { x: half.width, y: quarter.height, ...quarter };
    this.requireWindow(handle);
    this.replaceWindow(handle, { bounds, state: "normal" });
  }

  async centerWindow(handle: string): Promise<void> {
    const window = this.requireWindow(handle);
    const display = this.displays.find((d) => d.id === window.monitorId) ?? this.displays[0];
    if (!display) throw new WindowsSystemApiError("no display available to center against");
    const x = Math.floor((display.bounds.width - window.bounds.width) / 2);
    const y = Math.floor((display.bounds.height - window.bounds.height) / 2);
    this.replaceWindow(handle, { bounds: { ...window.bounds, x, y } });
  }

  // -- Applications --
  async listInstalledApplications(): Promise<readonly AppInfo[]> {
    return [...this.installedApps];
  }

  async listRunningApplications(): Promise<readonly AppInfo[]> {
    const runningAppIds = new Set(this.windows.map((w) => w.appId));
    return this.installedApps.filter((app) => runningAppIds.has(app.appId));
  }

  async launchApplication(appId: string, args: readonly string[] = []): Promise<ProcessInfo> {
    const app = this.installedApps.find((a) => a.appId === appId);
    if (!app) throw new WindowsSystemApiError(`no installed application with id "${appId}"`);
    const process = await this.startProcess(app.executablePath, args);
    this.windows.push({
      handle: nextId("hwnd"),
      pid: process.pid,
      title: app.name,
      appId: app.appId,
      state: "normal",
      bounds: { x: 200, y: 200, width: 900, height: 650 },
      monitorId: this.displays[0]?.id ?? "monitor-1",
      focused: true,
    });
    this.windows = this.windows.map((w) => ({ ...w, focused: w.pid === process.pid }));
    return process;
  }

  async closeApplication(appId: string): Promise<void> {
    const windows = this.windows.filter((w) => w.appId === appId);
    if (windows.length === 0) {
      throw new WindowsSystemApiError(`no running window for application "${appId}"`);
    }
    for (const window of windows) {
      await this.killProcess(window.pid, false);
    }
  }

  async openUrl(url: string): Promise<void> {
    if (!/^https?:\/\//i.test(url)) {
      throw new WindowsSystemApiError(`"${url}" is not an http(s) URL`);
    }
    await this.launchApplication("microsoft.edge", [url]);
  }

  async openFile(path: string): Promise<void> {
    if (!this.files.has(path)) throw new WindowsSystemApiError(`no file at "${path}"`);
    await this.startProcess("C:\\Windows\\System32\\notepad.exe", [path]);
  }

  // -- Filesystem --
  async listDirectory(path: string): Promise<readonly FileEntry[]> {
    if (!this.directories.has(path)) {
      throw new WindowsSystemApiError(`no directory at "${path}"`);
    }
    const entries: FileEntry[] = [];
    for (const filePath of this.files.keys()) {
      if (dirname(filePath) === path) entries.push(this.describeFile(filePath));
    }
    for (const dirPath of this.directories) {
      if (dirPath !== path && dirname(dirPath) === path) {
        entries.push({
          path: dirPath,
          name: basename(dirPath),
          kind: "directory",
          sizeBytes: 0,
          modifiedAt: new Date().toISOString(),
        });
      }
    }
    return entries;
  }

  private describeFile(path: string): FileEntry {
    const content = this.files.get(path) ?? "";
    return {
      path,
      name: basename(path),
      kind: "file",
      sizeBytes: content.length,
      modifiedAt: new Date().toISOString(),
    };
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new WindowsSystemApiError(`no file at "${path}"`);
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.directories.add(dirname(path));
    this.files.set(path, content);
  }

  async copyEntry(sourcePath: string, destinationPath: string): Promise<void> {
    const content = this.files.get(sourcePath);
    if (content === undefined) throw new WindowsSystemApiError(`no file at "${sourcePath}"`);
    await this.writeFile(destinationPath, content);
  }

  async moveEntry(sourcePath: string, destinationPath: string): Promise<void> {
    await this.copyEntry(sourcePath, destinationPath);
    this.files.delete(sourcePath);
  }

  async renameEntry(path: string, newName: string): Promise<void> {
    const destination = `${dirname(path)}\\${newName}`;
    await this.moveEntry(path, destination);
  }

  async deleteEntry(path: string): Promise<void> {
    if (this.files.delete(path)) return;
    if (this.directories.has(path)) {
      const hasChildren = [...this.files.keys(), ...this.directories].some(
        (candidate) => candidate !== path && dirname(candidate) === path,
      );
      if (hasChildren) {
        throw new WindowsSystemApiError(`directory "${path}" is not empty`);
      }
      this.directories.delete(path);
      return;
    }
    throw new WindowsSystemApiError(`no file or directory at "${path}"`);
  }

  async createDirectory(path: string): Promise<void> {
    this.directories.add(path);
  }

  async searchFiles(query: string, rootPath?: string): Promise<readonly FileEntry[]> {
    const lowered = query.toLowerCase();
    return [...this.files.keys()]
      .filter((path) => (rootPath ? path.startsWith(rootPath) : true))
      .filter((path) => basename(path).toLowerCase().includes(lowered))
      .map((path) => this.describeFile(path));
  }

  async getRecentFiles(): Promise<readonly FileEntry[]> {
    return [...this.files.keys()].slice(-10).map((path) => this.describeFile(path));
  }

  async getWellKnownFolderPath(folder: WellKnownFolder): Promise<string> {
    return WELL_KNOWN_FOLDER_PATHS[folder];
  }

  // -- Clipboard --
  async readClipboard(): Promise<ClipboardContent | undefined> {
    return this.clipboard;
  }

  async writeClipboard(content: ClipboardContent): Promise<void> {
    this.clipboard = content;
    this.clipboardHistory.push(content);
    if (this.clipboardHistory.length > 25) this.clipboardHistory.shift();
    this.emit("clipboard_changed", { format: content.format });
  }

  async getClipboardHistory(): Promise<readonly ClipboardContent[]> {
    return [...this.clipboardHistory];
  }

  // -- Notifications --
  async showNotification(spec: NotificationSpec): Promise<NotificationHandle> {
    const handle: NotificationHandle = {
      id: nextId("notif"),
      spec,
      shownAt: new Date().toISOString(),
      dismissed: false,
    };
    this.notifications.set(handle.id, handle);
    return handle;
  }

  async updateNotification(id: string, spec: NotificationSpec): Promise<NotificationHandle> {
    const existing = this.notifications.get(id);
    if (!existing) throw new WindowsSystemApiError(`no notification with id "${id}"`);
    const updated: NotificationHandle = { ...existing, spec };
    this.notifications.set(id, updated);
    return updated;
  }

  async dismissNotification(id: string): Promise<void> {
    const existing = this.notifications.get(id);
    if (!existing) throw new WindowsSystemApiError(`no notification with id "${id}"`);
    this.notifications.set(id, { ...existing, dismissed: true });
  }

  // -- Audio --
  async getVolume(): Promise<number> {
    return this.volume;
  }

  async setVolume(level: number): Promise<void> {
    if (level < 0 || level > 100) throw new WindowsSystemApiError("volume must be within 0-100");
    this.volume = level;
  }

  async getMute(): Promise<boolean> {
    return this.muted;
  }

  async setMute(muted: boolean): Promise<void> {
    this.muted = muted;
  }

  async listAudioDevices(): Promise<readonly AudioDeviceInfo[]> {
    return [...this.audioDevices];
  }

  async setDefaultAudioDevice(id: string): Promise<void> {
    const target = this.audioDevices.find((d) => d.id === id);
    if (!target) throw new WindowsSystemApiError(`no audio device with id "${id}"`);
    for (const device of this.audioDevices) {
      (device as { isDefault: boolean }).isDefault =
        device.kind === target.kind && device.id === id;
    }
  }

  async mediaControl(_action: MediaControlAction): Promise<void> {
    // No real media session exists in this reference implementation; accepted as a no-op success.
  }

  // -- Display --
  async listDisplays(): Promise<readonly DisplayInfo[]> {
    return [...this.displays];
  }

  // -- Devices / system info --
  async listDevices(): Promise<readonly DeviceSummary[]> {
    return [...this.devices];
  }

  async getSystemInfo(): Promise<SystemInfoSnapshot> {
    return {
      cpu: { model: "Generic x64 CPU", cores: 8, usagePercent: 12 },
      gpu: { model: "Generic GPU", usagePercent: 5 },
      ram: { totalBytes: 17_179_869_184, usedBytes: 6_442_450_944 },
      storage: [{ volume: "C:", totalBytes: 512_110_190_592, freeBytes: 210_453_397_504 }],
      battery: { percent: 87, charging: true },
      windowsVersion: this.windowsVersion,
      network: { connected: true, connectionType: "wifi" },
    };
  }

  // -- Registry --
  async readRegistryValue(
    hive: RegistryHive,
    path: string,
    name: string,
  ): Promise<RegistryValue | undefined> {
    return this.registry.get(registryKey(hive, path, name));
  }

  async listRegistryValues(hive: RegistryHive, path: string): Promise<readonly RegistryValue[]> {
    return [...this.registry.values()].filter((v) => v.hive === hive && v.path === path);
  }

  async writeRegistryValue(value: RegistryValue): Promise<void> {
    this.registry.set(registryKey(value.hive, value.path, value.name), value);
  }

  // -- Services --
  async listServices(): Promise<readonly ServiceInfo[]> {
    return [...this.services];
  }

  async getServiceStatus(name: string): Promise<ServiceStatus> {
    const service = this.services.find((s) => s.name === name);
    if (!service) throw new WindowsSystemApiError(`no service named "${name}"`);
    return service.status;
  }

  private setServiceStatus(name: string, status: ServiceStatus): void {
    this.services = this.services.map((s) => (s.name === name ? { ...s, status } : s));
  }

  async startService(name: string): Promise<void> {
    const service = this.services.find((s) => s.name === name);
    if (!service) throw new WindowsSystemApiError(`no service named "${name}"`);
    this.setServiceStatus(name, "running");
  }

  async stopService(name: string): Promise<void> {
    const service = this.services.find((s) => s.name === name);
    if (!service) throw new WindowsSystemApiError(`no service named "${name}"`);
    this.setServiceStatus(name, "stopped");
  }

  // -- Events --
  subscribeToEvents(handler: WindowsEventHandler): Unsubscribe {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  // -- Performance --
  async samplePerformance(): Promise<PerformanceSample> {
    const info = await this.getSystemInfo();
    return {
      at: new Date().toISOString(),
      cpuPercent: info.cpu.usagePercent,
      memoryPercent: Math.round((info.ram.usedBytes / info.ram.totalBytes) * 100),
      diskIoPercent: 3,
    };
  }
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("\\");
  return idx <= 0 ? path : path.slice(0, idx);
}

function basename(path: string): string {
  const idx = path.lastIndexOf("\\");
  return idx === -1 ? path : path.slice(idx + 1);
}

function registryKey(hive: RegistryHive, path: string, name: string): string {
  return `${hive}\\${path}\\${name}`;
}

export function createInMemoryWindowsSystemApi(
  options?: InMemoryWindowsSystemApiOptions,
): InMemoryWindowsSystemApi {
  return new InMemoryWindowsSystemApi(options);
}
