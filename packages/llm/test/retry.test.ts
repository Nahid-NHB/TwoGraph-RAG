import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '@twograph/llm';

describe('withRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, () => true);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient errors and succeeds once the failure clears', async () => {
    let calls = 0;
    const fn = vi.fn(() => {
      calls += 1;
      if (calls < 3) return Promise.reject(new Error('transient'));
      return Promise.resolve('ok');
    });
    const result = await withRetry(fn, () => true, { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('does not retry non-transient errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fatal'));
    await expect(withRetry(fn, () => false, { maxRetries: 3, baseDelayMs: 1 })).rejects.toThrow(
      'fatal',
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxRetries transient failures', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('still failing'));
    await expect(withRetry(fn, () => true, { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow(
      'still failing',
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
