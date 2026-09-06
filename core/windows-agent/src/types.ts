// ---- Windows version ----

export type WindowsRelease = "windows-10" | "windows-11" | "unsupported";

export interface WindowsVersionInfo {
  readonly release: WindowsRelease;
  /** e.g. "10.0.22631" — the raw build number reported by the OS. */
  readonly buildNumber: string;
  readonly displayName: string;
}

// ---- Processes ----

export interface ProcessInfo {
  readonly pid: number;
  readonly name: string;
  readonly executablePath: string;
  readonly commandLine: string;
  readonly startedAt: string;
  readonly memoryBytes: number;
  readonly cpuPercent: number;
  readonly responding: boolean;
  /** Processes the reference/production implementation refuses to kill without extra confirmation. */
  readonly critical: boolean;
}

// ---- Windows (the GUI kind) ----

export type WindowState = "normal" | "minimized" | "maximized";
export type WindowSnapPosition =
  "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WindowInfo {
  readonly handle: string;
  readonly pid: number;
  readonly title: string;
  readonly appId: string;
  readonly state: WindowState;
  readonly bounds: WindowBounds;
  readonly monitorId: string;
  readonly focused: boolean;
}

// ---- Applications ----

export interface AppInfo {
  readonly appId: string;
  readonly name: string;
  readonly executablePath: string;
  readonly publisher: string;
  readonly version: string;
  readonly installedAt: string;
}

// ---- Filesystem ----

export type WellKnownFolder =
  "downloads" | "desktop" | "documents" | "pictures" | "videos" | "music";

export interface FileEntry {
  readonly path: string;
  readonly name: string;
  readonly kind: "file" | "directory";
  readonly sizeBytes: number;
  readonly modifiedAt: string;
}

// ---- Clipboard ----

export interface ClipboardContent {
  readonly format: "text" | "html" | "image-ref" | "files";
  readonly value: string;
  readonly capturedAt: string;
}

// ---- Notifications ----

export type NotificationKind = "basic" | "progress" | "action" | "persistent";

export interface NotificationAction {
  readonly id: string;
  readonly label: string;
}

export interface NotificationSpec {
  readonly title: string;
  readonly body: string;
  readonly kind: NotificationKind;
  /** Required, and only meaningful, for `kind: "progress"`. */
  readonly progressPercent?: number;
  readonly actions?: readonly NotificationAction[];
}

export interface NotificationHandle {
  readonly id: string;
  readonly spec: NotificationSpec;
  readonly shownAt: string;
  readonly dismissed: boolean;
}

// ---- System Tray ----

export interface SystemTrayStatus {
  readonly created: boolean;
  readonly tooltip: string;
  readonly visible: boolean;
  readonly destroyed?: boolean;
}

export interface SystemTrayHandler {
  getStatus(): Promise<SystemTrayStatus> | SystemTrayStatus;
  setTooltip(tooltip: string): Promise<void> | void;
  destroy?(): Promise<void> | void;
}

// ---- Audio ----

export type AudioDeviceKind = "output" | "input";

export interface AudioDeviceInfo {
  readonly id: string;
  readonly name: string;
  readonly kind: AudioDeviceKind;
  readonly isDefault: boolean;
}

export type MediaControlAction = "play" | "pause" | "next" | "previous" | "stop";

/**
 * The real, WinRT-reported `GlobalSystemMediaTransportControlsSession`
 * playback state — `"none"` means no application currently has an
 * active System Media Transport Controls session at all (nothing
 * playing/paused anywhere), which is a real, valid, honest outcome on
 * a machine with no media app open — not an error. The other values
 * mirror `Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus`'s
 * own member names exactly.
 */
export type MediaPlaybackStatus =
  "none" | "closed" | "opened" | "changing" | "stopped" | "playing" | "paused";

export interface MediaSessionState {
  readonly status: MediaPlaybackStatus;
  readonly title?: string;
  readonly artist?: string;
}

// ---- Display ----

export interface DisplayInfo {
  readonly id: string;
  readonly name: string;
  readonly primary: boolean;
  readonly bounds: WindowBounds;
  readonly scaleFactor: number;
  readonly refreshHz: number;
}

// ---- Devices / system info ----

export interface NetworkAdapterInfo {
  readonly name: string;
  readonly description: string;
  readonly status: "up" | "down" | "disconnected";
  readonly type: "ethernet" | "wifi" | "virtual" | "other";
  readonly speed?: string | undefined;
}

export interface DeviceSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly status: "ok" | "error" | "disabled";
}

export interface SystemInfoSnapshot {
  readonly cpu: { readonly model: string; readonly cores: number; readonly usagePercent: number };
  readonly gpu: { readonly model: string; readonly usagePercent: number };
  readonly ram: { readonly totalBytes: number; readonly usedBytes: number };
  readonly storage: readonly {
    readonly volume: string;
    readonly totalBytes: number;
    readonly freeBytes: number;
  }[];
  readonly battery?: { readonly percent: number; readonly charging: boolean };
  readonly windowsVersion: WindowsVersionInfo;
  readonly network: {
    readonly connected: boolean;
    readonly connectionType: "ethernet" | "wifi" | "none";
    readonly adapterName?: string;
    readonly adapters?: readonly NetworkAdapterInfo[];
  };
}

// ---- Power Management ----

