import { getModelsByRole, getModelById } from '../providers/registry.js';
import { config } from '../config.js';
import type {
  RegisteredModel,
  RoutingProfile,
  ModelRole,
  SpeedClass,
  QualityClass,
} from '../providers/types.js';

// ─── Speed/Quality Value Maps ────────────────────────────
const speedOrder: Record<SpeedClass, number> = {
  very_fast: 1,
  fast: 2,
  medium: 3,
  slow: 4,
  very_slow: 5,
};

const qualityOrder: Record<QualityClass, number> = {
  basic: 1,
  good: 2,
  strong: 3,
  frontier: 4,
  reasoning: 5,
};

// ─── Routing Result ──────────────────────────────────────
export interface RoutingResult {
  experts: RegisteredModel[];
  judge: RegisteredModel | null;
  synthesis: RegisteredModel | null;
  meta: {
    profile: RoutingProfile;
    totalAvailableExperts: number;
    selectedExperts: number;
    judgeSelected: boolean;
    synthesisSelected: boolean;
  };
}

// ─── Select Experts ──────────────────────────────────────
export async function selectExperts(
  profile: RoutingProfile,
  overrides?: {
    preferredExperts?: string[];
    preferredJudge?: string | null;
    preferredSynthesis?: string | null;
  }
): Promise<RoutingResult> {
  const availableExperts = (await getModelsByRole('expert')).filter((m) => m.hasCredential);
  const availableJudges = (await getModelsByRole('judge')).filter((m) => m.hasCredential);
  const availableSynthesis = (await getModelsByRole('synthesis')).filter((m) => m.hasCredential);

  // Handle custom profile
  if (profile === 'custom' && overrides?.preferredExperts?.length) {
    const customExperts: RegisteredModel[] = [];
    for (const key of overrides.preferredExperts) {
      const model = await getModelById(key);
      if (model && model.enabled && model.useAs.includes('expert')) {
        customExperts.push(model);
      }
    }

    const judgeId = overrides.preferredJudge || overrides.preferredExperts?.[0];
    const synthesisId = overrides.preferredSynthesis || overrides.preferredExperts?.[0];

    const judge = judgeId ? (await getModelById(judgeId)) ?? null : null;
    const synthesis = synthesisId ? (await getModelById(synthesisId)) ?? null : null;

    return {
      experts: customExperts.slice(0, config.maxExperts),
      judge: judge?.useAs.includes('judge') ? judge : null,
      synthesis: synthesis?.useAs.includes('synthesis') ? synthesis : null,
      meta: {
        profile: 'custom',
        totalAvailableExperts: availableExperts.length,
        selectedExperts: customExperts.length,
        judgeSelected: !!judge,
        synthesisSelected: !!synthesis,
      },
    };
  }

  // Speed profile: prioritize fastest models
  if (profile === 'speed') {
    const sorted = [...availableExperts].sort(
      (a, b) => speedOrder[a.speedClass] - speedOrder[b.speedClass]
    );
    const selected = deduplicateProviders(sorted, config.maxExperts, config.maxExpertsPerProvider);
    const judge = pickBestForRole(availableJudges, 'speed', 'judge');
    const synthesis = pickBestForRole(availableSynthesis, 'speed', 'synthesis');

    return {
      experts: selected,
      judge,
      synthesis,
      meta: {
        profile: 'speed',
        totalAvailableExperts: availableExperts.length,
        selectedExperts: selected.length,
        judgeSelected: !!judge,
        synthesisSelected: !!synthesis,
      },
    };
  }

  // Quality profile: prioritize highest quality models
  if (profile === 'quality') {
    const sorted = [...availableExperts].sort(
      (a, b) => qualityOrder[b.qualityClass] - qualityOrder[a.qualityClass]
    );
    const selected = deduplicateProviders(sorted, Math.min(config.maxExperts + 2, 6), config.maxExpertsPerProvider + 1);
    const judge = pickBestForRole(availableJudges, 'quality', 'judge');
    const synthesis = pickBestForRole(availableSynthesis, 'quality', 'synthesis');

    return {
      experts: selected,
      judge,
      synthesis,
      meta: {
        profile: 'quality',
        totalAvailableExperts: availableExperts.length,
        selectedExperts: selected.length,
        judgeSelected: !!judge,
        synthesisSelected: !!synthesis,
      },
    };
  }

  // Balanced profile (default): mix of speed and quality
  const balanced = [...availableExperts].sort((a, b) => {
    const scoreA = speedOrder[a.speedClass] + qualityOrder[a.qualityClass];
    const scoreB = speedOrder[b.speedClass] + qualityOrder[b.qualityClass];
    return scoreA - scoreB;
  });
  const selected = deduplicateProviders(balanced, config.maxExperts, config.maxExpertsPerProvider);
  const judge = pickBestForRole(availableJudges, 'balanced', 'judge');
  const synthesis = pickBestForRole(availableSynthesis, 'balanced', 'synthesis');

  return {
    experts: selected,
    judge,
    synthesis,
    meta: {
      profile: 'balanced',
      totalAvailableExperts: availableExperts.length,
      selectedExperts: selected.length,
      judgeSelected: !!judge,
      synthesisSelected: !!synthesis,
    },
  };
}

// ─── Deduplicate Providers ───────────────────────────────
function deduplicateProviders(
  models: RegisteredModel[],
  max: number,
  maxPerProvider: number
): RegisteredModel[] {
  const providerCount = new Map<string, number>();
  const result: RegisteredModel[] = [];

  for (const model of models) {
    if (result.length >= max) break;

    const count = providerCount.get(model.providerId) || 0;
    if (count < maxPerProvider) {
      result.push(model);
      providerCount.set(model.providerId, count + 1);
    }
  }

  return result;
}

// ─── Pick Best Model for Role ────────────────────────────
function pickBestForRole(
  models: RegisteredModel[],
  profile: string,
  role: ModelRole
): RegisteredModel | null {
  if (models.length === 0) return null;

  if (profile === 'speed') {
    return models.sort(
      (a, b) => speedOrder[a.speedClass] - speedOrder[b.speedClass]
    )[0];
  }

  if (profile === 'quality') {
    return models.sort(
      (a, b) => qualityOrder[b.qualityClass] - qualityOrder[a.qualityClass]
    )[0];
  }

  // Balanced: sort by combined score
  return models.sort((a, b) => {
    const scoreA = speedOrder[a.speedClass] + qualityOrder[a.qualityClass];
    const scoreB = speedOrder[b.speedClass] + qualityOrder[b.qualityClass];
    return scoreA - scoreB;
  })[0];
}
