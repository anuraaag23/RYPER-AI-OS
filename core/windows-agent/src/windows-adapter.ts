import type { EventBus } from "@ryper/event-bus";
import { createLogger } from "@ryper/logging";
import {
  UnsupportedCapabilityError,
  type AdapterInvocationContext,
  type CapabilityDescriptor,
  type CapabilityDomain,
  type DeviceInfo,
  type PlatformAdapter,
  type RuntimeLimitation,
} from "@ryper/platform-capability";
import { WINDOWS_CAPABILITY_DESCRIPTORS } from "./capability-descriptors.js";
import type { ApplicationManager } from "./application-manager.js";
import { createApplicationManager } from "./application-manager.js";
import type { AudioManager } from "./audio-manager.js";
import { createAudioManager } from "./audio-manager.js";
import type { BrowserResolver } from "./browser-resolver.js";
import { createBrowserResolver } from "./browser-resolver.js";
import type { ClipboardManager } from "./clipboard-manager.js";
import { createClipboardManager } from "./clipboard-manager.js";
import type { DestructiveActionGate } from "./confirmation.js";
import { createDestructiveActionGate, type DestructiveActionConfirmer } from "./confirmation.js";
import type { DeviceManager } from "./device-manager.js";
import { createDeviceManager } from "./device-manager.js";
import type { DiagnosticsManager } from "./diagnostics-manager.js";
import { createDiagnosticsManager } from "./diagnostics-manager.js";
import type { DisplayManager } from "./display-manager.js";
import { createDisplayManager } from "./display-manager.js";
import type { EventMonitor } from "./event-monitor.js";
import { createEventMonitor } from "./event-monitor.js";
import type { FileManager } from "./file-manager.js";
import { createFileManager } from "./file-manager.js";
import type { NotificationManager } from "./notification-manager.js";
import { createNotificationManager } from "./notification-manager.js";
import type { PermissionManager } from "./permission-manager.js";
import { createPermissionManager, type ElevationPrompt } from "./permission-manager.js";
import type { PerformanceMonitor } from "./performance-monitor.js";
import { createPerformanceMonitor } from "./performance-monitor.js";
import type { PowerManager } from "./power-manager.js";
import { createPowerManager } from "./power-manager.js";
import type { PathResolver } from "./path-resolver.js";
import { createPathResolver, looksLikeUrl, normalizeUrl } from "./path-resolver.js";
import type { ProcessManager } from "./process-manager.js";
import { createProcessManager } from "./process-manager.js";
import type { RegistryInterface } from "./registry-interface.js";
import { createRegistryInterface } from "./registry-interface.js";
import type { ServiceManager } from "./service-manager.js";
import { createServiceManager } from "./service-manager.js";
import type { TaskSchedulerManager } from "./task-scheduler-manager.js";
import { createTaskSchedulerManager } from "./task-scheduler-manager.js";
import { createTrayManager, type TrayManager } from "./tray-manager.js";
import { createNetworkManager, type NetworkManager } from "./network-manager.js";
import { createInMemoryWindowsSystemApi } from "./reference-system-api.js";
import type { WindowsVersionDetector } from "./version-detector.js";
import { createWindowsVersionDetector } from "./version-detector.js";
import type { WindowManager } from "./window-manager.js";
import { createWindowManager } from "./window-manager.js";
import type { WindowsPluginCapabilityRegistry } from "./plugin-extensions.js";
import { createWindowsPluginCapabilityRegistry } from "./plugin-extensions.js";
import type { WindowsSystemApi } from "./windows-system-api.js";
import type { RegistryHive, RegistryValue, WellKnownFolder, WindowSnapPosition } from "./types.js";

const log = createLogger("windows-agent:adapter");

export interface WindowsAdapterOptions {
  /** Defaults to a fresh `InMemoryWindowsSystemApi` — see `windows-system-api.ts`. */
  readonly systemApi?: WindowsSystemApi;
  readonly destructiveActionConfirmer?: DestructiveActionConfirmer;
  readonly elevationPrompt?: ElevationPrompt;
  readonly eventBus?: EventBus;
  /** Registry writes are refused unless this is explicitly `true` — see `registry-interface.ts`. */
  readonly allowRegistryWrites?: boolean;
  readonly pluginCapabilities?: WindowsPluginCapabilityRegistry;
  readonly diagnosticsHistorySize?: number;
  readonly performanceHistorySize?: number;
}

type OperationHandler = (
  parameters: Readonly<Record<string, unknown>>,
  context: AdapterInvocationContext,
) => Promise<unknown>;

type NotificationKindParam = "basic" | "progress" | "action" | "persistent";
type MediaControlActionParam = "play" | "pause" | "next" | "previous" | "stop";

function str(parameters: Readonly<Record<string, unknown>>, key: string): string {
  const value = parameters[key];
  if (typeof value !== "string") throw new Error(`parameter "${key}" must be a string`);
  return value;
}

