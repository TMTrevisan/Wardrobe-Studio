/**
 * Tiny zero-dep concurrency limiter + exponential-backoff retry helper.
 *
 * Avoids pulling in `p-limit` (one tiny dep, but a dependency nonetheless)
 * for the single place we need bounded concurrency today (Gemini batch
 * ingest). If we need it elsewhere later, swap to `p-limit`.
 */

export async function limit<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (err) {
        // Preserve index/order even on rejection by re-throwing after
        // recording undefined; the caller can `.filter(Boolean)` if it
        // wants only successes.
        throw err;
      }
    }
  }

  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(lanes);
  return results;
}

interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Return true if the error is retryable. Defaults to "yes if status is 429/5xx". */
  shouldRetry?: (err: any) => boolean;
}

const DEFAULTS = { attempts: 3, baseDelayMs: 500, maxDelayMs: 8000 };

/**
 * Wraps an async function with exponential backoff. Use for transient
 * upstream failures (rate limits, 5xx, network timeouts).
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { attempts, baseDelayMs, maxDelayMs } = { ...DEFAULTS, ...opts };
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !shouldRetry(err)) break;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** i) + Math.floor(Math.random() * 100);
      await sleep(delay);
    }
  }
  throw lastErr;
}

function defaultShouldRetry(err: any): boolean {
  const status = err?.status ?? err?.response?.status ?? err?.code;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500 && status < 600) return true;
  // Network errors typically surface as codes like ECONNRESET, ETIMEDOUT, etc.
  if (typeof err?.code === 'string' && /^(ECONN|ETIMEDOUT|EPIPE|EAI_AGAIN)/.test(err.code)) return true;
  return false;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));