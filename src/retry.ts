/**
 * Retries `fn` until it succeeds, `shouldRetry` rejects the error, or
 * `attempts` runs out, waiting `delayMs` between attempts.
 *
 * The defaults (5 attempts, 2s apart) are tuned to cover the JCR cluster
 * synchronization delay of the Academy (~5s): even if a request lands on a
 * server that has not seen a freshly created node yet, one of the retries
 * will. See also `createStickyFetch`, the first line of defense.
 */
export const retry = async <T>(
  fn: () => Promise<T>,
  {
    attempts = 5,
    delayMs = 2000,
    shouldRetry = () => true,
  }: {
    attempts?: number;
    delayMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {}
): Promise<T> => {
  if (attempts < 1) throw new RangeError(`retry attempts must be >= 1, got ${attempts}`);

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !shouldRetry(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
};

/** True when the error is a JCR PathNotFoundException surfaced through GraphQL. */
export const isPathNotFound = (error: unknown) =>
  error instanceof Error && error.message.includes('PathNotFoundException');