function optStr(parameters: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = parameters[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`parameter "${key}" must be a string`);
  return value;
}

function num(parameters: Readonly<Record<string, unknown>>, key: string): number {
  const value = parameters[key];
  if (typeof value !== "number") throw new Error(`parameter "${key}" must be a number`);
  return value;
}

function optStrArray(
  parameters: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] | undefined {
  const value = parameters[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`parameter "${key}" must be an array of strings`);
  return value as readonly string[];
}

/**
 * The first production implementation of `@ryper/platform-capability`'s
 * `PlatformAdapter` contract. Every operation is dispatched to one of
 * the manager classes in this package, each of which only ever touches
 * the injected `WindowsSystemApi` — never a Windows API directly, and
 * nothing outside this package (per the brief) is allowed to call a
 * Windows API directly either: everything goes through
 * `CapabilityManager.invoke()` → this adapter.
 *
 * Construct via `WindowsAdapter.create()`, not `new` — creation is
 * async because it detects the Windows version up front (so `supports()`
 * can stay synchronous, as the `PlatformAdapter` contract requires) and
 * gracefully degrades unsupported-on-this-release operations from then on.
 */
export class WindowsAdapter implements PlatformAdapter {
  readonly platform = "windows" as const;
  readonly adapterVersion = "0.1.0";

  readonly systemApi: WindowsSystemApi;
  readonly versionDetector: WindowsVersionDetector;
  readonly processManager: ProcessManager;
  readonly windowManager: WindowManager;
  readonly applicationManager: ApplicationManager;
  readonly browserResolver: BrowserResolver;
  readonly fileManager: FileManager;
  readonly clipboardManager: ClipboardManager;
  readonly notificationManager: NotificationManager;
  readonly audioManager: AudioManager;
  readonly displayManager: DisplayManager;
  readonly deviceManager: DeviceManager;
  readonly registryInterface: RegistryInterface;
  readonly serviceManager: ServiceManager;
  readonly taskSchedulerManager: TaskSchedulerManager;
  readonly trayManager: TrayManager;
  readonly networkManager: NetworkManager;
  readonly permissionManager: PermissionManager;
  readonly eventMonitor: EventMonitor;
  readonly performanceMonitor: PerformanceMonitor;
  readonly diagnosticsManager: DiagnosticsManager;
  readonly pluginCapabilities: WindowsPluginCapabilityRegistry;
  readonly destructiveGate: DestructiveActionGate;
  readonly powerManager: PowerManager;
  readonly pathResolver: PathResolver;

  private readonly dispatch: ReadonlyMap<string, OperationHandler>;
  private readonly knownDomains: ReadonlySet<CapabilityDomain>;

  private constructor(deps: {
    readonly systemApi: WindowsSystemApi;
    readonly versionDetector: WindowsVersionDetector;
    readonly eventBus?: EventBus;
    readonly allowRegistryWrites: boolean;
    readonly destructiveActionConfirmer?: DestructiveActionConfirmer;
    readonly elevationPrompt?: ElevationPrompt;
    readonly pluginCapabilities: WindowsPluginCapabilityRegistry;
    readonly diagnosticsHistorySize?: number;
    readonly performanceHistorySize?: number;
  }) {
    this.systemApi = deps.systemApi;
    this.versionDetector = deps.versionDetector;
    this.destructiveGate = createDestructiveActionGate(deps.destructiveActionConfirmer);
    this.pluginCapabilities = deps.pluginCapabilities;

    this.processManager = createProcessManager(this.systemApi, this.destructiveGate);
    this.windowManager = createWindowManager(this.systemApi);
    this.browserResolver = createBrowserResolver(this.systemApi);
    this.applicationManager = createApplicationManager(this.systemApi, this.browserResolver);
    this.fileManager = createFileManager(this.systemApi, this.destructiveGate);
    this.clipboardManager = createClipboardManager(this.systemApi);
    this.notificationManager = createNotificationManager(this.systemApi);
    this.audioManager = createAudioManager(this.systemApi);
    this.displayManager = createDisplayManager(this.systemApi);
    this.deviceManager = createDeviceManager(this.systemApi);
    this.registryInterface = createRegistryInterface(this.systemApi, this.destructiveGate, {
      allowWrites: deps.allowRegistryWrites,
    });
    this.serviceManager = createServiceManager(this.systemApi, this.destructiveGate);
    this.taskSchedulerManager = createTaskSchedulerManager(this.systemApi, this.destructiveGate);
    this.trayManager = createTrayManager();
    this.networkManager = createNetworkManager(this.systemApi, this.destructiveGate);
    this.powerManager = createPowerManager(this.systemApi, this.destructiveGate);
    this.pathResolver = createPathResolver(this.systemApi);
    this.permissionManager = createPermissionManager(deps.elevationPrompt);
    this.eventMonitor = createEventMonitor(this.systemApi, deps.eventBus);
    this.performanceMonitor = createPerformanceMonitor(this.systemApi, deps.performanceHistorySize);
    this.diagnosticsManager = createDiagnosticsManager(
      this.systemApi,
      this.versionDetector,
      this.permissionManager,
      this.performanceMonitor,
      deps.diagnosticsHistorySize,
    );

    this.dispatch = this.buildDispatchTable();
    this.knownDomains = new Set(WINDOWS_CAPABILITY_DESCRIPTORS.map((d) => d.domain));
    this.eventMonitor.start();
  }

