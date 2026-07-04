export type RetryStrategy = 'fixed' | 'linear' | 'exponential';

export interface RetryPolicyConfig {
  strategy: RetryStrategy;
  baseDelayMs: number;
  multiplier: number; // used by exponential
  maxDelayMs: number;
  maxAttempts: number;
  jitter: boolean;
}

/**
 * Computes the delay (ms) before the *next* attempt, given the attempt
 * number that just failed (1-indexed: first failure => attemptNumber = 1).
 *
 * - fixed:       delay = baseDelay
 * - linear:      delay = baseDelay * attemptNumber
 * - exponential: delay = baseDelay * multiplier^(attemptNumber - 1)
 *
 * All strategies are clamped to maxDelayMs. Jitter, when enabled, applies
 * "full jitter" (random value in [0, delay]) to avoid thundering-herd
 * retries when many jobs fail at once (e.g. a downstream outage).
 */
export function computeBackoffMs(attemptNumber: number, policy: RetryPolicyConfig): number {
  if (attemptNumber < 1) {
    throw new Error('attemptNumber must be >= 1');
  }

  let delay: number;
  switch (policy.strategy) {
    case 'fixed':
      delay = policy.baseDelayMs;
      break;
    case 'linear':
      delay = policy.baseDelayMs * attemptNumber;
      break;
    case 'exponential':
      delay = policy.baseDelayMs * Math.pow(policy.multiplier, attemptNumber - 1);
      break;
    default:
      throw new Error(`Unknown retry strategy: ${policy.strategy}`);
  }

  delay = Math.min(delay, policy.maxDelayMs);

  if (policy.jitter) {
    delay = Math.random() * delay;
  }

  return Math.round(delay);
}

export function shouldRetry(attemptCount: number, policy: RetryPolicyConfig): boolean {
  return attemptCount < policy.maxAttempts;
}
