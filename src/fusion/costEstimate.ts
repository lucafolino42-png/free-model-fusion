/**
 * Simple per-call cost estimator based on model speed/quality class.
 * These are rough order-of-magnitude estimates for common API providers.
 * Actual costs vary by provider, model, and token count.
 *
 * Note: When race mode is active, the total estimate includes ALL selected
 * experts even though some calls may be discarded mid-flight. This means
 * the estimate may slightly overstate actual costs during race mode.
 */

import type { SpeedClass, QualityClass } from '../providers/types.js';

/** Estimated cost per API call in USD, based on model tier. */
function speedCost(speed: SpeedClass): number {
  switch (speed) {
    case 'very_fast': return 0.00005;
    case 'fast':      return 0.0001;
    case 'medium':    return 0.0005;
    case 'slow':      return 0.002;
    case 'very_slow': return 0.005;
  }
}

function qualityCost(quality: QualityClass): number {
  switch (quality) {
    case 'basic':     return 0.00005;
    case 'good':      return 0.0002;
    case 'strong':    return 0.001;
    case 'frontier':  return 0.005;
    case 'reasoning': return 0.01;
  }
}

/**
 * Estimate the cost of a single model call based on its speed and quality
 * class. Uses the higher of the two estimates (speed-based or quality-based).
 */
export function estimateCallCost(
  speedClass: SpeedClass,
  qualityClass: QualityClass
): number {
  // Use the HIGHER estimate — a model that's both fast and high-quality
  // (unusual but possible) is priced at the quality tier.
  return Math.max(speedCost(speedClass), qualityCost(qualityClass));
}

/**
 * Estimate total cost for a set of model IDs, given their speed/quality
 * classes. Models are passed as an array of objects with speedClass/qualityClass.
 */
export function estimateTotalCost(
  calls: Array<{
    speedClass: SpeedClass;
    qualityClass: QualityClass;
    count?: number;
  }>
): number {
  let total = 0;
  for (const call of calls) {
    const count = call.count ?? 1;
    total += estimateCallCost(call.speedClass, call.qualityClass) * count;
  }
  return total;
}
