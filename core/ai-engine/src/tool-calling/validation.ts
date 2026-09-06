import type { ToolCallRequest, ToolParameterSchema } from "../types.js";

/**
 * LLM-generated tool-call arguments are untrusted input, exactly like any
 * other user-controlled data reaching a security-sensitive boundary — the
 * model can hallucinate a field, invent a type, or (adversarially, via
 * prompt injection) attempt to pass an out-of-range or malformed value
 * hoping a tool implementation trusts it blindly. This validates
 * `ToolCallRequest.arguments` against the tool's own advertised
 * `ToolParameterSchema` — the same schema already sent to the model —
 * before `ToolRegistry.invoke()` ever calls `execute()`. A tool that
 * requires `percent` between 0 and 100 rejects `set_volume(500)` here,
 * centrally, rather than depending on every individual tool
 * implementation to re-check it (some may; this makes it structural).
 *
 * Deliberately minimal — no new dependency (e.g. ajv) for what's a small,
 * fixed set of checks (type, required, enum, numeric range, string
 * length/pattern) — not a general JSON Schema implementation.
 */
export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function matchesType(value: unknown, expected: string): boolean {
  const actual = typeOf(value);
  if (expected === "integer") return actual === "number" && Number.isInteger(value);
  return actual === expected;
}

export function validateToolArguments(
  schema: ToolParameterSchema,
  args: Readonly<Record<string, unknown>>,
): ValidationResult {
  const errors: string[] = [];

  for (const requiredField of schema.required ?? []) {
    if (!(requiredField in args) || args[requiredField] === undefined) {
      errors.push(`missing required argument "${requiredField}"`);
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const propertySchema = schema.properties[key];
    if (!propertySchema) {
      // Unknown arguments are rejected, not silently ignored — an LLM
      // passing an extra field it invented should not quietly reach a
      // tool implementation that might not expect it.
      errors.push(`unknown argument "${key}"`);
      continue;
    }
    if (value === undefined || value === null) continue; // covered by the required-field check above

    if (!matchesType(value, propertySchema.type)) {
      errors.push(`argument "${key}" must be of type ${propertySchema.type}, got ${typeOf(value)}`);
      continue;
    }

    if (propertySchema.enum && !propertySchema.enum.includes(value as string | number)) {
      errors.push(`argument "${key}" must be one of [${propertySchema.enum.join(", ")}]`);
    }

    if (typeof value === "number") {
      if (propertySchema.minimum !== undefined && value < propertySchema.minimum) {
        errors.push(`argument "${key}" must be >= ${propertySchema.minimum}, got ${value}`);
      }
      if (propertySchema.maximum !== undefined && value > propertySchema.maximum) {
        errors.push(`argument "${key}" must be <= ${propertySchema.maximum}, got ${value}`);
      }
    }

    if (typeof value === "string") {
      if (propertySchema.minLength !== undefined && value.length < propertySchema.minLength) {
        errors.push(`argument "${key}" must be at least ${propertySchema.minLength} characters`);
      }
      if (propertySchema.maxLength !== undefined && value.length > propertySchema.maxLength) {
        errors.push(`argument "${key}" must be at most ${propertySchema.maxLength} characters`);
      }
      if (propertySchema.pattern !== undefined && !new RegExp(propertySchema.pattern).test(value)) {
        errors.push(`argument "${key}" does not match required pattern`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function describeInvalidToolCall(
  request: ToolCallRequest,
  result: ValidationResult,
): string {
  return `invalid arguments for tool "${request.name}": ${result.errors.join("; ")}`;
}