  static async create(options: WindowsAdapterOptions = {}): Promise<WindowsAdapter> {
    const systemApi = options.systemApi ?? createInMemoryWindowsSystemApi();
    const versionDetector = createWindowsVersionDetector(systemApi);
    const versionInfo = await versionDetector.detect(); // populate the cache so supports()/getRuntimeLimitations() can be synchronous

    const adapter = new WindowsAdapter({
      systemApi,
      versionDetector,
      allowRegistryWrites: options.allowRegistryWrites ?? false,
      pluginCapabilities: options.pluginCapabilities ?? createWindowsPluginCapabilityRegistry(),
      ...(options.eventBus ? { eventBus: options.eventBus } : {}),
      ...(options.destructiveActionConfirmer
        ? { destructiveActionConfirmer: options.destructiveActionConfirmer }
        : {}),
      ...(options.elevationPrompt ? { elevationPrompt: options.elevationPrompt } : {}),
      ...(options.diagnosticsHistorySize !== undefined
        ? { diagnosticsHistorySize: options.diagnosticsHistorySize }
        : {}),
      ...(options.performanceHistorySize !== undefined
        ? { performanceHistorySize: options.performanceHistorySize }
        : {}),
    });
    log.info("Windows Platform Agent initialized", {
      release: versionInfo.release,
      build: versionInfo.buildNumber,
    });
    return adapter;
  }

