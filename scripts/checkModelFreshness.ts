#!/usr/bin/env node
// scripts/checkModelFreshness.ts
// CI job: verifies that model IDs in src/providers/presets.ts still exist on
// each provider's live model list. Exits non-zero on drift so CI fails loudly
// before stale IDs ship and break chat requests.
//
// Providers with a public (no-auth) model-list endpoint are always checked.
// Providers requiring auth are checked only when a key is available in env
// (see PROVIDER_KEY_MAP); otherwise they are skipped with a notice.
//
// Pure diff logic (diffPresets) is exported for unit testing.

import { modelPresets, providerPresets } from '../src/providers/presets.js';
import type { ModelPreset } from '../src/providers/types.js';

// ─── Provider model-list endpoints ───────────────────────
// `public: true` endpoints need no auth. Others require a key from env.
interface ProviderSource {
  providerId: string;
  url: string;
  public: boolean;
  envKey?: string;
  // Extract the set of model id strings from the JSON response.
  extractIds: (json: unknown) => string[];
}

const SOURCES: ProviderSource[] = [
  {
    providerId: 'openrouter',
    url: 'https://openrouter.ai/api/v1/models',
    public: true,
    extractIds: (json) => extractOpenRouterIds(json),
  },
  {
    providerId: 'deepinfra',
    url: 'https://api.deepinfra.com/v1/openai/models',
    public: true,
    extractIds: (json) => extractOpenAIListIds(json),
  },
  {
    providerId: 'groq',
    url: 'https://api.groq.com/openai/v1/models',
    public: false,
    envKey: 'GROQ_API_KEY',
    extractIds: (json) => extractOpenAIListIds(json),
  },
  {
    providerId: 'together',
    url: 'https://api.together.xyz/v1/models',
    public: false,
    envKey: 'TOGETHER_API_KEY',
    extractIds: (json) => extractOpenAIListIds(json),
  },
  {
    providerId: 'fireworks',
    url: 'https://api.fireworks.ai/inference/v1/models',
    public: false,
    envKey: 'FIREWORKS_API_KEY',
    extractIds: (json) => extractOpenAIListIds(json),
  },
];

// ─── Response shape helpers ──────────────────────────────
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

// OpenAI-style { data: [ { id: "..." }, ... ] }
function extractOpenAIListIds(json: unknown): string[] {
  if (!isObject(json) || !Array.isArray(json.data)) return [];
  return json.data
    .filter((d): d is Record<string, unknown> => isObject(d) && typeof d.id === 'string')
    .map((d) => d.id as string);
}

// OpenRouter { data: [ { id: "openai/gpt-4o-mini" }, ... ] } (same shape)
function extractOpenRouterIds(json: unknown): string[] {
  return extractOpenAIListIds(json);
}

// ─── Pure diff (exported for testing) ────────────────────
export interface DiffResult {
  missing: Array<{ providerId: string; modelId: string; presetTitle: string }>;
  checkedProviders: string[];
  skippedProviders: Array<{ providerId: string; reason: string }>;
}

export function diffPresets(
  presets: ModelPreset[],
  liveIdsByProvider: Record<string, Set<string>>
): DiffResult {
  const checkedProviders = Object.keys(liveIdsByProvider);
  const missing: DiffResult['missing'] = [];

  for (const preset of presets) {
    const live = liveIdsByProvider[preset.providerId];
    if (!live) continue; // provider not checked this run
    if (!live.has(preset.model)) {
      missing.push({
        providerId: preset.providerId,
        modelId: preset.model,
        presetTitle: preset.title,
      });
    }
  }

  return { missing, checkedProviders, skippedProviders: [] };
}

// ─── Main: fetch live lists, diff, exit ──────────────────
async function fetchLiveIds(source: ProviderSource): Promise<Set<string> | null> {
  const headers: Record<string, string> = {};
  if (!source.public && source.envKey) {
    const key = process.env[source.envKey];
    if (!key) return null; // skipped: no key
    headers['Authorization'] = `Bearer ${key}`;
  }

  try {
    const res = await fetch(source.url, { headers });
    if (!res.ok) {
      console.error(`  ${source.providerId}: HTTP ${res.status} — skipping`);
      return null;
    }
    const json: unknown = await res.json();
    return new Set(source.extractIds(json));
  } catch (err) {
    console.error(`  ${source.providerId}: fetch failed (${String(err)}) — skipping`);
    return null;
  }
}

async function main(): Promise<void> {
  console.log('Checking model ID freshness against live provider model lists...\n');

  const liveIdsByProvider: Record<string, Set<string>> = {};
  const skippedProviders: DiffResult['skippedProviders'] = [];

  for (const source of SOURCES) {
    // Only check providers that actually have presets.
    const hasPresets = modelPresets.some((m) => m.providerId === source.providerId);
    if (!hasPresets) continue;

    const live = await fetchLiveIds(source);
    if (live === null) {
      const reason = source.public
        ? 'fetch failed'
        : `no ${source.envKey} in env`;
      skippedProviders.push({ providerId: source.providerId, reason });
      console.log(`  ${source.providerId}: SKIPPED (${reason})`);
      continue;
    }
    liveIdsByProvider[source.providerId] = live;
    console.log(`  ${source.providerId}: ${live.size} live models`);
  }

  const result = diffPresets(modelPresets, liveIdsByProvider);
  result.skippedProviders = skippedProviders;

  console.log(`\nChecked: ${result.checkedProviders.join(', ') || '(none)'}`);
  console.log(`Skipped: ${skippedProviders.map((s) => s.providerId).join(', ') || '(none)'}`);

  if (result.missing.length === 0) {
    console.log('\n✓ All checked preset model IDs are present on their providers.');
    process.exit(0);
  }

  console.error(`\n✗ ${result.missing.length} preset model ID(s) not found on live provider lists:`);
  for (const m of result.missing) {
    console.error(`  ${m.providerId}: "${m.modelId}" (${m.presetTitle})`);
  }
  console.error('\nUpdate src/providers/presets.ts with the current model ID.');
  process.exit(1);
}

// Run only when executed directly (not when imported by tests). Use
// pathToFileURL comparison for cross-platform (Windows) robustness.
import { pathToFileURL } from 'node:url';
const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(2);
  });
}
