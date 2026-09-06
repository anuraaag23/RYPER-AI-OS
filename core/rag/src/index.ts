import { createLogger } from "@ryper/logging";

const log = createLogger("rag");

export interface DocumentChunk {
  readonly id: string;
  readonly documentId: string;
  readonly text: string;
  readonly embedding?: readonly number[];
}

export interface RetrievedChunk extends DocumentChunk {
  readonly score: number;
}

/** Injected so the actual model (local or cloud) stays outside this package. */
export type EmbedFn = (text: string) => Promise<readonly number[]>;

export interface ChunkOptions {
  readonly maxChars?: number;
  readonly overlapChars?: number;
}

/** Splits text into overlapping chunks on paragraph/sentence boundaries where possible. */
export function chunkText(
  documentId: string,
  text: string,
  options: ChunkOptions = {},
): DocumentChunk[] {
  const maxChars = options.maxChars ?? 800;
  const overlap = options.overlapChars ?? 100;
  if (maxChars <= overlap) {
    throw new Error("maxChars must be greater than overlapChars");
  }

  const chunks: DocumentChunk[] = [];
  let start = 0;
  let index = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    const slice = text.slice(start, end).trim();
    if (slice.length > 0) {
      chunks.push({ id: `${documentId}#${index}`, documentId, text: slice });
      index += 1;
    }
    if (end === text.length) break;
    start = end - overlap;
  }
  return chunks;
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function keywordScore(query: string, text: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  const haystack = text.toLowerCase();
  const hits = terms.filter((term) => haystack.includes(term)).length;
  return hits / terms.length;
}

/**
 * Embedded (in-process) hybrid vector + keyword store. A dedicated vector
 * index (e.g. HNSW) replaces the linear scan below once corpora grow large;
 * the public interface is designed to stay stable across that swap.
 */
export class VectorStore {
  private readonly chunks: DocumentChunk[] = [];

  constructor(private readonly embed: EmbedFn) {}

  async addDocument(documentId: string, text: string, options?: ChunkOptions): Promise<number> {
    const chunks = chunkText(documentId, text, options);
    for (const chunk of chunks) {
      const embedding = await this.embed(chunk.text);
      this.chunks.push({ ...chunk, embedding });
    }
    log.info("indexed document", { documentId, chunkCount: chunks.length });
    return chunks.length;
  }

  async search(query: string, limit = 5, hybridWeight = 0.7): Promise<RetrievedChunk[]> {
    const queryEmbedding = await this.embed(query);
    return this.chunks
      .map((chunk) => {
        const vectorScore = chunk.embedding ? cosineSimilarity(queryEmbedding, chunk.embedding) : 0;
        const kwScore = keywordScore(query, chunk.text);
        const score = hybridWeight * vectorScore + (1 - hybridWeight) * kwScore;
        return { ...chunk, score };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  size(): number {
    return this.chunks.length;
  }
}

export function createVectorStore(embed: EmbedFn): VectorStore {
  return new VectorStore(embed);
}
