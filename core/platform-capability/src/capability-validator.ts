import { ToolValidator } from "@ryper/tool-framework";
import type { CapabilityDescriptor } from "./types.js";

export interface DescriptorValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const DOMAIN_PATTERN = /^[a-z][a-z0-9_.]*$/;

/**
 * Validates `CapabilityDescriptor` shape, and — reusing
 * `@ryper/tool-framework`'s `ToolValidator` rather than writing a third
 * JSON-schema validator (the first was in Tool Framework, the second in
 * Plugin Platform's settings validation) — validates a capability
 * invocation's parameters against its declared `inputSchema`.
 */
export class CapabilityValidator {
  private readonly schemaValidator = new ToolValidator();

  validateDescriptor(descriptor: CapabilityDescriptor): DescriptorValidationResult {
    const errors: string[] = [];
    if (!DOMAIN_PATTERN.test(descriptor.domain)) {
      errors.push(
        `domain "${descriptor.domain}" must be lowercase, starting with a letter (dots/underscores ok)`,
      );
    }
    if (descriptor.name.trim().length === 0) {
      errors.push("name must not be empty");
    }
    if (descriptor.version.trim().length === 0) {
      errors.push("version must not be empty");
    }
    return { valid: errors.length === 0, errors };
  }

  validateParameters(
    descriptor: CapabilityDescriptor,
    parameters: Readonly<Record<string, unknown>>,
  ): DescriptorValidationResult {
    if (!descriptor.inputSchema) return { valid: true, errors: [] };
    const result = this.schemaValidator.validateInput(descriptor.inputSchema, parameters);
    return { valid: result.valid, errors: result.errors };
  }
}

export function createCapabilityValidator(): CapabilityValidator {
  return new CapabilityValidator();
}
