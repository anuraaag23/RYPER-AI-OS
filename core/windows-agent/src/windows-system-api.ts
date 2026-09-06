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
  WindowsVersionInfo,
} from "./types.js";

/**
 * The single seam every manager in this package goes through to touch
 * anything resembling the Windows OS. No manager, and no
 * `WindowsAdapter`, ever calls a Win32/WinRT/WMI/PowerShell API
 * directly — they call methods on an injected `WindowsSystemApi`. This
 * mirrors `@ryper/voice-engine`'s `AudioDeviceSource`, `@ryper/ai-engine`'s
 * `HttpFetch`, and `@ryper/local-runtime`'s `OnnxSession`: an interface
 * that is real, fully specified, and swappable, with two implementations
 * shipped in this package —
 *
 * - `InMemoryWindowsSystemApi` (`reference-system-api.ts`): a real,
 *   fully-functional, deterministic implementation with actual internal
 *   state (a process table, a window list, a virtual filesystem, ...).
 *   This is the default and what every unit/integration test in this
 *   package runs against.
 * - `PowerShellWindowsSystemApi` (`powershell-system-api.ts`): the
 *   production shape — builds real PowerShell/WMI command strings and
 *   parses their (real, `ConvertTo-Json`-shaped) output. It is honestly
 *   non-functional in this Linux sandbox (no `powershell.exe`, no
 *   Windows), because no native Windows toolchain exists in this build
 *   environment — the same constraint every prior hardware-adjacent
 *   phase has documented (Phase 6 audio, Phase 9 sandbox, Phase 10 null
 *   adapter). It is exercised in tests via an injected fake `ShellExec`
 *   that verifies command construction and output parsing, not real
 *   Windows behavior.
 */
export interface WindowsSystemApi {
  // -- Version --
  detectWindowsVersion(): Promise<WindowsVersionInfo>;

  // -- Processes --
  listProcesses(): Promise<readonly ProcessInfo[]>;
  getProcess(pid: number): Promise<ProcessInfo | undefined>;
  startProcess(executablePath: string, args?: readonly string[]): Promise<ProcessInfo>;
  killProcess(pid: number, force: boolean): Promise<void>;

  // -- Windows --
  listWindows(): Promise<readonly WindowInfo[]>;
  getActiveWindow(): Promise<WindowInfo | undefined>;
  focusWindow(handle: string): Promise<void>;
  setWindowState(handle: string, state: WindowState): Promise<void>;
  moveWindow(handle: string, x: number, y: number): Promise<void>;
  resizeWindow(handle: string, width: number, height: number): Promise<void>;
  snapWindow(handle: string, position: WindowSnapPosition): Promise<void>;
  centerWindow(handle: string): Promise<void>;

