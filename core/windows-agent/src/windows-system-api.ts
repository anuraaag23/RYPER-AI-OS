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

  // -- Filesystem --
  listDirectory(path: string): Promise<readonly FileEntry[]>;
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

  // -- Display --
  listDisplays(): Promise<readonly DisplayInfo[]>;

  // -- Devices / system info --
  listDevices(): Promise<readonly DeviceSummary[]>;
  getSystemInfo(): Promise<SystemInfoSnapshot>;

  // -- Registry (read is always available; write is gated by the caller, not this interface) --
  readRegistryValue(
    hive: RegistryHive,
    path: string,
    name: string,
  ): Promise<RegistryValue | undefined>;
  listRegistryValues(hive: RegistryHive, path: string): Promise<readonly RegistryValue[]>;
  writeRegistryValue(value: RegistryValue): Promise<void>;

  // -- Services --
  listServices(): Promise<readonly ServiceInfo[]>;
  getServiceStatus(name: string): Promise<ServiceStatus>;
  startService(name: string): Promise<void>;
  stopService(name: string): Promise<void>;

  // -- Events --
  subscribeToEvents(handler: WindowsEventHandler): Unsubscribe;

  // -- Performance --
  samplePerformance(): Promise<PerformanceSample>;
}
