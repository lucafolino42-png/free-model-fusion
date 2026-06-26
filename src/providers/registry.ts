import { db } from '../db/client.js';
import { customProviders, customModels, credentials, providerOverrides } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { providerPresets, modelPresets } from './presets.js';
import { hasCredential as checkCredential } from './credentials.js';
import { config } from '../config.js';
import { validateProviderUrl } from '../utils/validateUrl.js';
import type {
  RegisteredProvider,
  RegisteredModel,
  ModelRole,
  SpeedClass,
  QualityClass,
  ProviderPreset,
} from './types.js';

// ─── Apply Provider Overrides (pure) ─────────────────────
// Overlays preset default `enabled` with any override rows. Presets are
// immutable data; overrides let users enable/disable built-ins without
// copying them into custom_providers. Exported for unit testing.
export function applyProviderOverrides(
  providers: RegisteredProvider[],
  overrides: Array<{ providerId: string; enabled: boolean }>
): RegisteredProvider[] {
  const byId = new Map(overrides.map((o) => [o.providerId, o.enabled]));
  return providers.map((p) =>
    byId.has(p.id) ? { ...p, enabled: byId.get(p.id)! } : p
  );
}

// ─── Get All Providers ───────────────────────────────────
export async function getAllProviders(): Promise<RegisteredProvider[]> {
  const [dbCustomProviders, creds] = await Promise.all([
    db.select().from(customProviders),
    db.select().from(credentials),
  ]);

  const dbCreds = new Set(creds.map((c) => c.providerId));
  const envCreds = new Set(
    Object.entries(config.providerEnvKeys)
      .filter(([, v]) => v)
      .map(([k]) => k)
  );

  function hasCred(providerId: string): boolean {
    return envCreds.has(providerId) || dbCreds.has(providerId);
  }

  const builtIns = providerPresets.map((p) => ({
    ...p,
    hasCredential: hasCred(p.id),
    isPreset: true,
  }));
  const customs = dbCustomProviders.map((p) => ({
    id: p.id,
    label: p.label,
    endpoint: p.endpoint,
    authType: p.authType,
    apiFormat: p.apiFormat,
    enabled: p.enabled,
    aliases: [p.id],
    credentialRef: p.id,
    maxOutputTokens: p.maxOutputTokens,
    speedClass: p.speedClass as SpeedClass,
    qualityClass: p.qualityClass as QualityClass,
    hasCredential: hasCred(p.id),
    isPreset: false,
  }));

  return [...builtIns, ...customs];
}

// ─── Get Enabled Providers ───────────────────────────────
export async function getEnabledProviders(): Promise<RegisteredProvider[]> {
  const all = await getAllProviders();
  return all.filter((p) => p.enabled);
}

// ─── Get Provider By ID ──────────────────────────────────
export async function getProviderById(
  id: string
): Promise<RegisteredProvider | undefined> {
  const all = await getAllProviders();
  let provider = all.find((p) => p.id === id || p.aliases.includes(id));
  if (!provider) {
    provider = all.find((p) => p.aliases.includes(id));
  }
  return provider;
}

// ─── Get All Models ──────────────────────────────────────
export async function getAllModels(): Promise<RegisteredModel[]> {
  const [providers, dbCustomModels, creds] = await Promise.all([
    getAllProviders(),
    db.select().from(customModels),
    db.select().from(credentials),
  ]);

  const dbCreds = new Set(creds.map((c) => c.providerId));
  const envCreds = new Set(
    Object.entries(config.providerEnvKeys)
      .filter(([, v]) => v)
      .map(([k]) => k)
  );

  function hasCredForProvider(providerId: string): boolean {
    return envCreds.has(providerId) || dbCreds.has(providerId);
  }

  const builtIns = modelPresets.map((m) => ({
    ...m,
    hasCredential: hasCredForProvider(m.providerId),
    isPreset: true,
  }));

  const customs = dbCustomModels.map((m) => ({
    id: m.id,
    providerId: m.providerId,
    title: m.title,
    model: m.model,
    useAs: JSON.parse(m.useAs) as ModelRole[],
    enabled: m.enabled,
    speedClass: m.speedClass as SpeedClass,
    qualityClass: m.qualityClass as QualityClass,
    maxOutputTokens: m.maxOutputTokens,
    hasCredential: hasCredForProvider(m.providerId),
    isPreset: false,
  }));

  return [...builtIns, ...customs];
}

// ─── Get Enabled Models ──────────────────────────────────
export async function getEnabledModels(): Promise<RegisteredModel[]> {
  const all = await getAllModels();
  return all.filter((m) => m.enabled);
}

// ─── Get Model By ID ─────────────────────────────────────
export async function getModelById(
  id: string
): Promise<RegisteredModel | undefined> {
  const all = await getAllModels();
  return all.find((m) => m.id === id);
}

// ─── Get Models by Provider ─────────────────────────────
export async function getModelsByProvider(
  providerId: string
): Promise<RegisteredModel[]> {
  const all = await getAllModels();
  return all.filter((m) => m.providerId === providerId);
}

// ─── Get Models by Role ──────────────────────────────────
export async function getModelsByRole(
  role: ModelRole
): Promise<RegisteredModel[]> {
  const all = await getEnabledModels();
  return all.filter((m) => m.useAs.includes(role) && m.hasCredential);
}

// ─── Add Custom Provider ─────────────────────────────────
export async function addCustomProvider(data: {
  id: string;
  label: string;
  endpoint: string;
  speedClass?: string;
  qualityClass?: string;
  maxOutputTokens?: number;
}): Promise<void> {
  // Validate URL to prevent SSRF
  validateProviderUrl(data.endpoint);

  const now = new Date();
  await db.insert(customProviders).values({
    id: data.id,
    label: data.label,
    endpoint: data.endpoint,
    authType: 'bearer',
    apiFormat: 'openai',
    enabled: true,
    speedClass: data.speedClass || 'medium',
    qualityClass: data.qualityClass || 'good',
    maxOutputTokens: data.maxOutputTokens || 8192,
    createdAt: now,
    updatedAt: now,
  });
}

// ─── Delete Custom Provider ──────────────────────────────
export async function deleteCustomProvider(id: string): Promise<boolean> {
  const result = await db
    .delete(customProviders)
    .where(eq(customProviders.id, id))
    .returning();
  return result.length > 0;
}

// ─── Toggle Provider ─────────────────────────────────────
export async function setProviderEnabled(
  id: string,
  enabled: boolean
): Promise<boolean> {
  const custom = await db
    .select()
    .from(customProviders)
    .where(eq(customProviders.id, id))
    .limit(1);

  if (custom.length > 0) {
    await db
      .update(customProviders)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(customProviders.id, id));
    return true;
  }
  return false;
}

// ─── Find Provider By Alias ──────────────────────────────
export async function findProviderByAlias(
  alias: string
): Promise<RegisteredProvider | undefined> {
  const all = await getAllProviders();
  return all.find(
    (p) =>
      p.id === alias ||
      p.aliases.includes(alias) ||
      p.id.replace(/_/g, '') === alias.replace(/_/g, '')
  );
}