  // -- Applications --
  listInstalledApplications(): Promise<readonly AppInfo[]>;
  listRunningApplications(): Promise<readonly AppInfo[]>;
  launchApplication(appId: string, args?: readonly string[]): Promise<ProcessInfo>;
  closeApplication(appId: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  openFile(path: string): Promise<void>;
  /**
   * Opens a folder in Windows Explorer. Distinct from `openFile`
   * (which delegates to the OS's registered-application association for
   * a *file*) — added for the "universal open" capability (see
   * `docs/adr/0030`): `open_folder`/`smart_open` need a real, dedicated
   * "show this directory" operation rather than overloading `openFile`
   * on a directory path.
   */
  openFolder(path: string): Promise<void>;

  // -- Filesystem --
  listDirectory(path: string, filter?: string): Promise<readonly FileEntry[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  copyEntry(sourcePath: string, destinationPath: string): Promise<void>;
  moveEntry(sourcePath: string, destinationPath: string): Promise<void>;
  renameEntry(path: string, newName: string): Promise<void>;
  deleteEntry(path: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  searchFiles(query: string, rootPath?: string): Promise<readonly FileEntry[]>;
  getRecentFiles(): Promise<readonly FileEntry[]>;
  getWellKnownFolderPath(folder: WellKnownFolder): Promise<string>;

  // -- Clipboard --
  readClipboard(): Promise<ClipboardContent | undefined>;
  writeClipboard(content: ClipboardContent): Promise<void>;
  getClipboardHistory(): Promise<readonly ClipboardContent[]>;

  // -- Notifications --
  showNotification(spec: NotificationSpec): Promise<NotificationHandle>;
  updateNotification(id: string, spec: NotificationSpec): Promise<NotificationHandle>;
  dismissNotification(id: string): Promise<void>;

  // -- Audio --
  getVolume(): Promise<number>;
  setVolume(level: number): Promise<void>;
  getMute(): Promise<boolean>;
  setMute(muted: boolean): Promise<void>;
  listAudioDevices(): Promise<readonly AudioDeviceInfo[]>;
  setDefaultAudioDevice(id: string): Promise<void>;
  mediaControl(action: MediaControlAction): Promise<void>;
  /**
   * Read-only, real-time "now playing" state via the System Media
   * Transport Controls session manager — not exposed as an AI tool
   * (there is nothing for a user to ask for here beyond what
   * `mediaControl` already lets them do); it exists to give a
   * real-hardware test an objective, independently-readable signal for
   * whether `mediaControl` actually changed anything, since — unlike
   * volume — there is no universal, always-populated "current media
   * state" Windows exposes. See `docs/adr/0025`.
   */
  getNowPlayingState(): Promise<MediaSessionState>;

  // -- Display --
  listDisplays(): Promise<readonly DisplayInfo[]>;

  // -- Devices / system info --
  listDevices(): Promise<readonly DeviceSummary[]>;
  getSystemInfo(): Promise<SystemInfoSnapshot>;
  listNetworkAdapters(): Promise<readonly NetworkAdapterInfo[]>;

  // -- Networking --
  listNetworkAdapterDetails(): Promise<readonly NetworkAdapterDetail[]>;
  getNetworkConfiguration(interfaceAlias?: string): Promise<NetworkConfigurationInfo | undefined>;
  getDnsConfiguration(interfaceAlias?: string): Promise<DnsConfigurationInfo | undefined>;
  getActiveAdapter(): Promise<NetworkAdapterDetail | undefined>;
  enableNetworkAdapter(interfaceAlias: string): Promise<void>;
  disableNetworkAdapter(interfaceAlias: string): Promise<void>;
  setDhcp(interfaceAlias: string): Promise<void>;
  setStaticIp(spec: StaticIpSpec): Promise<void>;
  setDns(spec: DnsSpec): Promise<void>;
  renewDhcp(interfaceAlias?: string): Promise<void>;
  releaseDhcp(interfaceAlias?: string): Promise<void>;
  resetAdapter(interfaceAlias: string): Promise<void>;

  // -- Registry (read is always available; write is gated by the caller, not this interface) --
  readRegistryValue(
    hive: RegistryHive,
    path: string,
    name: string,
  ): Promise<RegistryValue | undefined>;
  listRegistryValues(hive: RegistryHive, path: string): Promise<readonly RegistryValue[]>;
  inspectRegistryKey(hive: RegistryHive, path: string): Promise<RegistryKeyInfo>;
  writeRegistryValue(value: RegistryValue): Promise<void>;
  deleteRegistryValue(hive: RegistryHive, path: string, name: string): Promise<void>;
  deleteRegistryKey(hive: RegistryHive, path: string): Promise<void>;

  // -- Services --
  listServices(): Promise<readonly ServiceInfo[]>;
  getService(name: string): Promise<ServiceInfo | undefined>;
  getServiceStatus(name: string): Promise<ServiceStatus>;
  startService(name: string): Promise<void>;
  stopService(name: string): Promise<void>;
  pauseService(name: string): Promise<void>;
  resumeService(name: string): Promise<void>;
  deleteService(name: string): Promise<void>;

  // -- Task Scheduler --
  listScheduledTasks(folderPath?: string): Promise<readonly ScheduledTaskInfo[]>;
  getScheduledTask(name: string, folderPath?: string): Promise<ScheduledTaskInfo | undefined>;
  runScheduledTask(name: string, folderPath?: string): Promise<void>;
  enableScheduledTask(name: string, folderPath?: string): Promise<void>;
  disableScheduledTask(name: string, folderPath?: string): Promise<void>;
  createScheduledTask(spec: ScheduledTaskSpec): Promise<void>;
  deleteScheduledTask(name: string, folderPath?: string): Promise<void>;

  // -- Power management (see docs/adr/0030) --
  /** Reads current system power status, battery level, power line connection, and active power plan. */
  getPowerStatus(): Promise<PowerStatusInfo>;
  /** Locks the workstation session. */
  lock(): Promise<void>;
  /** Shuts the machine down. Real, irreversible, system-impacting — callers must gate this behind `DestructiveActionGate`, never call it directly from a tool. */
  shutdown(): Promise<void>;
  /** Restarts the machine. Same real-world impact/gating requirement as `shutdown`. */
  restart(): Promise<void>;
  /** Suspends the machine (S3 sleep). Also gated — waking mid-task is disruptive even though it's not destructive the way shutdown/restart are. */
  sleep(): Promise<void>;
  /** Suspends the machine to disk (hibernation). */
  hibernate(): Promise<void>;
  /** Signs out the current user session (logoff). */
  signOut(): Promise<void>;
  /** Cancels a scheduled or pending system shutdown. */
  cancelShutdown(): Promise<void>;

  // -- Events --
  subscribeToEvents(handler: WindowsEventHandler): Unsubscribe;

  // -- Performance --
  samplePerformance(): Promise<PerformanceSample>;
}
