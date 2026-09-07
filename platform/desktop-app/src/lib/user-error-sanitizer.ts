const TOOL_FRIENDLY_NAMES: Record<string, string> = {
  open_application: "opening the application",
  system_run_app: "opening the application",
  close_application: "closing the application",
  get_power_info: "checking battery and power status",
  system_power_query: "checking battery and power status",
  system_power_set: "performing power action",
  volume_up: "adjusting volume",
  volume_down: "adjusting volume",
  set_volume: "adjusting volume",
  system_volume_set: "adjusting volume",
  system_volume_query: "checking volume",
  mute: "muting audio",
  unmute: "unmuting audio",
  list_files: "checking files",
  read_file: "reading the file",
  read_text_file: "reading the file",
  search_files: "searching files",
  file_search: "searching files",
  get_folder_path: "checking the folder",
  list_windows: "checking open windows",
  focus_window: "switching windows",
  switch_window: "switching windows",
  get_active_window: "checking the active window",
  get_system_info: "checking system info",
  list_displays: "checking displays",
  list_devices: "checking devices",
  open_url: "opening the link",
  system_browser_open: "opening the web browser",
  system_clipboard_read: "reading the clipboard",
  system_clipboard_write: "copying to clipboard",
  device_media_control: "controlling media playback",
  smart_open: "opening the requested item",
};

export interface SanitizedError {
  readonly message: string;
  readonly canRetry: boolean;
}

/**
 * Sanitizes user-facing errors for the chat interface (P1-2).
 * Eliminates all raw internal technical strings:
 * - ProviderError, llama-cpp-local, IPC channel names, actor IDs
 * - Filesystem paths, stack traces, port numbers, URLs
 * - Capability names
 *
 * Protects against repeating already-executed Windows actions:
 * If an action already succeeded before an error occurred, explains what
 * succeeded and disallows automatic retry.
 */
export function sanitizeUserFacingError(rawError: unknown): SanitizedError {
  const rawMsg =
    rawError instanceof Error
      ? rawError.message
      : typeof rawError === "string"
        ? rawError
        : String(rawError ?? "");

  // 1. Action already completed on Windows
  if (rawMsg.startsWith("action_completed:")) {
    const parts = rawMsg.split(":");
    const toolName = parts[1] ?? "";
    const fallback = toolName ? toolName.replace(/^system_/, "").replace(/_/g, " ") : "the requested action";
    const friendly = TOOL_FRIENDLY_NAMES[toolName] ?? fallback;
    return {
      message: `The action was performed (${friendly}), but RYPER couldn't generate a summary.`,
      canRetry: false,
    };
  }

  const lowered = rawMsg.toLowerCase();

  // 2. Cancellation
  if (lowered.includes("abort") || lowered.includes("cancelled")) {
    return {
      message: "Request was cancelled.",
      canRetry: false,
    };
  }

  // 3. Local AI server offline / disconnected / connection refused
  if (
    lowered.includes("econnrefused") ||
    lowered.includes("fetch failed") ||
    lowered.includes("failed to fetch") ||
    lowered.includes("llama-cpp") ||
    lowered.includes("8090") ||
    lowered.includes("not responding") ||
    lowered.includes("connection refused")
  ) {
    return {
      message: "RYPER couldn't complete that request. The local AI isn't responding right now.",
      canRetry: true,
    };
  }

  // 4. Overload / rate limit / cloud unavailable
  if (
    lowered.includes("rate limit") ||
    lowered.includes("quota") ||
    lowered.includes("429") ||
    lowered.includes("overloaded") ||
    lowered.includes("503")
  ) {
    return {
      message: "RYPER couldn't complete that request. The AI service is currently unavailable.",
      canRetry: true,
    };
  }

  // 5. Generic / fallback error
  return {
    message: "RYPER couldn't complete that request.",
    canRetry: true,
  };
}
