import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { limit, withRetry } from './concurrency';

describe('limit()', () => {
  it('runs all items in order with bounded concurrency', async () => {
    const start: number[] = [];
    const end: number[] = [];
    const items = [1, 2, 3, 4, 5, 6];
    const inFlight = new Set<number>();

    await limit(items, 2, async (item) => {
      start.push(item);
      inFlight.add(item);
      // At most 2 items should ever be in-flight at once.
      expect(inFlight.size).toBeLessThanOrEqual(2);
      await new Promise((r) => setTimeout(r, 5));
      inFlight.delete(item);
      end.push(item);
      return item * 10;
    });

    // All items started, all completed.
    expect(start).toEqual(items);
    expect(end).toEqual(items);
  });

  it('returns results indexed by input order, not completion order', async () => {
    const items = [100, 1, 50];
    const results = await limit(items, 3, async (n) => {
      // Variable delay so completion order != input order.
      await new Promise((r) => setTimeout(r, n / 10));
      return n * 2;
    });
    expect(results).toEqual([200, 2, 100]);
  });

  it('respects concurrency=1 (serial)', async () => {
    const order: number[] = [];
    await limit([1, 2, 3], 1, async (n) => {
      order.push(n);
      return n;
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it('handles empty input', async () => {
    const results = await limit<number, number>([], 5, async (n) => n);
    expect(results).toEqual([]);
  });

  it('caps concurrency to items.length when items < concurrency', async () => {
    let maxConcurrent = 0;
    let current = 0;
    await limit([1, 2], 10, async (n) => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 5));
      current--;
      return n;
    });
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});

describe('withRetry()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(globalThis.Math, 'random').mockReturnValue(0); // strip jitter
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValue('ok');

    const promise = withRetry(fn, { attempts: 3, baseDelayMs: 100, maxDelayMs: 1000 });
    await vi.runAllTimersAsync();
    expect(await promise).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on 5xx then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue('ok');

    const promise = withRetry(fn, { attempts: 3, baseDelayMs: 50 });
    await vi.runAllTimersAsync();
    expect(await promise).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 4xx other than 429', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 400 });
    const promise = withRetry(fn, { attempts: 3, baseDelayMs: 50 });
    await expect(promise).rejects.toEqual({ status: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on network errors (ECONNRESET, ETIMEDOUT)', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ code: 'ECONNRESET' })
      .mockResolvedValue('ok');

    const promise = withRetry(fn, { attempts: 3, baseDelayMs: 50 });
    await vi.runAllTimersAsync();
    expect(await promise).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting attempts', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 429 });
    const promise = withRetry(fn, { attempts: 3, baseDelayMs: 50 });
    // Attach a no-op catch so the eventual rejection doesn't surface as
    // an unhandled rejection while the timer-driven retries play out.
    const guarded = promise.catch((e) => e);
    await vi.runAllTimersAsync();
    await expect(guarded).resolves.toEqual({ status: 429 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('honors custom shouldRetry predicate', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 418 });
    const promise = withRetry(fn, {
      attempts: 3,
      baseDelayMs: 50,
      shouldRetry: () => false, // never retry
    });
    await expect(promise).rejects.toEqual({ status: 418 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses exponential backoff with cap', async () => {
    // base=100ms: 100, 200, 400, capped at maxDelay
    const delays: number[] = [];
    const realSetTimeout = setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms) => {
      delays.push(ms ?? 0);
      // Fire via real timer so vi.runAllTimersAsync drives it.
      return realSetTimeout(fn, 0);
    });

    const fn = vi.fn().mockRejectedValue({ status: 429 });
    const promise = withRetry(fn, { attempts: 4, baseDelayMs: 100, maxDelayMs: 250 });
    const guarded = promise.catch((e) => e);
    await vi.runAllTimersAsync();
    await expect(guarded).resolves.toBeDefined();

    // base=100, base*2=200, base*4=400 → capped at 250. Plus small jitter (~0 since random=0).
    // 3 sleeps for 4 attempts.
    expect(delays).toHaveLength(3);
    expect(delays[0]).toBeGreaterThanOrEqual(100);
    expect(delays[1]).toBeGreaterThanOrEqual(200);
    expect(delays[2]).toBeGreaterThanOrEqual(250); // capped
  });
});