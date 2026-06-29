// ─── Confidence Scoring for Fusion Results ───────────────────
// Computes a confidence score and reason for fusion responses based on
// expert success rate, judge agreement, synthesis quality, and other factors.

import type { RegisteredModel } from '../providers/types.js';

export interface ConfidenceResult {
  score: number; // 0.0 - 1.0
  level: 'very_low' | 'low' | 'medium' | 'high' | 'very_high';
  reasons: string[];
  factors: {
    expertSuccessRate: number; // 0-1
    judgeAgreement: number; // 0-1
    synthesisQuality: number; // 0-1
    webSearchUsed: boolean;
    providerErrors: number;
    complexity: string;
  };
}

interface ScoreFactors {
  expertSuccessRate: number;
  judgeAgreement: number;
  synthesisQuality: number;
  webSearchUsed: boolean;
  providerErrors: number;
  complexity: 'simple' | 'balanced' | 'complex';
}

/**
 * Compute confidence based on multiple signals from the fusion pipeline.
 * Higher score = more confident in the answer quality.
 */
export function computeConfidence(
  factors: ScoreFactors,
  expertResponses: number,
  totalExperts: number,
  judgeScores?: Record<string, number>
): ConfidenceResult {
  const reasons: string[] = [];
  let score = 0.5; // Base score

  // 1. Expert success rate (0-0.3 contribution)
  const successRate = totalExperts > 0 ? expertResponses / totalExperts : 0;
  const expertContribution = successRate * 0.3;
  score += expertContribution;
  if (successRate === 1.0) {
    reasons.push('All experts responded successfully');
  } else if (successRate >= 0.75) {
    reasons.push(`${Math.round(successRate * 100)}% of experts succeeded`);
  } else if (successRate >= 0.5) {
    reasons.push(`${Math.round(successRate * 100)}% of experts succeeded (some failed)`);
  } else {
    reasons.push(`Only ${Math.round(successRate * 100)}% of experts succeeded`);
  }

  // 2. Judge agreement (0-0.25 contribution)
  let judgeContribution = 0;
  if (judgeScores && Object.keys(judgeScores).length > 0) {
    const scores = Object.values(judgeScores);
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const spread = maxScore - minScore;

    // High agreement = low spread
    const agreement = spread <= 2 ? 1.0 : spread <= 4 ? 0.7 : 0.4;
    judgeContribution = agreement * 0.25;
    score += judgeContribution;

    if (agreement === 1.0) {
      reasons.push('Judge showed strong agreement across expert responses');
    } else if (agreement >= 0.7) {
      reasons.push('Judge showed moderate agreement');
    } else {
      reasons.push('Judge noted significant variation in expert quality');
    }
  } else {
    reasons.push('No judge evaluation (single expert or judge disabled)');
  }

  // 3. Synthesis quality indicators (0-0.2 contribution)
  let synthesisContribution = 0;
  if (factors.synthesisQuality > 0) {
    synthesisContribution = factors.synthesisQuality * 0.2;
    score += synthesisContribution;
    if (factors.synthesisQuality >= 0.8) {
      reasons.push('Synthesis produced high-quality output');
    }
  }

  // 4. Web search bonus/penalty (0.1 bonus if used successfully)
  if (factors.webSearchUsed) {
    score += 0.1;
    reasons.push('Web search provided current information');
  }

  // 5. Provider error penalty
  if (factors.providerErrors > 0) {
    const errorPenalty = Math.min(factors.providerErrors * 0.05, 0.15);
    score -= errorPenalty;
    reasons.push(`${factors.providerErrors} provider error(s) occurred`);
  }

  // 6. Complexity adjustment
  if (factors.complexity === 'complex') {
    // Complex queries need more experts to be confident
    if (successRate < 0.75) {
      score -= 0.1;
      reasons.push('Complex query with incomplete expert coverage');
    }
  } else if (factors.complexity === 'simple') {
    // Simple queries can be confident with fewer experts
    if (successRate >= 0.5) {
      score += 0.05;
      reasons.push('Simple query answered adequately');
    }
  }

  // Clamp score
  score = Math.max(0.0, Math.min(1.0, score));

  // Determine level
  let level: ConfidenceResult['level'];
  if (score >= 0.85) level = 'very_high';
  else if (score >= 0.7) level = 'high';
  else if (score >= 0.5) level = 'medium';
  else if (score >= 0.3) level = 'low';
  else level = 'very_low';

  return {
    score: Math.round(score * 100) / 100, // Round to 2 decimal places
    level,
    reasons,
    factors: {
      expertSuccessRate: Math.round(successRate * 100) / 100,
      judgeAgreement: judgeScores ? Math.round(((judgeContribution / 0.25) || 0) * 100) / 100 : 0,
      synthesisQuality: factors.synthesisQuality,
      webSearchUsed: factors.webSearchUsed,
      providerErrors: factors.providerErrors,
      complexity: factors.complexity,
    },
  };
}

/**
 * Estimate synthesis quality from response characteristics.
 * This is a heuristic - real quality would need a judge model.
 */
export function estimateSynthesisQuality(
  synthesisContent: string,
  expertResponses: Array<{ content: string; modelId: string }>,
  synthesisModel?: RegisteredModel
): number {
  if (!synthesisContent || synthesisContent.trim().length === 0) {
    return 0;
  }

  let quality = 0.5; // Base

  // Length check - not too short, not suspiciously long
  const length = synthesisContent.length;
  if (length > 100 && length < 5000) quality += 0.1;
  if (length > 500) quality += 0.1;
  if (length > 20 && length < 100) quality -= 0.1; // Very short

  // Structure check - has paragraphs, not just one block
  const paragraphs = synthesisContent.split('\n\n').filter(p => p.trim().length > 0);
  if (paragraphs.length >= 2) quality += 0.1;

  // Doesn't look like it just copied one expert
  const expertTexts = expertResponses.map(e => e.content.toLowerCase());
  const synthesisLower = synthesisContent.toLowerCase();
  let copiedFromSingle = false;
  for (const expertText of expertTexts) {
    // If >80% of expert text appears in synthesis, likely copied
    const commonWords = expertText.split(' ').filter(w => w.length > 3 && synthesisLower.includes(w)).length;
    if (commonWords / (expertText.split(' ').filter(w => w.length > 3).length || 1) > 0.8) {
      copiedFromSingle = true;
      break;
    }
  }
  if (!copiedFromSingle) quality += 0.15;
  else quality -= 0.1;

  // Contains synthesis indicators (combining, summarizing language)
  const synthesisIndicators = [
    'combined', 'synthesis', 'together', 'overall', 'summary',
    'key points', 'main points', 'in conclusion', 'to summarize',
    'both', 'also', 'additionally', 'furthermore', 'however'
  ];
  const indicatorCount = synthesisIndicators.filter(w => synthesisLower.includes(w)).length;
  if (indicatorCount >= 3) quality += 0.1;

  return Math.max(0, Math.min(1, quality));
}