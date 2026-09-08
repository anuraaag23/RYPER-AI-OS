import type { ToolSpec, ChatMessage, ToolSelector } from "@ryper/ai-engine";

const APP_WINDOW_TOOLS = new Set([
  "open_application",
  "close_application",
  "list_installed_applications",
  "list_running_applications",
  "list_windows",
  "get_window_info",
  "get_active_window",
  "focus_window",
  "minimize_window",
  "maximize_window",
  "restore_window",
  "snap_window",
  "switch_window",
  "open_url",
  "list_browsers",
  "launch_browser",
]);

const FILE_FOLDER_TOOLS = new Set([
  "open_folder",
  "open_file",
  "smart_open",
  "open_this",
  "list_files",
  "read_file",
  "search_files",
  "get_folder_path",
  "list_recent_files",
  "create_folder",
  "copy_file",
  "move_file",
  "rename_file",
  "delete_file",
  "open_application",
]);

const VOLUME_AUDIO_TOOLS = new Set([
  "volume_up",
  "volume_down",
  "set_volume",
  "mute",
  "unmute",
  "list_audio_devices",
]);

const POWER_SYSTEM_TOOLS = new Set([
  "get_power_status",
  "shutdown",
  "restart",
  "sleep",
  "lock_workstation",
  "cancel_shutdown",
  "get_system_info",
]);

const SYSTEM_INFO_TOOLS = new Set([
  "get_system_info",
  "list_displays",
  "list_audio_devices",
  "list_network_adapters",
  "list_devices",
  "list_processes",
]);

const NOTIFICATION_TRAY_TOOLS = new Set([
  "show_notification",
  "list_notifications",
  "get_tray_status",
  "update_tray_tooltip",
]);

const SERVICE_TOOLS = new Set([
  "list_services",
  "inspect_service",
  "get_service_status",
  "start_service",
  "stop_service",
  "restart_service",
]);

const TASK_SCHEDULER_TOOLS = new Set([
  "list_scheduled_tasks",
  "inspect_scheduled_task",
  "run_scheduled_task",
  "enable_scheduled_task",
  "disable_scheduled_task",
  "create_scheduled_task",
  "delete_scheduled_task",
]);

const REGISTRY_TOOLS = new Set([
  "inspect_registry_key",
  "get_registry_value",
  "list_registry_values",
  "set_registry_value",
  "delete_registry_key",
]);

const NETWORK_TOOLS = new Set([
  "get_network_configuration",
  "get_dns_configuration",
  "get_active_adapter",
  "enable_network_adapter",
  "disable_network_adapter",
  "set_dhcp",
  "set_static_ip",
  "set_dns",
]);

/**
 * Domain keywords mapped to their tool set.
 */
