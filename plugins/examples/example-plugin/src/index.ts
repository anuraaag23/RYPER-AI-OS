import { definePlugin } from "@ryper/plugin-sdk";

/**
 * Mirrors the exact example from the Phase 1 Automation Engine spec:
 * "IF new PDF appears THEN summarize, rename, archive, notify user."
 * The handler is intentionally simple and dependency-free — it demonstrates
 * the plugin contract, not a production document pipeline (that lives in
 * @ryper/documents).
 */
export interface NewFileEvent {
  readonly path: string;
  readonly extension: string;
}

export interface ProcessResult {
  readonly summary: string;
  readonly renamedTo: string;
  readonly notified: boolean;
}

function summarize(path: string): string {
  const base = path.split("/").pop() ?? path;
  return `Summary pending review for ${base}`;
}

function renameFor(path: string): string {
  const parts = path.split("/");
  const filename = parts.pop() ?? path;
  const timestamp = new Date().toISOString().slice(0, 10);
  return [...parts, `${timestamp}-${filename}`].join("/");
}

export const newFilePlugin = definePlugin({
  id: "new-file-organizer",
  name: "New File Organizer",
  version: "0.1.0",
  requestedCapabilities: ["filesystem.read", "filesystem.write", "notifications"],
  signed: false, // ships unsigned as a development example only
  actions: [
    {
      name: "process-new-file",
      requiredCapability: "filesystem.write",
      handler: async (input, context): Promise<ProcessResult> => {
        const event = input as NewFileEvent;
        const result: ProcessResult = {
          summary: summarize(event.path),
          renamedTo: renameFor(event.path),
          notified: true,
        };
        await context.emit("plugin.new_file_organizer.processed", result);
        return result;
      },
    },
  ],
});
