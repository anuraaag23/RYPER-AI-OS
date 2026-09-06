import type { ToolDefinition } from "./types.js";

/**
 * A genuinely functional but deliberately trivial tool, used to prove the
 * tool-calling framework end-to-end (spec advertisement → model requests a
 * call → registry executes it → result flows back into the conversation)
 * without depending on any OS capability. Filesystem/browser/document/
 * calendar/etc. tools are real integrations for a later phase — this one
 * exists so the framework itself has full test coverage today.
 */
export const currentTimeTool: ToolDefinition = {
  spec: {
    name: "get_current_time",
    description: "Returns the current UTC time as an ISO-8601 string.",
    parameters: { type: "object", properties: {} },
  },
  execute: () => ({ iso: new Date().toISOString() }),
};
