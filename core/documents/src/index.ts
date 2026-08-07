export type DocumentFormat = "pdf" | "docx" | "xlsx" | "pptx" | "txt" | "csv" | "md";

export interface DocumentInput {
  readonly format: DocumentFormat;
  readonly bytes: Uint8Array;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface DocumentOutput {
  readonly format: DocumentFormat;
  readonly bytes: Uint8Array;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type DocumentTransform = (input: DocumentInput) => Promise<DocumentOutput> | DocumentOutput;

/**
 * Each transform (merge, split, OCR, watermark, ...) is a pure function from
 * one document to another, registered here by name. Platform shells and
 * plugins invoke transforms by name so the concrete implementation (which
 * may shell out to a native library per platform) can vary without changing
 * call sites.
 */
export class DocumentEngine {
  private readonly transforms = new Map<string, DocumentTransform>();

  register(name: string, transform: DocumentTransform): void {
    if (this.transforms.has(name)) {
      throw new Error(`transform "${name}" is already registered`);
    }
    this.transforms.set(name, transform);
  }

  has(name: string): boolean {
    return this.transforms.has(name);
  }

  async run(name: string, input: DocumentInput): Promise<DocumentOutput> {
    const transform = this.transforms.get(name);
    if (!transform) {
      throw new Error(`no document transform registered under "${name}"`);
    }
    return transform(input);
  }

  listTransforms(): readonly string[] {
    return [...this.transforms.keys()];
  }
}

/** A real, trivial-but-correct built-in transform: extracts plain text from a txt/md/csv document. */
export const extractPlainText: DocumentTransform = (input) => {
  if (input.format !== "txt" && input.format !== "md" && input.format !== "csv") {
    throw new Error(`extractPlainText does not support format "${input.format}"`);
  }
  return { format: "txt", bytes: input.bytes, metadata: { ...input.metadata, extracted: true } };
};

export function createDocumentEngine(): DocumentEngine {
  const engine = new DocumentEngine();
  engine.register("extract-plain-text", extractPlainText);
  return engine;
}
