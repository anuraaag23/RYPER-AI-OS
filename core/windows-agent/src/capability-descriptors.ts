import type { CapabilityDescriptor, CapabilityManager } from "@ryper/platform-capability";

const VERSION = "0.1.0";

/**
 * The `CapabilityDescriptor` for every domain the Windows Platform Agent
 * implements. Registering these with a `CapabilityManager` is what lets
 * `CapabilityManager.invoke()` run its permission-check/parameter-
 * validation pipeline before ever reaching `WindowsAdapter.invoke()` —
 * an unregistered domain still works (per PCL's design, a descriptor is
 * optional), it just skips that pipeline. `requiredCapability` is left
 * unset for domains with no matching entry in `@ryper/security`'s
 * `Capability` union (the same "partial by design" situation
 * `docs/adr/0006` documents for the Planner's `TASK_TYPE_TO_DOMAIN`) —
 * see `README.md`'s "Honest Limitations" section.
 */
export const WINDOWS_CAPABILITY_DESCRIPTORS: readonly CapabilityDescriptor[] = [
  {
    domain: "application_control",
    name: "Application Control",
    description: "Launch, close, restart, and enumerate Windows applications; open URLs and files.",
    version: VERSION,
  },
  {
    domain: "window_management",
    name: "Window Management",
    description: "Move, resize, snap, center, focus, and enumerate windows; read window metadata.",
    version: VERSION,
  },
  {
    domain: "clipboard",
    name: "Clipboard",
    description: "Read/write the Windows clipboard, read its history, and monitor for changes.",
    version: VERSION,
  },
  {
    domain: "notifications",
    name: "Notifications",
    description: "Show, update, and dismiss native Windows toast notifications.",
    version: VERSION,
    requiredCapability: "notifications",
  },
  {
    domain: "audio",
    name: "Audio",
    description:
      "Volume, mute, default device selection, device enumeration, and media playback controls.",
    version: VERSION,
  },
  {
    domain: "display",
    name: "Display",
    description: "Enumerate displays and read their configuration.",
    version: VERSION,
  },
  {
    domain: "filesystem",
    name: "Filesystem",
    description:
      "Browse, read, write, copy, move, rename, delete, create, and search files and folders.",
    version: VERSION,
    requiredCapability: "filesystem.write",
  },
  {
    domain: "device_information",
    name: "Device Information",
    description:
      "CPU/GPU/RAM/storage/battery/Windows version/installed applications/network status.",
    version: VERSION,
  },
  {
    domain: "process_management",
    name: "Process Management",
    description: "Enumerate, start, and (with confirmation) terminate OS processes.",
    version: VERSION,
    requiredCapability: "automation.execute",
  },
  {
    domain: "background_services",
    name: "Windows Services",
    description: "Enumerate and control Windows services (Service Control Manager).",
    version: VERSION,
    requiredCapability: "automation.execute",
  },
  {
    domain: "registry",
    name: "Windows Registry",
    description:
      "Read the Windows registry; write access is disabled unless explicitly authorized.",
    version: VERSION,
    requiredCapability: "automation.execute",
  },
  {
    domain: "security",
    name: "Windows Security",
    description: "Query and (via explicit user confirmation) request UAC elevation.",
    version: VERSION,
  },
  {
    domain: "diagnostics",
    name: "Windows Agent Diagnostics",
    description: "Structured logs, capability diagnostics, error reports, and health checks.",
    version: VERSION,
  },
  {
    domain: "performance_monitoring",
    name: "Windows Performance Monitoring",
    description: "CPU/memory/disk-I/O sampling and rolling performance summaries.",
    version: VERSION,
  },
];

/** Registers every descriptor above with a `CapabilityManager`, skipping ones already registered (idempotent). */
export function registerWindowsCapabilityDescriptors(manager: CapabilityManager): void {
  for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
    if (manager.registry.has(descriptor.domain)) continue;
    manager.registerCapability(descriptor);
  }
}
