import type { Capability, CapabilityRequest } from "@ryper/security";

export interface FriendlyCapabilityPresentation {
  readonly title: string;
  readonly message: string;
  readonly category: string;
  readonly approveLabel: string;
  readonly denyLabel: string;
}

/**
 * Translates raw internal capability requests into consumer-friendly
 * presentation models. Strips actor IDs, internal capability enum keys,
 * IPC details, and developer jargon (P0-1).
 */
export function describeCapabilityRequest(
  request: CapabilityRequest,
): FriendlyCapabilityPresentation {
  const cap = request.capability;
  const just = (request.justification || "").toLowerCase();

  // Application Control / Launch
  if (
    cap === "automation.execute" &&
    (just.includes("application_control") ||
      just.includes("launch") ||
      just.includes("close") ||
      just.includes("restart") ||
      just.includes("app"))
  ) {
    return {
      title: "Permission needed",
      message:
        "RYPER wants to open an application on your computer.\n\nPermission: Application Control\n\nThis allows RYPER to open, close, or restart applications when you ask it to.",
      category: "Application Control",
      approveLabel: "Allow once",
      denyLabel: "Deny",
    };
  }

  // Window Management
  if (
    (cap === "automation.execute" || cap === "automation.read") &&
    (just.includes("window") ||
      just.includes("focus") ||
      just.includes("minimize") ||
      just.includes("maximize") ||
      just.includes("snap") ||
      just.includes("resize"))
  ) {
    return {
      title: "Permission needed",
      message:
        "RYPER wants to manage windows on your computer.\n\nPermission: Window Management\n\nThis allows RYPER to view, move, and organize open application windows.",
      category: "Window Management",
      approveLabel: "Allow once",
      denyLabel: "Deny",
    };
  }

  // General Automation Read
  if (cap === "automation.read") {
    return {
      title: "Permission needed",
      message:
        "RYPER wants to view application and system state on your computer.\n\nPermission: Automation Read\n\nThis allows RYPER to inspect running applications.",
      category: "Automation Read",
      approveLabel: "Allow once",
      denyLabel: "Deny",
    };
  }

  // General Automation Execute
  if (cap === "automation.execute") {
    return {
      title: "Permission needed",
      message:
        "RYPER wants to perform an automation action on your computer.\n\nPermission: Automation Control\n\nThis allows RYPER to interact with applications and desktop windows.",
      category: "Automation Control",
      approveLabel: "Allow once",
      denyLabel: "Deny",
    };
  }

  // Filesystem Read
  if (cap === "filesystem.read") {
    return {
      title: "Permission needed",
      message:
        "RYPER wants to view files or folders on your computer.\n\nPermission: File Access\n\nThis allows RYPER to read files when you ask it to.",
      category: "File Access",
      approveLabel: "Allow once",
      denyLabel: "Deny",
    };
  }

  // Filesystem Write
  if (cap === "filesystem.write") {
    return {
      title: "Permission needed",
      message:
        "RYPER wants to create or modify files on your computer.\n\nPermission: File Storage\n\nThis allows RYPER to save or update files when you ask it to.",
      category: "File Storage",
      approveLabel: "Allow once",
      denyLabel: "Deny",
    };
  }

  // Desktop Notifications
  if (cap === "notifications") {
    return {
      title: "Permission needed",
      message:
        "RYPER wants to show notifications on your desktop.\n\nPermission: Notifications\n\nThis allows RYPER to show alerts and system status updates.",
      category: "Notifications",
      approveLabel: "Allow once",
      denyLabel: "Deny",
    };
  }

  // System Power
  if (cap === "system.power") {
    return {
      title: "Permission needed",
      message:
        "RYPER wants permission to manage system power.\n\nPermission: Power Management\n\nThis allows RYPER to restart, shut down, or put your computer to sleep when requested.",
      category: "Power Management",
      approveLabel: "Allow once",
      denyLabel: "Deny",
    };
  }

  // Microphone
  if (cap === "microphone") {
    return {
      title: "Permission needed",
      message:
        "RYPER wants to access your microphone.\n\nPermission: Microphone\n\nThis allows RYPER to hear your voice commands.",
      category: "Microphone",
      approveLabel: "Allow once",
      denyLabel: "Deny",
    };
  }

  // Camera
  if (cap === "camera") {
    return {
      title: "Permission needed",
      message:
        "RYPER wants to access your camera.\n\nPermission: Camera\n\nThis allows RYPER to capture images or video when requested.",
      category: "Camera",
      approveLabel: "Allow once",
      denyLabel: "Deny",
    };
  }

  // Safe Generic Fallback
  return {
    title: "Permission needed",
    message: "RYPER needs your permission to perform this action on your computer.",
    category: "Desktop Action",
    approveLabel: "Allow once",
    denyLabel: "Deny",
  };
}

export interface PermissionStatusEntry {
  readonly id: string;
  readonly category: string;
  readonly description: string;
  readonly granted: boolean;
  readonly isSessionOnly: boolean;
}

export const KNOWN_PERMISSION_CATEGORIES: readonly {
  readonly capability: Capability;
  readonly category: string;
  readonly description: string;
}[] = [
  {
    capability: "automation.execute",
    category: "Application Control",
    description: "Allows RYPER to open, close, and control applications.",
  },
  {
    capability: "automation.read",
    category: "Window Management",
    description: "Allows RYPER to view and organize open application windows.",
  },
  {
    capability: "filesystem.read",
    category: "File Access",
    description: "Allows RYPER to view files and folder contents.",
  },
  {
    capability: "filesystem.write",
    category: "File Storage",
    description: "Allows RYPER to create and modify files.",
  },
  {
    capability: "notifications",
    category: "Notifications",
    description: "Allows RYPER to show native desktop toast alerts.",
  },
  {
    capability: "system.power",
    category: "Power Management",
    description: "Protected power actions (always requires per-action confirmation).",
  },
];