  private buildDispatchTable(): ReadonlyMap<string, OperationHandler> {
    const table = new Map<string, OperationHandler>();
    const add = (domain: string, operation: string, handler: OperationHandler): void => {
      table.set(`${domain}.${operation}`, handler);
    };

    // application_control
    add("application_control", "launch", async (p) =>
      this.applicationManager.launch(str(p, "appId"), optStrArray(p, "args")),
    );
    add("application_control", "close", async (p) =>
      this.applicationManager.close(str(p, "appId")),
    );
    add("application_control", "restart", async (p) =>
      this.applicationManager.restart(str(p, "appId")),
    );
    add("application_control", "enumerate_installed", async () =>
      this.applicationManager.listInstalled(),
    );
    add("application_control", "enumerate_running", async () =>
      this.applicationManager.listRunning(),
    );
    add("application_control", "open_url", async (p) =>
      this.applicationManager.openUrl(str(p, "url"), optStr(p, "browserId")),
    );
    add("application_control", "open_file", async (p) =>
      this.applicationManager.openFile(str(p, "path")),
    );
    add("application_control", "open_folder", async (p) =>
      this.systemApi.openFolder(str(p, "path")),
    );
    add("application_control", "list_browsers", async () => this.applicationManager.listBrowsers());
    add("application_control", "launch_browser", async (p) =>
      this.applicationManager.launchBrowser(str(p, "browserId")),
    );
    add("application_control", "smart_open", async (p) =>
      this.smartOpen(str(p, "target"), optStr(p, "browserId")),
    );

    // window_management
    add("window_management", "enumerate", async () => this.windowManager.list());
    add("window_management", "get_active", async () => this.windowManager.getActive());
    add("window_management", "get_metadata", async (p) => this.windowManager.get(str(p, "handle")));
    add("window_management", "focus", async (p) => this.windowManager.focus(str(p, "handle")));
    add("window_management", "foreground", async (p) => this.windowManager.focus(str(p, "handle")));
    add("window_management", "minimize", async (p) =>
      this.windowManager.minimize(str(p, "handle")),
    );
    add("window_management", "maximize", async (p) =>
      this.windowManager.maximize(str(p, "handle")),
    );
    add("window_management", "restore", async (p) => this.windowManager.restore(str(p, "handle")));
    add("window_management", "move", async (p) =>
      this.windowManager.move(str(p, "handle"), num(p, "x"), num(p, "y")),
    );
    add("window_management", "resize", async (p) =>
      this.windowManager.resize(str(p, "handle"), num(p, "width"), num(p, "height")),
    );
    add("window_management", "snap", async (p) =>
      this.windowManager.snap(str(p, "handle"), str(p, "position") as WindowSnapPosition),
    );
    add("window_management", "center", async (p) => this.windowManager.center(str(p, "handle")));
    add("window_management", "switch_active", async () => this.windowManager.switchToNext());

    // clipboard
    add("clipboard", "read", async () => this.clipboardManager.read());
    add("clipboard", "write", async (p) =>
      this.clipboardManager.write({
        format: (p.format as "text" | "html" | "image-ref" | "files") ?? "text",
        value: str(p, "value"),
      }),
    );
    add("clipboard", "history", async () => this.clipboardManager.history());

    // notifications
    add("notifications", "show", async (p) =>
      this.notificationManager.show({
        title: str(p, "title"),
        body: str(p, "body"),
        kind: (p.kind as NotificationKindParam) ?? "basic",
        ...(p.progressPercent !== undefined ? { progressPercent: num(p, "progressPercent") } : {}),
      }),
    );
    add("notifications", "update", async (p) =>
      this.notificationManager.update(str(p, "id"), {
        title: str(p, "title"),
        body: str(p, "body"),
        kind: (p.kind as NotificationKindParam) ?? "basic",
        ...(p.progressPercent !== undefined ? { progressPercent: num(p, "progressPercent") } : {}),
      }),
    );
    add("notifications", "dismiss", async (p) => this.notificationManager.dismiss(str(p, "id")));
    add("notifications", "list", async () => this.notificationManager.list());
    add("notifications", "list_notifications", async () => this.notificationManager.list());
    add("notifications", "get", async (p) => this.notificationManager.get(str(p, "id")));
    add("notifications", "get_notification", async (p) => this.notificationManager.get(str(p, "id")));
    add("notifications", "inspect_notification", async (p) => this.notificationManager.get(str(p, "id")));

    // system_tray
    add("system_tray", "get_status", async () => this.trayManager.getStatus());
    add("system_tray", "get_state", async () => this.trayManager.getStatus());
    add("system_tray", "inspect", async () => this.trayManager.getStatus());
    add("system_tray", "update_tooltip", async (p) => {
      await this.trayManager.setTooltip(str(p, "tooltip"));
      return { ok: true, tooltip: str(p, "tooltip") };
    });
    add("system_tray", "update_tray", async (p) => {
      await this.trayManager.setTooltip(str(p, "tooltip"));
      return { ok: true, tooltip: str(p, "tooltip") };
    });
    add("system_tray", "destroy", async () => {
      await this.trayManager.destroy();
      return { ok: true };
    });

    // audio
    add("audio", "get_volume", async () => this.audioManager.getVolume());
    add("audio", "set_volume", async (p) => this.audioManager.setVolume(num(p, "level")));
    add("audio", "get_mute", async () => this.audioManager.getMute());
    add("audio", "set_mute", async (p) => this.audioManager.setMute(Boolean(p.muted)));
    add("audio", "get_media_state", async () => this.audioManager.getNowPlayingState());
    add("audio", "list_devices", async () => this.audioManager.listDevices());
    add("audio", "set_default_device", async (p) =>
      this.audioManager.setDefaultDevice(str(p, "id")),
    );
    add("audio", "media_control", async (p) =>
      this.audioManager.mediaControl(str(p, "action") as MediaControlActionParam),
    );

    // display
    add("display", "list", async () => this.displayManager.list());
    add("display", "get_primary", async () => this.displayManager.getPrimary());

    // filesystem
    add("filesystem", "list", async (p) =>
      this.fileManager.browse(str(p, "path"), (p.filter ?? p.pattern) as string | undefined),
    );
    add("filesystem", "list_directory", async (p) =>
      this.fileManager.browse(str(p, "path"), (p.filter ?? p.pattern) as string | undefined),
    );
    add("filesystem", "read", async (p) => this.fileManager.read(str(p, "path")));
    add("filesystem", "write", async (p) =>
      this.fileManager.write(str(p, "path"), str(p, "content")),
    );
    add("filesystem", "copy", async (p) =>
      this.fileManager.copy(str(p, "sourcePath"), str(p, "destinationPath")),
    );
    add("filesystem", "move", async (p) =>
      this.fileManager.move(str(p, "sourcePath"), str(p, "destinationPath")),
    );
    add("filesystem", "rename", async (p) =>
      this.fileManager.rename(str(p, "path"), str(p, "newName")),
    );
    add("filesystem", "delete", async (p) => this.fileManager.delete(str(p, "path")));
    add("filesystem", "create_folder", async (p) => this.fileManager.createFolder(str(p, "path")));
    add("filesystem", "search", async (p) =>
      this.fileManager.search(str(p, "query"), p.rootPath as string | undefined),
    );
    add("filesystem", "recent", async () => this.fileManager.recent());
    add("filesystem", "well_known_folder", async (p) =>
      this.fileManager.wellKnownFolder(str(p, "folder") as WellKnownFolder),
    );

    // device_information
    add("device_information", "get_system_info", async () => this.deviceManager.getSystemInfo());
    add("device_information", "get_windows_version", async () => this.versionDetector.detect());
    add("device_information", "list_devices", async () => this.deviceManager.listDevices());
    add("device_information", "list_network_adapters", async () =>
      this.deviceManager.listNetworkAdapters(),
    );
    add("device_information", "list_installed_applications", async () =>
      this.applicationManager.listInstalled(),
    );

    // process_management
    add("process_management", "list", async () => this.processManager.list());
    add("process_management", "get", async (p) => this.processManager.get(num(p, "pid")));
    add("process_management", "kill", async (p) =>
      this.processManager.kill(num(p, "pid"), { force: Boolean(p.force) }),
    );
    add("process_management", "restart", async (p) => this.processManager.restart(num(p, "pid")));

    // background_services
    const listSvc = async () => this.serviceManager.list();
    add("background_services", "list", listSvc);
    add("background_services", "list_services", listSvc);

    const getSvc = async (p: Record<string, unknown>) => this.serviceManager.get(str(p, "name"));
    add("background_services", "get", getSvc);
    add("background_services", "get_service", getSvc);
    add("background_services", "inspect_service", getSvc);

    const statusSvc = async (p: Record<string, unknown>) => this.serviceManager.status(str(p, "name"));
    add("background_services", "status", statusSvc);
    add("background_services", "get_service_status", statusSvc);

    const startSvc = async (p: Record<string, unknown>) => this.serviceManager.start(str(p, "name"));
    add("background_services", "start", startSvc);
    add("background_services", "start_service", startSvc);

    const stopSvc = async (p: Record<string, unknown>) => this.serviceManager.stop(str(p, "name"));
    add("background_services", "stop", stopSvc);
    add("background_services", "stop_service", stopSvc);

    const restartSvc = async (p: Record<string, unknown>) => this.serviceManager.restart(str(p, "name"));
    add("background_services", "restart", restartSvc);
    add("background_services", "restart_service", restartSvc);

    const pauseSvc = async (p: Record<string, unknown>) => this.serviceManager.pause(str(p, "name"));
    add("background_services", "pause", pauseSvc);
    add("background_services", "pause_service", pauseSvc);

    const resumeSvc = async (p: Record<string, unknown>) => this.serviceManager.resume(str(p, "name"));
    add("background_services", "resume", resumeSvc);
    add("background_services", "resume_service", resumeSvc);

    const deleteSvc = async (p: Record<string, unknown>) => this.serviceManager.delete(str(p, "name"));
    add("background_services", "delete", deleteSvc);
    add("background_services", "delete_service", deleteSvc);
    add("background_services", "remove_service", deleteSvc);

    // task_scheduler
    const listTasks = async (p: Record<string, unknown>) =>
      this.taskSchedulerManager.list(typeof p["folderPath"] === "string" ? p["folderPath"] : undefined);
    add("task_scheduler", "list", listTasks);
    add("task_scheduler", "list_scheduled_tasks", listTasks);
    add("background_services", "list_scheduled_tasks", listTasks);

    const getTask = async (p: Record<string, unknown>) =>
      this.taskSchedulerManager.get(
        str(p, "name"),
        typeof p["folderPath"] === "string" ? p["folderPath"] : undefined,
      );
    add("task_scheduler", "get", getTask);
    add("task_scheduler", "get_scheduled_task", getTask);
    add("task_scheduler", "inspect_scheduled_task", getTask);
    add("background_services", "get_scheduled_task", getTask);
    add("background_services", "inspect_scheduled_task", getTask);

    const runTask = async (p: Record<string, unknown>) =>
      this.taskSchedulerManager.run(
        str(p, "name"),
        typeof p["folderPath"] === "string" ? p["folderPath"] : undefined,
      );
    add("task_scheduler", "run", runTask);
    add("task_scheduler", "run_scheduled_task", runTask);
    add("background_services", "run_scheduled_task", runTask);

    const enableTask = async (p: Record<string, unknown>) =>
      this.taskSchedulerManager.enable(
        str(p, "name"),
        typeof p["folderPath"] === "string" ? p["folderPath"] : undefined,
      );
    add("task_scheduler", "enable", enableTask);
    add("task_scheduler", "enable_scheduled_task", enableTask);
    add("background_services", "enable_scheduled_task", enableTask);

    const disableTask = async (p: Record<string, unknown>) =>
      this.taskSchedulerManager.disable(
        str(p, "name"),
        typeof p["folderPath"] === "string" ? p["folderPath"] : undefined,
      );
    add("task_scheduler", "disable", disableTask);
    add("task_scheduler", "disable_scheduled_task", disableTask);
    add("background_services", "disable_scheduled_task", disableTask);

    const createTask = async (p: Record<string, unknown>) =>
      this.taskSchedulerManager.create({
        taskName: str(p, "name"),
        taskPath: typeof p["folderPath"] === "string" ? p["folderPath"] : undefined,
        executable: str(p, "executable"),
        arguments: typeof p["arguments"] === "string" ? p["arguments"] : undefined,
        description: typeof p["description"] === "string" ? p["description"] : undefined,
      });
    add("task_scheduler", "create", createTask);
    add("task_scheduler", "create_scheduled_task", createTask);
    add("task_scheduler", "register_scheduled_task", createTask);
    add("background_services", "create_scheduled_task", createTask);

    const deleteTask = async (p: Record<string, unknown>) =>
      this.taskSchedulerManager.delete(
        str(p, "name"),
        typeof p["folderPath"] === "string" ? p["folderPath"] : undefined,
      );
    add("task_scheduler", "delete", deleteTask);
    add("task_scheduler", "delete_scheduled_task", deleteTask);
    add("task_scheduler", "unregister_scheduled_task", deleteTask);
    add("background_services", "delete_scheduled_task", deleteTask);

    // power_management (see docs/adr/0030) — every operation is
    // destructive/system-impacting and routes through the same
    // `PowerManager` -> `DestructiveActionGate` real confirmation gate
    // `filesystem.delete` above already relies on. `context.signal` is
    // threaded through so an in-flight confirmation wait can still be
    // cancelled before the real, irreversible `systemApi` call — see
    // `PowerManager`'s doc comment.
    add("power_management", "get_power_status", async () => this.powerManager.getPowerStatus());
    add("power_management", "get_battery_status", async () => this.powerManager.getBatteryStatus());
    add("power_management", "get_power_plan", async () => this.powerManager.getPowerPlan());
    add("power_management", "get_system_power_state", async () => this.powerManager.getSystemPowerState());
    add("power_management", "lock", async (_p, ctx) => this.powerManager.lock(ctx.signal));
    add("power_management", "shutdown", async (_p, ctx) => this.powerManager.shutdown(ctx.signal));
    add("power_management", "restart", async (_p, ctx) => this.powerManager.restart(ctx.signal));
    add("power_management", "sleep", async (_p, ctx) => this.powerManager.sleep(ctx.signal));
    add("power_management", "hibernate", async (_p, ctx) => this.powerManager.hibernate(ctx.signal));
    add("power_management", "sign_out", async (_p, ctx) => this.powerManager.signOut(ctx.signal));
    add("power_management", "cancel_shutdown", async () => this.powerManager.cancelShutdown());

    // registry
    const readReg = async (p: Record<string, unknown>) =>
      this.registryInterface.readValue(
        str(p, "hive") as RegistryHive,
        str(p, "path"),
        str(p, "name"),
      );
    add("registry", "read", readReg);
    add("registry", "get_registry_value", readReg);

    const listReg = async (p: Record<string, unknown>) =>
      this.registryInterface.listValues(str(p, "hive") as RegistryHive, str(p, "path"));
    add("registry", "list", listReg);
    add("registry", "list_registry_values", listReg);

    const inspectKey = async (p: Record<string, unknown>) =>
      this.registryInterface.inspectKey(str(p, "hive") as RegistryHive, str(p, "path"));
    add("registry", "inspect_key", inspectKey);
    add("registry", "inspect_registry_key", inspectKey);

    const writeReg = async (p: Record<string, unknown>) => {
      const regVal: RegistryValue = {
        hive: str(p, "hive") as RegistryHive,
        path: str(p, "path"),
        name: str(p, "name"),
        value: p.value as string | number | readonly string[],
        valueType: (p.valueType as any) ?? "REG_SZ",
      };
      return this.registryInterface.writeValue(regVal);
    };
    add("registry", "write", writeReg);
    add("registry", "set_registry_value", writeReg);

    const deleteVal = async (p: Record<string, unknown>) =>
      this.registryInterface.deleteValue(
        str(p, "hive") as RegistryHive,
        str(p, "path"),
        str(p, "name"),
      );
    add("registry", "delete_value", deleteVal);
    add("registry", "delete_registry_value", deleteVal);

    const deleteKey = async (p: Record<string, unknown>) =>
      this.registryInterface.deleteKey(str(p, "hive") as RegistryHive, str(p, "path"));
    add("registry", "delete_key", deleteKey);
    add("registry", "delete_registry_key", deleteKey);

    // security
    add("security", "is_elevated", async () => this.permissionManager.isElevated());
    add("security", "request_elevation", async (p) =>
      this.permissionManager.requestElevation(str(p, "reason")),
    );
    add("security", "elevation_history", async () => this.permissionManager.elevationHistory());

    // diagnostics
    add("diagnostics", "health_check", async () => this.diagnosticsManager.healthCheck());
    add("diagnostics", "recent_invocations", async (p) =>
      this.diagnosticsManager.recentInvocations(typeof p.limit === "number" ? p.limit : undefined),
    );
    add("diagnostics", "error_report", async (p) =>
      this.diagnosticsManager.errorReport(typeof p.limit === "number" ? p.limit : undefined),
    );

    // performance_monitoring
    add("performance_monitoring", "sample", async () => this.performanceMonitor.sample());
    add("performance_monitoring", "summary", async () => this.performanceMonitor.summary());
    add("performance_monitoring", "history", async () => this.performanceMonitor.history());

    // networking
    const listAdapters = async () => this.networkManager.listAdapters();
    add("networking", "list_adapters", listAdapters);
    add("networking", "list_network_adapters", listAdapters);

    const getAdapter = async (p: Record<string, unknown>) => {
      const ifAlias = optStr(p, "interfaceAlias") ?? optStr(p, "alias") ?? str(p, "name");
      return this.networkManager.getAdapter(ifAlias);
    };
    add("networking", "get_adapter", getAdapter);

    const getNetConfig = async (p: Record<string, unknown>) => {
      const ifAlias = optStr(p, "interfaceAlias") ?? optStr(p, "alias") ?? optStr(p, "name");
      return this.networkManager.getNetworkConfiguration(ifAlias);
    };
    add("networking", "get_network_configuration", getNetConfig);
    add("networking", "get_ip_configuration", getNetConfig);
    add("networking", "inspect_interface", getNetConfig);

    const getDnsConfig = async (p: Record<string, unknown>) => {
      const ifAlias = optStr(p, "interfaceAlias") ?? optStr(p, "alias") ?? optStr(p, "name");
      return this.networkManager.getDnsConfiguration(ifAlias);
    };
    add("networking", "get_dns_configuration", getDnsConfig);

    add("networking", "get_network_status", async () => this.networkManager.getNetworkStatus());
    add("networking", "get_active_adapter", async () => this.networkManager.getActiveAdapter());

    const enableAdapter = async (p: Record<string, unknown>, ctx: AdapterInvocationContext) => {
      const ifAlias = optStr(p, "interfaceAlias") ?? optStr(p, "alias") ?? str(p, "name");
      return this.networkManager.enableAdapter(ifAlias, ctx.signal);
    };
    add("networking", "enable_adapter", enableAdapter);
    add("networking", "enable_network_adapter", enableAdapter);

    const disableAdapter = async (p: Record<string, unknown>, ctx: AdapterInvocationContext) => {
      const ifAlias = optStr(p, "interfaceAlias") ?? optStr(p, "alias") ?? str(p, "name");
      return this.networkManager.disableAdapter(ifAlias, ctx.signal);
    };
    add("networking", "disable_adapter", disableAdapter);
    add("networking", "disable_network_adapter", disableAdapter);

    const setDhcp = async (p: Record<string, unknown>, ctx: AdapterInvocationContext) => {
      const ifAlias = optStr(p, "interfaceAlias") ?? optStr(p, "alias") ?? str(p, "name");
      return this.networkManager.setDhcp(ifAlias, ctx.signal);
    };
    add("networking", "set_dhcp", setDhcp);

    const setStaticIp = async (p: Record<string, unknown>, ctx: AdapterInvocationContext) => {
      const spec = {
        interfaceAlias: optStr(p, "interfaceAlias") ?? optStr(p, "alias") ?? str(p, "name"),
        ipAddress: str(p, "ipAddress"),
        prefixLength: typeof p["prefixLength"] === "number" ? p["prefixLength"] : undefined,
        defaultGateway: optStr(p, "defaultGateway"),
      };
      return this.networkManager.setStaticIp(spec, ctx.signal);
    };
    add("networking", "set_static_ip", setStaticIp);

    const setDns = async (p: Record<string, unknown>, ctx: AdapterInvocationContext) => {
      const spec = {
        interfaceAlias: optStr(p, "interfaceAlias") ?? optStr(p, "alias") ?? str(p, "name"),
        serverAddresses: (optStrArray(p, "servers") ?? optStrArray(p, "dnsServers") ?? optStrArray(p, "serverAddresses")) ?? [],
      };
      return this.networkManager.setDns(spec, ctx.signal);
    };
    add("networking", "set_dns", setDns);

    add("networking", "renew_dhcp", async (p) => {
      const ifAlias = optStr(p, "interfaceAlias") ?? optStr(p, "alias") ?? optStr(p, "name");
      return this.networkManager.renewDhcp(ifAlias);
    });
    add("networking", "release_dhcp", async (p, ctx) => {
      const ifAlias = optStr(p, "interfaceAlias") ?? optStr(p, "alias") ?? optStr(p, "name");
      return this.networkManager.releaseDhcp(ifAlias, ctx.signal);
    });
    add("networking", "reset_adapter", async (p, ctx) => {
      const ifAlias = optStr(p, "interfaceAlias") ?? optStr(p, "alias") ?? str(p, "name");
      return this.networkManager.resetAdapter(ifAlias, ctx.signal);
    });

    return table;
  }