export interface PowerStatusInfo {
  readonly powerLineStatus: "Online" | "Offline" | "Unknown";
  readonly batteryChargeStatus: string;
  readonly batteryLifePercent: number;
  readonly batteryLifeRemaining: number;
  readonly activePowerScheme: string;
  readonly isPluggedIn: boolean;
  readonly isCharging: boolean;
}

// ---- Registry ----

export type RegistryHive = "HKCU" | "HKLM" | "HKCR" | "HKU" | "HKCC";

export type RegistryValueType =
  | "REG_SZ"
  | "REG_EXPAND_SZ"
  | "REG_DWORD"
  | "REG_QWORD"
  | "REG_MULTI_SZ"
  | "REG_BINARY";

export interface RegistryValue {
  readonly hive: RegistryHive;
  readonly path: string;
  readonly name: string;
  readonly value: string | number | readonly string[];
  readonly valueType: RegistryValueType;
}

export interface RegistryKeyInfo {
  readonly hive: RegistryHive;
  readonly path: string;
  readonly exists: boolean;
  readonly subKeys: readonly string[];
  readonly values: readonly string[];
}

// ---- Services ----

export type ServiceStatus = "running" | "stopped" | "paused" | "start_pending" | "stop_pending";

export interface ServiceInfo {
  readonly name: string;
  readonly displayName: string;
  readonly status: ServiceStatus;
  readonly startType: "automatic" | "manual" | "disabled";
  /** Services the manager refuses to stop/restart without extra confirmation. */
  readonly critical: boolean;
}

// ---- Task Scheduler ----

export type ScheduledTaskState = "ready" | "running" | "disabled" | "queued" | "unknown";

export interface ScheduledTaskInfo {
  readonly taskName: string;
  readonly taskPath: string;
  readonly state: ScheduledTaskState;
  readonly description?: string | undefined;
  readonly author?: string | undefined;
  readonly actions?: string | undefined;
  readonly triggers?: string | undefined;
  readonly enabled: boolean;
}

export interface ScheduledTaskSpec {
  readonly taskName: string;
  readonly taskPath?: string | undefined;
  readonly executable: string;
  readonly arguments?: string | undefined;
  readonly description?: string | undefined;
}

// ---- Events ----

export type WindowsSystemEventType =
  | "process_started"
  | "process_exited"
  | "window_focus_changed"
  | "device_connected"
  | "device_disconnected"
  | "display_changed"
  | "clipboard_changed";

export interface WindowsSystemEvent {
  readonly type: WindowsSystemEventType;
  readonly at: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type WindowsEventHandler = (event: WindowsSystemEvent) => void;
export type Unsubscribe = () => void;

// ---- Performance ----

export interface PerformanceSample {
  readonly at: string;
  readonly cpuPercent: number;
  readonly memoryPercent: number;
  readonly diskIoPercent: number;
}

// ---- Network Configuration & Adapters ----

export interface NetworkAdapterDetail extends NetworkAdapterInfo {
  readonly macAddress?: string | undefined;
  readonly ifIndex?: number | undefined;
  readonly isActive?: boolean | undefined;
  readonly ipv4?: string | readonly string[] | undefined;
  readonly gateway?: string | null | undefined;
  readonly dnsServers?: readonly string[] | undefined;
  readonly dhcpEnabled?: boolean | undefined;
}

export interface NetworkConfigurationInfo {
  readonly interfaceAlias: string;
  readonly interfaceIndex: number;
  readonly description: string;
  readonly status: "up" | "down" | "disconnected";
  readonly macAddress?: string | undefined;
  readonly linkSpeed?: string | undefined;
  readonly ipv4Addresses: readonly string[];
  readonly ipv6Addresses: readonly string[];
  readonly defaultGateway?: string | null | undefined;
  readonly dnsServers: readonly string[];
  readonly dhcpEnabled: boolean;
  readonly isActive: boolean;
}

export interface DnsConfigurationInfo {
  readonly interfaceAlias: string;
  readonly interfaceIndex: number;
  readonly dnsServers: readonly string[];
  readonly connectionSpecificSuffix?: string | undefined;
  readonly registerThisConnectionsAddress?: boolean | undefined;
}

export interface StaticIpSpec {
  readonly interfaceAlias: string;
  readonly ipAddress: string;
  readonly prefixLength?: number | undefined;
  readonly defaultGateway?: string | undefined;
}

export interface DnsSpec {
  readonly interfaceAlias: string;
  readonly serverAddresses: readonly string[];
}

export interface NetworkRollbackState {
  readonly interfaceAlias: string;
  readonly dhcpEnabled: boolean;
  readonly ipAddresses: readonly string[];
  readonly defaultGateway?: string | null | undefined;
  readonly dnsServers: readonly string[];
}

// ---- Shell execution (used by the production PowerShell-backed API) ----

export interface ShellExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * The one seam `PowerShellWindowsSystemApi` uses to actually run a
 * command. Injected rather than shelling out with `child_process`
 * directly, matching every prior phase's hardware-adjacent injection
 * pattern (`HttpFetch`, `AudioDeviceSource`, `OnnxSession`, ...) — no
 * native Windows/PowerShell toolchain exists in this build environment,
 * so the default export never actually runs one; see `README.md`.
 */
export type ShellExec = (command: string) => Promise<ShellExecResult>;