const DOMAIN_TRIGGERS: ReadonlyArray<{
  patterns: readonly RegExp[];
  tools: ReadonlySet<string>;
}> = [
  {
    patterns: [
      /\b(open|launch|start|run|close|quit|exit|kill|switch|focus|minimize|maximize|restore|snap)\b/i,
      /\b(window|windows|app|application|program|software)\b/i,
      /\b(chrome|edge|firefox|browser|notepad|calculator|cmd|powershell|terminal|explorer)\b/i,
      /\b(url|website|site|web|http|https)\b/i,
    ],
    tools: APP_WINDOW_TOOLS,
  },
  {
    patterns: [
      /\b(file|files|folder|folders|directory|dir|path)\b/i,
      /\b(downloads|documents|desktop|pictures|music|videos)\b/i,
      /\b(copy|move|rename|delete|read|search|find|create\s+folder|mkdir)\b/i,
      /\b(smart_open|open_this|recent)\b/i,
    ],
    tools: FILE_FOLDER_TOOLS,
  },
  {
    patterns: [
      /\b(volume|sound|audio|mute|unmute|louder|quieter|speakers?|headphones?)\b/i,
      /\b(awaj|aawaz|kam\s+karo|badhao)\b/i, // Hindi / Hinglish volume keywords
    ],
    tools: VOLUME_AUDIO_TOOLS,
  },
  {
    patterns: [
      /\b(battery|power|charge|charging|shutdown|shut\s*down|turn\s*off|restart|reboot|sleep|lock|workstation)\b/i,
      /\b(band\s+karo|chalu\s+karo)\b/i, // Hindi / Hinglish power keywords
    ],
    tools: POWER_SYSTEM_TOOLS,
  },
  {
    patterns: [
      /\b(system\s*info|cpu|ram|memory|specs|display|displays|monitor|monitors|screen|screens|process|processes|task\s*manager|hardware|specs)\b/i,
    ],
    tools: SYSTEM_INFO_TOOLS,
  },
  {
    patterns: [
      /\b(notification|notifications|notify|tray|tooltip|alert|alerts)\b/i,
    ],
    tools: NOTIFICATION_TRAY_TOOLS,
  },
  {
    patterns: [
      /\b(service|services|daemon|audiosrv|spooler|wuauserv)\b/i,
    ],
    tools: SERVICE_TOOLS,
  },
  {
    patterns: [
      /\b(scheduled\s*task|schedule|scheduler|task\s*scheduler|cron)\b/i,
    ],
    tools: TASK_SCHEDULER_TOOLS,
  },
  {
    patterns: [
      /\b(registry|regkey|hkcu|hklm|reg_sz|reg_dword)\b/i,
    ],
    tools: REGISTRY_TOOLS,
  },
  {
    patterns: [
      /\b(network|wifi|wi-fi|ethernet|ip\s*address|dns|dhcp|adapter|adapters|gateway)\b/i,
    ],
    tools: NETWORK_TOOLS,
  },
];

/**
 * Creates a domain-aware tool selector for desktop RYPER AI OS.
 *
 * When the user query is purely conversational or general knowledge
 * ("Hello", "Why is the sky blue?", "Explain quantum computing"):
 * Returns [] (0 tools). This drops prompt token prefill from ~4,150
 * tokens to ~40 tokens, eliminating 25+ seconds of latency.
 *
 * When the user query asks for system actions, computer control, or file/app manipulation:
 * Returns the relevant domain tool specs (~8-25 tools), keeping prompt tokens under 1,500
 * while preserving full tool calling fidelity.
 */
export function createDesktopToolSelector(): ToolSelector {
  return (
    userText: string,
    allTools: readonly ToolSpec[],
    messages: readonly ChatMessage[],
  ): readonly ToolSpec[] => {
    const text = userText.trim().toLowerCase();

    // Check if recent conversation history has tool interactions (e.g. multi-round turn or follow-up like "again")
    const hasRecentToolTurn = messages.some(
      (m) => m.role === "tool" || (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0),
    );

    const isFollowUp = /\b(again|repeat|once\s+more|phir\s+se|dobara)\b/i.test(text);

    // If it's a follow-up to a previous tool turn, include core action tools
    if (hasRecentToolTurn || isFollowUp) {
      const activeToolNames = new Set<string>([
        ...APP_WINDOW_TOOLS,
        ...FILE_FOLDER_TOOLS,
        ...VOLUME_AUDIO_TOOLS,
        ...POWER_SYSTEM_TOOLS,
      ]);
      return allTools.filter((t) => activeToolNames.has(t.name));
    }

    const matchedToolNames = new Set<string>();

    for (const trigger of DOMAIN_TRIGGERS) {
      if (trigger.patterns.some((p) => p.test(text))) {
        for (const name of trigger.tools) {
          matchedToolNames.add(name);
        }
      }
    }

    if (matchedToolNames.size === 0) {
      // Pure conversation or general knowledge: zero tools!
      return [];
    }

    return allTools.filter((t) => matchedToolNames.has(t.name));
  };
}