  /**
   * The brief's PART 1D "single higher-level tool that can distinguish
   * URL / existing file / existing directory" (`smart_open`).
   * Deterministic classification, never an LLM guess:
   *
   * 1. `looksLikeUrl(target)` — a real, conservative pattern match
   *    (`http(s)://...` or a bare domain-looking string), not a
   *    heuristic the model itself decides.
   * 2. Otherwise, resolve known-folder free text ("my downloads
   *    folder") or a literal path (quotes stripped, `%USERPROFILE%`
   *    expanded) via `pathResolver`, then ask the real filesystem which
   *    of file/folder it actually is — `listDirectory` succeeding means
   *    "folder"; failing falls through to `openFile`, whose own real
   *    "no file at this path" error is what surfaces if the target
   *    genuinely doesn't exist as either. No path is ever guessed to be
   *    a file vs. folder without asking the real system.
   */
  private async smartOpen(
    target: string,
    browserId?: string,
  ): Promise<{ readonly kind: "url" | "file" | "folder"; readonly target: string }> {
    if (looksLikeUrl(target)) {
      const url = normalizeUrl(target);
      await this.applicationManager.openUrl(url, browserId);
      return { kind: "url", target: url };
    }

    const knownFolder = await this.pathResolver.resolveKnownFolder(target);
    const resolvedPath = knownFolder ?? (await this.pathResolver.resolvePath(target));

    try {
      await this.fileManager.browse(resolvedPath);
      await this.systemApi.openFolder(resolvedPath);
      return { kind: "folder", target: resolvedPath };
    } catch {
      // Not a directory (or `browse` failed for some other reason) —
      // try it as a file next; if it's neither, `openFile`'s own real
      // "no file at this path" error is the honest final answer.
      await this.applicationManager.openFile(resolvedPath);
      return { kind: "file", target: resolvedPath };
    }
  }

