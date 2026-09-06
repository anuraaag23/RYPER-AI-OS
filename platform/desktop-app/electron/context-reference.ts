/**
 * Real, focused context storage for "open this"/"open this folder"/
 * "play this video"/"open that PDF" (PART 9-11 of the brief). This
 * package's existing `VoiceContextManager` is a *different* concern —
 * it's a bridge into `@ryper/memory-system`'s long-term, semantically
 * searchable conversational memory, not a good fit for "the one
 * specific thing the user is referring to right now." Per the brief's
 * own instruction ("if there is currently no suitable context storage,
 * create a small focused abstraction"), this is that small, focused
 * abstraction — a single mutable slot, not a general state system.
 *
 * **How it gets populated, honestly**: this text/voice pipeline has no
 * UI-level "attachment" or "currently displayed item" concept — there
 * is no screen the user is pointing at. The one real, non-fabricated
 * signal available is the pipeline's own successful actions: whenever
 * `open_file`/`open_folder`/`open_url`/`smart_open`/`list_files`/
 * `search_files`/`get_folder_path` genuinely succeeds, *that* real
 * target becomes the new "current reference" — so "open this" after
 * "open C:\...\report.pdf" really does mean that file, and "open this
 * folder" after "list files in Downloads" really does mean Downloads.
 * Nothing here is ever set from raw, unvalidated conversation text.
 */
export type ContextReferenceType = "file" | "folder" | "url" | "application" | "media";

export interface CurrentReference {
  readonly type: ContextReferenceType;
  readonly path?: string;
  readonly url?: string;
  readonly name?: string;
  readonly source?: string;
  readonly timestamp: number;
}

const DEFAULT_TTL_MS = 10 * 60_000;

export class ContextReferenceTracker {
  private current: CurrentReference | undefined;

  constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  set(reference: Omit<CurrentReference, "timestamp">): void {
    this.current = { ...reference, timestamp: this.now() };
  }

  /**
   * Returns the current reference, or `undefined` if there is none or
   * it's gone stale (PART 11: "clear or invalidate stale references
   * where appropriate"). Lazily expires here rather than on a timer —
   * this is a single mutable slot in a desktop app process, not
   * something that needs background cleanup.
   */
  get(): CurrentReference | undefined {
    if (!this.current) return undefined;
    if (this.now() - this.current.timestamp > this.ttlMs) {
      this.current = undefined;
      return undefined;
    }
    return this.current;
  }

  /** Explicitly invalidates the current reference — PART 11: session end/reset, or a reference that's known to no longer be valid (e.g. the file it pointed to was just deleted by `delete_file`). */
  clear(): void {
    this.current = undefined;
  }
}

export function createContextReferenceTracker(
  ttlMs?: number,
  now?: () => number,
): ContextReferenceTracker {
  return new ContextReferenceTracker(ttlMs, now);
}
