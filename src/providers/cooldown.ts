// ─── Provider Cooldown / Rate-Limit Memory ───────────────────
// Tracks provider failures and implements automatic cooldown to prevent
// hammering failing providers. This makes the router more resilient.

import { logger } from '../utils/logger.js';

export interface ProviderCooldownState {
  isCoolingDown: boolean;
  cooldownUntil: number; // timestamp when cooldown ends
  failureCount: number;
  lastFailure: number;
  lastSuccess: number;
  consecutiveFailures: number;
}

const cooldownStates = new Map<string, ProviderCooldownState>();

// Configuration
export const COOLDOWN_CONFIG = {
  // After this many consecutive failures, enter cooldown
  failureThreshold: 3,
  // Base cooldown duration (ms)
  baseCooldownMs: 60_000, // 1 minute
  // Max cooldown duration (ms)
  maxCooldownMs: 300_000, // 5 minutes
  // Exponential backoff multiplier
  backoffMultiplier: 2,
  // Success resets failure count after this many successes
  successResetThreshold: 2,
  // Rate limit (429) specific cooldown
  rateLimitCooldownMs: 60_000,
} as const;

/**
 * Checks if a provider is currently in cooldown.
 * If cooldown has expired, automatically clears it.
 */
export function isProviderCoolingDown(providerId: string): { coolingDown: boolean; remainingMs: number } {
  const state = cooldownStates.get(providerId);
  if (!state || !state.isCoolingDown) {
    return { coolingDown: false, remainingMs: 0 };
  }

  const now = Date.now();
  if (now >= state.cooldownUntil) {
    // Cooldown expired, clear it
    state.isCoolingDown = false;
    state.cooldownUntil = 0;
    state.consecutiveFailures = 0;
    cooldownStates.set(providerId, state);
    logger.info(`Provider ${providerId} cooldown expired, now available`);
    return { coolingDown: false, remainingMs: 0 };
  }

  return { coolingDown: true, remainingMs: state.cooldownUntil - now };
}

/**
 * Records a successful call for a provider.
 * May exit cooldown early if enough consecutive successes.
 */
export function recordProviderSuccess(providerId: string): void {
  const state = cooldownStates.get(providerId) || {
    isCoolingDown: false,
    cooldownUntil: 0,
    failureCount: 0,
    lastFailure: 0,
    lastSuccess: Date.now(),
    consecutiveFailures: 0,
  };

  state.lastSuccess = Date.now();
  state.consecutiveFailures = 0;
  state.failureCount = Math.max(0, state.failureCount - 1); // gradual decay

  // If we have enough consecutive successes, exit cooldown early
  if (state.isCoolingDown && state.consecutiveFailures === 0) {
    state.isCoolingDown = false;
    state.cooldownUntil = 0;
    logger.info(`Provider ${providerId} exited cooldown early after success`);
  }

  cooldownStates.set(providerId, state);
}

/**
 * Records a failed call for a provider.
 * May trigger cooldown if threshold reached.
 * @param providerId - Provider identifier
 * @param isRateLimit - Whether this was a 429 rate limit error
 */
export function recordProviderFailure(providerId: string, isRateLimit = false): void {
  const state = cooldownStates.get(providerId) || {
    isCoolingDown: false,
    cooldownUntil: 0,
    failureCount: 0,
    lastFailure: 0,
    lastSuccess: 0,
    consecutiveFailures: 0,
  };

  state.lastFailure = Date.now();
  state.consecutiveFailures++;
  state.failureCount++;

  // Check if we should enter cooldown
  if (!state.isCoolingDown) {
    if (isRateLimit) {
      // Rate limit gets immediate cooldown
      state.isCoolingDown = true;
      state.cooldownUntil = Date.now() + COOLDOWN_CONFIG.rateLimitCooldownMs;
      logger.warn(`Provider ${providerId} rate limited, cooling down for ${COOLDOWN_CONFIG.rateLimitCooldownMs}ms`);
    } else if (state.consecutiveFailures >= COOLDOWN_CONFIG.failureThreshold) {
      // Exponential backoff based on failure count
      const cooldownDuration = Math.min(
        COOLDOWN_CONFIG.baseCooldownMs * Math.pow(COOLDOWN_CONFIG.backoffMultiplier, state.consecutiveFailures - COOLDOWN_CONFIG.failureThreshold),
        COOLDOWN_CONFIG.maxCooldownMs
      );
      state.isCoolingDown = true;
      state.cooldownUntil = Date.now() + cooldownDuration;
      logger.warn(`Provider ${providerId} failed ${state.consecutiveFailures} times, cooling down for ${cooldownDuration}ms`);
    }
  }

  cooldownStates.set(providerId, state);
}

/**
 * Classifies a provider error to determine if it should trigger cooldown.
 * Returns true for transient errors (network, 5xx, timeout, 429)
 * Returns false for permanent errors (invalid key, 400, model not found)
 */
export function classifyProviderError(error: string | Error): { isTransient: boolean; isRateLimit: boolean } {
  const message = error instanceof Error ? error.message : String(error).toLowerCase();

  // Rate limit
  if (message.includes('429') || message.includes('rate limit') || message.includes('rate_limit')) {
    return { isTransient: true, isRateLimit: true };
  }

  // Transient network/server errors
  const transientPatterns = [
    'timeout',
    'econnreset',
    'etimedout',
    'enotfound',
    'econnrefused',
    'network error',
    'fetch failed',
    '500',
    '502',
    '503',
    '504',
    'internal server error',
    'bad gateway',
    'service unavailable',
    'gateway timeout',
  ];

  if (transientPatterns.some(p => message.includes(p))) {
    return { isTransient: true, isRateLimit: false };
  }

  // Permanent errors (don't retry)
  const permanentPatterns = [
    '401',
    '403',
    'invalid api key',
    'unauthorized',
    'forbidden',
    '400',
    'bad request',
    'model not found',
    'model_not_found',
    'does not exist',
    'unsupported',
    'max_tokens',
    'context length',
  ];

  if (permanentPatterns.some(p => message.includes(p))) {
    return { isTransient: false, isRateLimit: false };
  }

  // Unknown error - treat as transient to be safe
  return { isTransient: true, isRateLimit: false };
}

/**
 * Gets the current cooldown state for a provider (for debugging/monitoring)
 */
export function getProviderCooldownState(providerId: string): ProviderCooldownState | null {
  return cooldownStates.get(providerId) || null;
}

/**
 * Gets all provider cooldown states (for admin/monitoring endpoints)
 */
export function getAllProviderCooldownStates(): Record<string, ProviderCooldownState> {
  const result: Record<string, ProviderCooldownState> = {};
  for (const [key, value] of cooldownStates.entries()) {
    // Include only providers with some state
    if (value.failureCount > 0 || value.isCoolingDown) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Manually clears cooldown for a provider (admin action)
 */
export function clearProviderCooldown(providerId: string): boolean {
  const state = cooldownStates.get(providerId);
  if (state) {
    state.isCoolingDown = false;
    state.cooldownUntil = 0;
    state.consecutiveFailures = 0;
    state.failureCount = 0;
    cooldownStates.set(providerId, state);
    logger.info(`Provider ${providerId} cooldown manually cleared`);
    return true;
  }
  return false;
}