import type { JsonSchema } from "./types.js";

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function validateValue(schema: JsonSchema, value: unknown, path: string, errors: string[]): void {
  const actualType = typeOf(value);
  const expected = schema.type;
  const typeOk =
    expected === actualType ||
    (expected === "integer" && actualType === "number" && Number.isInteger(value)) ||
    (expected === "number" && actualType === "number");

  if (!typeOk) {
    errors.push(`${path}: expected type "${expected}" but got "${actualType}"`);
    return;
  }

  if (schema.enum && !schema.enum.some((allowed) => Object.is(allowed, value))) {
    errors.push(`${path}: value is not one of the allowed enum values`);
  }

  if (expected === "string" && typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: string shorter than minLength ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path}: string longer than maxLength ${schema.maxLength}`);
    }
  }

  if ((expected === "number" || expected === "integer") && typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: value below minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: value above maximum ${schema.maximum}`);
    }
  }

  if (expected === "object" && value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const requiredKey of schema.required ?? []) {
      if (!(requiredKey in obj)) {
        errors.push(`${path}: missing required property "${requiredKey}"`);
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      if (key in obj) {
        validateValue(propSchema, obj[key], `${path}.${key}`, errors);
      }
    }
  }

  if (expected === "array" && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => validateValue(schema.items!, item, `${path}[${index}]`, errors));
  }
}

/**
 * Validates a value against a minimal JSON-schema subset (object/array
 * nesting, required properties, enum, string length bounds, numeric
 * bounds). This is a deliberately small, dependency-free implementation —
 * no existing schema validator was found anywhere in the repo to reuse,
 * and neither `@ryper/ai-engine`'s tool-calling module nor
 * `@ryper/plugin-runtime` perform runtime schema validation today, so this
 * is genuinely new capability rather than a duplicate of something else.
 */
export class ToolValidator {
  validate(schema: JsonSchema, value: unknown): ValidationResult {
    const errors: string[] = [];
    validateValue(schema, value, "$", errors);
    return { valid: errors.length === 0, errors };
  }

  validateInput(
    schema: JsonSchema,
    parameters: Readonly<Record<string, unknown>>,
  ): ValidationResult {
    return this.validate(schema, parameters);
  }

  validateOutput(schema: JsonSchema, value: unknown): ValidationResult {
    return this.validate(schema, value);
  }
}

export function createToolValidator(): ToolValidator {
  return new ToolValidator();
}
