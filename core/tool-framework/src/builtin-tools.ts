import type { ToolDefinition } from "./types.js";

/**
 * Three genuinely functional but deliberately hardware-free tools, used
 * to prove the framework end-to-end (registry → validation → permission
 * check → execution → streaming → output validation) exactly like
 * `@ryper/ai-engine`'s `currentTimeTool` proves its own tool-calling
 * loop. Filesystem/browser/document/calendar/etc. tools are real platform
 * integrations for a later phase.
 */
export const getCurrentTimeTool: ToolDefinition = {
  spec: {
    id: "system.get_current_time",
    name: "Get Current Time",
    description: "Returns the current UTC time as an ISO-8601 string.",
    category: "system",
    version: "1.0.0",
    author: "ryper-core",
    capabilities: [],
    permissions: [],
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: { iso: { type: "string" } },
      required: ["iso"],
    },
    examples: [
      {
        description: "Get the current time",
        input: {},
        output: { iso: "2026-07-21T00:00:00.000Z" },
      },
    ],
    errorCodes: [],
    executionCost: "free",
    timeoutMs: 1_000,
    cancellationSupport: false,
    streamingSupport: false,
  },
  execute: () => ({ iso: new Date().toISOString() }),
};

export const textTransformTool: ToolDefinition = {
  spec: {
    id: "system.text_transform",
    name: "Text Transform",
    description: "Transforms text to uppercase, lowercase, or reversed.",
    category: "system",
    version: "1.0.0",
    author: "ryper-core",
    capabilities: [],
    permissions: [],
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", minLength: 1 },
        operation: { type: "string", enum: ["uppercase", "lowercase", "reverse"] },
      },
      required: ["text", "operation"],
    },
    outputSchema: {
      type: "object",
      properties: { result: { type: "string" } },
      required: ["result"],
    },
    examples: [
      {
        description: "Uppercase a string",
        input: { text: "hello", operation: "uppercase" },
        output: { result: "HELLO" },
      },
    ],
    errorCodes: [
      {
        code: "system.unsupported_operation",
        description: "The requested operation isn't supported.",
      },
    ],
    executionCost: "free",
    timeoutMs: 1_000,
    cancellationSupport: false,
    streamingSupport: false,
  },
  execute: (parameters) => {
    const text = String(parameters["text"]);
    const operation = String(parameters["operation"]);
    switch (operation) {
      case "uppercase":
        return { result: text.toUpperCase() };
      case "lowercase":
        return { result: text.toLowerCase() };
      case "reverse":
        return { result: [...text].reverse().join("") };
      default:
        throw new Error(`unsupported operation "${operation}"`);
    }
  },
};

export const textEchoStreamTool: ToolDefinition = {
  spec: {
    id: "system.text_echo_stream",
    name: "Text Echo Stream",
    description: "Streams a given text back one word at a time.",
    category: "system",
    version: "1.0.0",
    author: "ryper-core",
    capabilities: [],
    permissions: [],
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", minLength: 1 } },
      required: ["text"],
    },
    outputSchema: { type: "array", items: { type: "string" } },
    examples: [
      { description: "Echo a short phrase", input: { text: "hi there" }, output: ["hi", "there"] },
    ],
    errorCodes: [],
    executionCost: "free",
    timeoutMs: 2_000,
    cancellationSupport: true,
    streamingSupport: true,
  },
  execute: (parameters) => String(parameters["text"]).split(/\s+/).filter(Boolean),
  executeStream: async function* (parameters, context) {
    const words = String(parameters["text"]).split(/\s+/).filter(Boolean);
    for (const word of words) {
      if (context.signal?.aborted) return;
      yield word;
    }
  },
};

export const builtinTools: readonly ToolDefinition[] = [
  getCurrentTimeTool,
  textTransformTool,
  textEchoStreamTool,
];
