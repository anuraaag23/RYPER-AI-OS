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
  StaticIpSpec,
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
  readonly seedScheduledTasks?: readonly ScheduledTaskInfo[];
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

function defaultScheduledTasks(): ScheduledTaskInfo[] {
  return [
    {
      taskName: "Adobe Acrobat Update Task",
      taskPath: "\\",
      state: "ready",
      description: "Adobe update checking task",
      author: "Adobe Systems",
      actions: "C:\\Program Files\\Adobe\\Acrobat\\update.exe",
      triggers: "Daily at 10:00 AM",
      enabled: true,
    },
    {
      taskName: "CreateExplorerShellUnelevatedTask",
      taskPath: "\\",
      state: "ready",
      description: "Explorer shell startup task",
      author: "Microsoft Corporation",
      actions: "explorer.exe",
      triggers: "At logon",
      enabled: true,
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
  // Real, minimal, deterministic simulated media session — no real
  // media session exists in this reference implementation, but a
  // small, real (if fake-data) playlist lets fast unit tests verify
  // `mediaControl()`'s effect on session state, mirroring what the
  // real WinRT `getNowPlayingState()` reads on real Windows.
  private readonly playlist: ReadonlyArray<{ title: string; artist: string }> = [
    { title: "Track One", artist: "Test Artist" },
    { title: "Track Two", artist: "Test Artist" },
    { title: "Track Three", artist: "Test Artist" },
  ];
  private trackIndex = 0;
  private mediaStatus: MediaPlaybackStatus = "none";
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
  private scheduledTasks: ScheduledTaskInfo[];
  private readonly eventHandlers = new Set<WindowsEventHandler>();

  constructor(options: InMemoryWindowsSystemApiOptions = {}) {
    this.windowsVersion = options.windowsVersion ?? DEFAULT_WINDOWS_VERSION;
    this.processes = [...(options.seedProcesses ?? defaultProcesses())];
    this.windows = [...(options.seedWindows ?? defaultWindows())];
    this.installedApps = [...(options.seedInstalledApps ?? defaultInstalledApps())];
    this.services = [...(options.seedServices ?? defaultServices())];
    this.scheduledTasks = [...(options.seedScheduledTasks ?? defaultScheduledTasks())];

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

  async openFolder(path: string): Promise<void> {
    if (!this.directories.has(path)) {
      throw new WindowsSystemApiError(`no directory at "${path}"`);
    }
    await this.startProcess("C:\\Windows\\explorer.exe", [path]);
  }

  // -- Filesystem --
  async listDirectory(path: string, filter?: string): Promise<readonly FileEntry[]> {
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
    if (filter) {
      const cleanFilter = filter.toLowerCase().replace(/^\*/, "").replace(/\*$/, "");
      return entries.filter((e) => e.name.toLowerCase().includes(cleanFilter));
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

  async mediaControl(action: MediaControlAction): Promise<void> {
    switch (action) {
      case "play":
        this.mediaStatus = "playing";
        break;
      case "pause":
        this.mediaStatus = "paused";
        break;
      case "stop":
        this.mediaStatus = "stopped";
        break;
      case "next":
        this.trackIndex = (this.trackIndex + 1) % this.playlist.length;
        this.mediaStatus = "playing";
        break;
      case "previous":
        this.trackIndex = (this.trackIndex - 1 + this.playlist.length) % this.playlist.length;
        this.mediaStatus = "playing";
        break;
    }
  }

  async getNowPlayingState(): Promise<MediaSessionState> {
    if (this.mediaStatus === "none") return { status: "none" };
    const track = this.playlist[this.trackIndex];
    if (!track) return { status: this.mediaStatus };
    return { status: this.mediaStatus, title: track.title, artist: track.artist };
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
      network: {
        connected: true,
        connectionType: "wifi",
        adapterName: "Wi-Fi",
        adapters: [
          {
            name: "Wi-Fi",
            description: "Realtek RTL8852BE WiFi 6 802.11ax PCIe Adapter",
            status: "up",
            type: "wifi",
            speed: "1.2 Gbps",
          },
        ],
      },
    };
  }

  private networkAdapters: NetworkAdapterDetail[] = [
    {
      name: "Wi-Fi",
      description: "Realtek RTL8852BE WiFi 6 802.11ax PCIe Adapter",
      status: "up",
      type: "wifi",
      speed: "1.2 Gbps",
      macAddress: "14-B5-CD-B9-EA-8B",
      ifIndex: 13,
      isActive: true,
      ipv4: "192.168.1.4",
      gateway: "192.168.1.1",
      dnsServers: ["192.168.1.1"],
      dhcpEnabled: true,
    },
    {
      name: "Ethernet",
      description: "Realtek PCIe GbE Family Controller",
      status: "disconnected",
      type: "ethernet",
      speed: "0 bps",
      macAddress: "F4-3A-FA-C4-66-60",
      ifIndex: 16,
      isActive: false,
      ipv4: "169.254.48.205",
      gateway: null,
      dnsServers: ["8.8.8.8", "4.2.2.2"],
      dhcpEnabled: true,
    },
  ];

  async listNetworkAdapters(): Promise<readonly NetworkAdapterInfo[]> {
    return this.networkAdapters.map((a) => ({
      name: a.name,
      description: a.description,
      status: a.status,
      type: a.type,
      ...(a.speed !== undefined ? { speed: a.speed } : {}),
    }));
  }

  async listNetworkAdapterDetails(): Promise<readonly NetworkAdapterDetail[]> {
    return [...this.networkAdapters];
  }

  async getNetworkConfiguration(interfaceAlias?: string): Promise<NetworkConfigurationInfo | undefined> {
    const target = interfaceAlias
      ? this.networkAdapters.find((a) => a.name.toLowerCase() === interfaceAlias.toLowerCase())
      : this.networkAdapters.find((a) => a.isActive) || this.networkAdapters[0];
    if (!target) return undefined;
    const ipv4List = Array.isArray(target.ipv4) ? target.ipv4 : target.ipv4 ? [target.ipv4] : [];
    return {
      interfaceAlias: target.name,
      interfaceIndex: target.ifIndex ?? 1,
      description: target.description,
      status: target.status,
      ...(target.macAddress !== undefined ? { macAddress: target.macAddress } : {}),
      ...(target.speed !== undefined ? { linkSpeed: target.speed } : {}),
      ipv4Addresses: ipv4List,
      ipv6Addresses: [],
      defaultGateway: target.gateway ?? null,
      dnsServers: target.dnsServers ?? [],
      dhcpEnabled: target.dhcpEnabled ?? true,
      isActive: !!target.isActive,
    };
  }

  async getDnsConfiguration(interfaceAlias?: string): Promise<DnsConfigurationInfo | undefined> {
    const target = interfaceAlias
      ? this.networkAdapters.find((a) => a.name.toLowerCase() === interfaceAlias.toLowerCase())
      : this.networkAdapters.find((a) => a.isActive) || this.networkAdapters[0];
    if (!target) return undefined;
    return {
      interfaceAlias: target.name,
      interfaceIndex: target.ifIndex ?? 1,
      dnsServers: target.dnsServers ?? [],
      connectionSpecificSuffix: "",
      registerThisConnectionsAddress: true,
    };
  }

  async getActiveAdapter(): Promise<NetworkAdapterDetail | undefined> {
    return this.networkAdapters.find((a) => a.isActive);
  }

  async enableNetworkAdapter(interfaceAlias: string): Promise<void> {
    const target = this.networkAdapters.find((a) => a.name.toLowerCase() === interfaceAlias.toLowerCase());
    if (!target) throw new Error(`Network adapter "${interfaceAlias}" not found.`);
    (target as any).status = "up";
  }

  async disableNetworkAdapter(interfaceAlias: string): Promise<void> {
    const target = this.networkAdapters.find((a) => a.name.toLowerCase() === interfaceAlias.toLowerCase());
    if (!target) throw new Error(`Network adapter "${interfaceAlias}" not found.`);
    (target as any).status = "down";
  }

  async setDhcp(interfaceAlias: string): Promise<void> {
    const target = this.networkAdapters.find((a) => a.name.toLowerCase() === interfaceAlias.toLowerCase());
    if (!target) throw new Error(`Network adapter "${interfaceAlias}" not found.`);
    (target as any).dhcpEnabled = true;
  }

  async setStaticIp(spec: StaticIpSpec): Promise<void> {
    const target = this.networkAdapters.find((a) => a.name.toLowerCase() === spec.interfaceAlias.toLowerCase());
    if (!target) throw new Error(`Network adapter "${spec.interfaceAlias}" not found.`);
    (target as any).dhcpEnabled = false;
    (target as any).ipv4 = spec.ipAddress;
    if (spec.defaultGateway) {
      (target as any).gateway = spec.defaultGateway;
    }
  }

  async setDns(spec: DnsSpec): Promise<void> {
    const target = this.networkAdapters.find((a) => a.name.toLowerCase() === spec.interfaceAlias.toLowerCase());
    if (!target) throw new Error(`Network adapter "${spec.interfaceAlias}" not found.`);
    (target as any).dnsServers = [...spec.serverAddresses];
  }

  async renewDhcp(interfaceAlias?: string): Promise<void> {
    if (interfaceAlias) {
      const target = this.networkAdapters.find((a) => a.name.toLowerCase() === interfaceAlias.toLowerCase());
      if (!target) throw new Error(`Network adapter "${interfaceAlias}" not found.`);
    }
  }

  async releaseDhcp(interfaceAlias?: string): Promise<void> {
    if (interfaceAlias) {
      const target = this.networkAdapters.find((a) => a.name.toLowerCase() === interfaceAlias.toLowerCase());
      if (!target) throw new Error(`Network adapter "${interfaceAlias}" not found.`);
      (target as any).ipv4 = "";
    } else {
      for (const a of this.networkAdapters) {
        (a as any).ipv4 = "";
      }
    }
  }

  async resetAdapter(interfaceAlias: string): Promise<void> {
    const target = this.networkAdapters.find((a) => a.name.toLowerCase() === interfaceAlias.toLowerCase());
    if (!target) throw new Error(`Network adapter "${interfaceAlias}" not found.`);
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
    const normPath = path.toLowerCase();
    return [...this.registry.values()].filter(
      (v) => v.hive === hive && v.path.toLowerCase() === normPath,
    );
  }

  async inspectRegistryKey(hive: RegistryHive, path: string): Promise<RegistryKeyInfo> {
    const normPath = path.toLowerCase();
    const prefix = normPath ? normPath + "\\" : "";
    const values: string[] = [];
    const subKeysSet = new Set<string>();
    let exists = false;

    for (const v of this.registry.values()) {
      if (v.hive !== hive) continue;
      const vPath = v.path.toLowerCase();
      if (vPath === normPath) {
        exists = true;
        values.push(v.name);
      } else if (prefix && vPath.startsWith(prefix)) {
        exists = true;
        const rem = vPath.slice(prefix.length);
        const child = rem.split("\\")[0];
        if (child) subKeysSet.add(child);
      }
    }

    return {
      hive,
      path,
      exists,
      subKeys: [...subKeysSet],
      values,
    };
  }

  async writeRegistryValue(value: RegistryValue): Promise<void> {
    this.registry.set(registryKey(value.hive, value.path, value.name), value);
  }

  async deleteRegistryValue(hive: RegistryHive, path: string, name: string): Promise<void> {
    this.registry.delete(registryKey(hive, path, name));
  }

  async deleteRegistryKey(hive: RegistryHive, path: string): Promise<void> {
    const normPath = path.toLowerCase();
    const prefix = normPath ? normPath + "\\" : "";
    for (const [k, v] of this.registry.entries()) {
      if (v.hive === hive) {
        const vPath = v.path.toLowerCase();
        if (vPath === normPath || (prefix && vPath.startsWith(prefix))) {
          this.registry.delete(k);
        }
      }
    }
  }

  // -- Services --
  async listServices(): Promise<readonly ServiceInfo[]> {
    return [...this.services];
  }

  async getService(name: string): Promise<ServiceInfo | undefined> {
    const q = name.toLowerCase();
    return this.services.find(
      (s) => s.name.toLowerCase() === q || s.displayName.toLowerCase() === q,
    );
  }

  async getServiceStatus(name: string): Promise<ServiceStatus> {
    const service = await this.getService(name);
    if (!service) throw new WindowsSystemApiError(`no service named "${name}"`);
    return service.status;
  }

  private setServiceStatus(name: string, status: ServiceStatus): void {
    const q = name.toLowerCase();
    this.services = this.services.map((s) =>
      s.name.toLowerCase() === q || s.displayName.toLowerCase() === q ? { ...s, status } : s,
    );
  }

  async startService(name: string): Promise<void> {
    const service = await this.getService(name);
    if (!service) throw new WindowsSystemApiError(`no service named "${name}"`);
    this.setServiceStatus(name, "running");
  }

  async stopService(name: string): Promise<void> {
    const service = await this.getService(name);
    if (!service) throw new WindowsSystemApiError(`no service named "${name}"`);
    this.setServiceStatus(name, "stopped");
  }

  async pauseService(name: string): Promise<void> {
    const service = await this.getService(name);
    if (!service) throw new WindowsSystemApiError(`no service named "${name}"`);
    this.setServiceStatus(name, "paused");
  }

  async resumeService(name: string): Promise<void> {
    const service = await this.getService(name);
    if (!service) throw new WindowsSystemApiError(`no service named "${name}"`);
    this.setServiceStatus(name, "running");
  }

  async deleteService(name: string): Promise<void> {
    const service = await this.getService(name);
    if (!service) throw new WindowsSystemApiError(`no service named "${name}"`);
    this.services = this.services.filter(
      (s) => s.name.toLowerCase() !== service.name.toLowerCase(),
    );
  }

  // -- Task Scheduler --
  async listScheduledTasks(folderPath?: string): Promise<readonly ScheduledTaskInfo[]> {
    if (!folderPath || folderPath === "\\" || folderPath === "/") {
      return [...this.scheduledTasks];
    }
    const norm = folderPath.toLowerCase().replace(/\\+$/, "");
    return this.scheduledTasks.filter((t) =>
      t.taskPath.toLowerCase().replace(/\\+$/, "").startsWith(norm),
    );
  }

  async getScheduledTask(
    name: string,
    folderPath?: string,
  ): Promise<ScheduledTaskInfo | undefined> {
    const q = name.toLowerCase();
    return this.scheduledTasks.find((t) => {
      const matchName = t.taskName.toLowerCase() === q;
      if (!matchName) return false;
      if (!folderPath) return true;
      return (
        t.taskPath.toLowerCase().replace(/\\+$/, "") ===
        folderPath.toLowerCase().replace(/\\+$/, "")
      );
    });
  }

  async runScheduledTask(name: string, folderPath?: string): Promise<void> {
    const task = await this.getScheduledTask(name, folderPath);
    if (!task) throw new WindowsSystemApiError(`no scheduled task named "${name}"`);
    this.scheduledTasks = this.scheduledTasks.map((t) =>
      t.taskName.toLowerCase() === task.taskName.toLowerCase() ? { ...t, state: "running" } : t,
    );
  }

  async enableScheduledTask(name: string, folderPath?: string): Promise<void> {
    const task = await this.getScheduledTask(name, folderPath);
    if (!task) throw new WindowsSystemApiError(`no scheduled task named "${name}"`);
    this.scheduledTasks = this.scheduledTasks.map((t) =>
      t.taskName.toLowerCase() === task.taskName.toLowerCase()
        ? { ...t, enabled: true, state: "ready" }
        : t,
    );
  }

  async disableScheduledTask(name: string, folderPath?: string): Promise<void> {
    const task = await this.getScheduledTask(name, folderPath);
    if (!task) throw new WindowsSystemApiError(`no scheduled task named "${name}"`);
    this.scheduledTasks = this.scheduledTasks.map((t) =>
      t.taskName.toLowerCase() === task.taskName.toLowerCase()
        ? { ...t, enabled: false, state: "disabled" }
        : t,
    );
  }

  async createScheduledTask(spec: ScheduledTaskSpec): Promise<void> {
    const existing = await this.getScheduledTask(spec.taskName, spec.taskPath);
    const entry: ScheduledTaskInfo = {
      taskName: spec.taskName,
      taskPath: spec.taskPath ?? "\\",
      state: "ready",
      description: spec.description,
      actions: `${spec.executable}${spec.arguments ? " " + spec.arguments : ""}`,
      triggers: "(manual)",
      enabled: true,
    };
    if (existing) {
      this.scheduledTasks = this.scheduledTasks.map((t) =>
        t.taskName.toLowerCase() === spec.taskName.toLowerCase() ? entry : t,
      );
    } else {
      this.scheduledTasks.push(entry);
    }
  }

  async deleteScheduledTask(name: string, folderPath?: string): Promise<void> {
    const task = await this.getScheduledTask(name, folderPath);
    if (!task) throw new WindowsSystemApiError(`no scheduled task named "${name}"`);
    this.scheduledTasks = this.scheduledTasks.filter(
      (t) => t.taskName.toLowerCase() !== task.taskName.toLowerCase(),
    );
  }

  // -- Power management (see docs/adr/0030) --
  // This in-memory reference implementation models a whole fake Windows
  // machine inside one Node process; there is no real OS underneath it
  // to actually shut down, restart, or suspend, and doing anything that
  // terminated *this* process would break the reference environment
  // itself rather than honestly simulating the operation. Real,
  // system-impacting behavior only exists in `PowerShellWindowsSystemApi`
  // (the one that actually runs on real Windows). This reference
  // implementation instead records the request for a test to observe
  // (`lastPowerAction`) and resolves — a real, honest "yes, this call
  // reached here and would have been actioned" signal, not a fabricated
  // no-op success dressed up as more than it is.
  lastPowerAction: "shutdown" | "restart" | "sleep" | "lock" | "hibernate" | "signOut" | "cancelShutdown" | undefined;

  async getPowerStatus(): Promise<PowerStatusInfo> {
    return {
      powerLineStatus: "Online",
      batteryChargeStatus: "High",
      batteryLifePercent: 87,
      batteryLifeRemaining: -1,
      activePowerScheme: "Balanced",
      isPluggedIn: true,
      isCharging: true,
    };
  }

  async lock(): Promise<void> {
    this.lastPowerAction = "lock";
  }

  async shutdown(): Promise<void> {
    this.lastPowerAction = "shutdown";
  }

  async restart(): Promise<void> {
    this.lastPowerAction = "restart";
  }

  async sleep(): Promise<void> {
    this.lastPowerAction = "sleep";
  }

  async hibernate(): Promise<void> {
    this.lastPowerAction = "hibernate";
  }

  async signOut(): Promise<void> {
    this.lastPowerAction = "signOut";
  }

  async cancelShutdown(): Promise<void> {
    this.lastPowerAction = "cancelShutdown";
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
