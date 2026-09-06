export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class ToolExecutionError extends Error {
  constructor(
    message: string,
    public readonly toolName: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

export class EngineTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineTimeoutError";
  }
}

export interface RetryOptions {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs?: number | undefined;
  readonly isRetryable?: ((error: unknown) => boolean) | undefined;
  /** Injectable so tests don't sleep in real time. */
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  /**
   * Called synchronously once a failed attempt has been judged
   * retryable and before the backoff `sleep`, with the attempt number
   * that just failed (1-based) and the error that triggered the
   * retry. Purely observational — a caller can use it to reflect
   * "automatically recovering" state (e.g. the Voice Engine's
   * `recovering` session state, see `docs/adr/0028`) without
   * `retryWithBackoff` itself knowing anything about that concern.
   * Never called on the attempt that ultimately throws (i.e. not
   * called for a non-retryable error or once `maxAttempts` is
   * exhausted).
   */
  readonly onRetry?: ((attempt: number, error: unknown) => void) | undefined;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with a configurable retryability predicate. */
export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const isRetryable = options.isRetryable ?? (() => true);
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === options.maxAttempts;
      if (isLastAttempt || !isRetryable(error)) {
        throw error;
      }
      options.onRetry?.(attempt, error);
      const delay = Math.min(
        options.initialDelayMs * 2 ** (attempt - 1),
        options.maxDelayMs ?? Infinity,
      );
      await sleep(delay);
    }
  }

  // Unreachable given the loop above always returns or throws, but keeps the return type sound.
  throw lastError;
}

/**
 * Runs `primary`; if it throws, runs `fallback` instead. Used by the
 * orchestrator to fall back from a cloud provider to a local one (or vice
 * versa) on provider failure, distinct from `retryWithBackoff` which retries
 * the *same* provider.
 */
export async function runWithFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  try {
    return await primary();
  } catch {
    return fallback();
  }
}