  supports(domain: CapabilityDomain): boolean {
    if (this.knownDomains.has(domain)) return true;
    return this.pluginCapabilities.list().some((ext) => ext.domain === domain);
  }

  describeCapability(domain: CapabilityDomain): CapabilityDescriptor | undefined {
    return WINDOWS_CAPABILITY_DESCRIPTORS.find((d) => d.domain === domain);
  }

  async invoke(
    domain: CapabilityDomain,
    operation: string,
    parameters: Readonly<Record<string, unknown>>,
    context: AdapterInvocationContext,
  ): Promise<unknown> {
    const key = `${domain}.${operation}`;
    const startedAt = Date.now();

    if (!this.versionDetector.supportsOperation(key)) {
      const version = await this.versionDetector.detect();
      const durationMs = Date.now() - startedAt;
      const errorMessage = `"${key}" is not available on ${version.displayName}`;
      this.diagnosticsManager.record({ domain, operation, ok: false, durationMs, errorMessage });
      throw new UnsupportedCapabilityError(errorMessage);
    }

    const handler =
      this.dispatch.get(key) ?? this.pluginCapabilities.get(domain, operation)?.handler;

    if (!handler) {
      const durationMs = Date.now() - startedAt;
      const errorMessage = `capability "${key}" is not implemented by the Windows Platform Agent`;
      this.diagnosticsManager.record({ domain, operation, ok: false, durationMs, errorMessage });
      throw new UnsupportedCapabilityError(errorMessage);
    }

    try {
      const result = await handler(parameters, context);
      const durationMs = Date.now() - startedAt;
      this.diagnosticsManager.record({ domain, operation, ok: true, durationMs });
      return result;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      this.diagnosticsManager.record({
        domain,
        operation,
        ok: false,
        durationMs,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  getDeviceInfo(): DeviceInfo {
    // Synchronous per the PlatformAdapter contract; relies on WindowsAdapter.create()
    // having already resolved the version detector's cache.
    const cachedVersion = this.versionDetector.cachedVersion();
    return {
      platform: "windows",
      platformVersion: cachedVersion?.displayName ?? "unknown",
      deviceType: "desktop",
      hardwareFeatures: ["audio", "display", "clipboard", "filesystem", "registry"],
    };
  }

  getRuntimeLimitations(): readonly RuntimeLimitation[] {
    const limitations: RuntimeLimitation[] = [];
    const cachedVersion = this.versionDetector.cachedVersion();
    if (!cachedVersion) {
      return [{ domain: "*", reason: "Windows version has not been detected yet" }];
    }
    if (cachedVersion.release === "unsupported") {
      limitations.push({
        domain: "*",
        reason: `Windows build ${cachedVersion.buildNumber} is not a supported release (only Windows 10 and Windows 11 are supported)`,
      });
    }
    if (cachedVersion.release === "windows-10") {
      limitations.push({
        domain: "clipboard",
        reason: "Clipboard History (Win+V) is treated as unavailable on Windows 10 in this adapter",
      });
      limitations.push({
        domain: "window_management",
        reason:
          "Windows 11 snap-layout flyout is unavailable; basic snapping to screen halves/quarters still works",
      });
    }
    limitations.push({
      domain: "registry",
      reason:
        "registry writes are disabled by default; construct the adapter with { allowRegistryWrites: true } to enable them",
    });
    return limitations;
  }
}

export async function createWindowsAdapter(
  options?: WindowsAdapterOptions,
): Promise<WindowsAdapter> {
  return WindowsAdapter.create(options);
}
