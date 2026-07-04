import { computeBackoffMs, shouldRetry, RetryPolicyConfig } from '../src/utils/backoff';

describe('computeBackoffMs', () => {
  const base: RetryPolicyConfig = {
    strategy: 'fixed',
    baseDelayMs: 1000,
    multiplier: 2,
    maxDelayMs: 60000,
    maxAttempts: 5,
    jitter: false,
  };

  it('fixed strategy always returns baseDelayMs regardless of attempt number', () => {
    expect(computeBackoffMs(1, base)).toBe(1000);
    expect(computeBackoffMs(5, base)).toBe(1000);
  });

  it('linear strategy scales delay proportionally with attempt number', () => {
    const policy: RetryPolicyConfig = { ...base, strategy: 'linear' };
    expect(computeBackoffMs(1, policy)).toBe(1000);
    expect(computeBackoffMs(2, policy)).toBe(2000);
    expect(computeBackoffMs(3, policy)).toBe(3000);
  });

  it('exponential strategy scales delay by multiplier^(attempt-1)', () => {
    const policy: RetryPolicyConfig = { ...base, strategy: 'exponential', multiplier: 2 };
    expect(computeBackoffMs(1, policy)).toBe(1000); // 1000 * 2^0
    expect(computeBackoffMs(2, policy)).toBe(2000); // 1000 * 2^1
    expect(computeBackoffMs(3, policy)).toBe(4000); // 1000 * 2^2
    expect(computeBackoffMs(4, policy)).toBe(8000); // 1000 * 2^3
  });

  it('clamps delay to maxDelayMs', () => {
    const policy: RetryPolicyConfig = { ...base, strategy: 'exponential', maxDelayMs: 5000 };
    expect(computeBackoffMs(4, policy)).toBe(5000); // would be 8000 uncapped
    expect(computeBackoffMs(10, policy)).toBe(5000);
  });

  it('applies full jitter within [0, delay] when enabled', () => {
    const policy: RetryPolicyConfig = { ...base, jitter: true };
    for (let i = 0; i < 50; i++) {
      const delay = computeBackoffMs(1, policy);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(1000);
    }
  });

  it('throws on invalid attempt number', () => {
    expect(() => computeBackoffMs(0, base)).toThrow();
    expect(() => computeBackoffMs(-1, base)).toThrow();
  });
});

describe('shouldRetry', () => {
  const policy: RetryPolicyConfig = {
    strategy: 'fixed',
    baseDelayMs: 100,
    multiplier: 2,
    maxDelayMs: 1000,
    maxAttempts: 3,
    jitter: false,
  };

  it('allows retry while attemptCount is below maxAttempts', () => {
    expect(shouldRetry(1, policy)).toBe(true);
    expect(shouldRetry(2, policy)).toBe(true);
  });

  it('denies retry once attemptCount reaches maxAttempts', () => {
    expect(shouldRetry(3, policy)).toBe(false);
    expect(shouldRetry(4, policy)).toBe(false);
  });
});
