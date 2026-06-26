import { db } from '../db/client.js';
import { credentials } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { encrypt, decrypt, maskApiKey } from '../utils/crypto.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

// ─── Has Credential ──────────────────────────────────────
export async function hasCredential(providerId: string): Promise<boolean> {
  // Check env vars first
  if (config.providerEnvKeys[providerId]) {
    return true;
  }

  // Check DB
  const result = await db
    .select()
    .from(credentials)
    .where(eq(credentials.providerId, providerId))
    .limit(1);

  return result.length > 0;
}

// ─── Get Credential ──────────────────────────────────────
export async function getCredential(
  providerId: string
): Promise<string | undefined> {
  // Priority: env var > DB
  if (config.providerEnvKeys[providerId]) {
    return config.providerEnvKeys[providerId];
  }

  const result = await db
    .select()
    .from(credentials)
    .where(eq(credentials.providerId, providerId))
    .limit(1);

  if (result.length > 0) {
    try {
      return decrypt(result[0].encryptedKey);
    } catch (error) {
      logger.error(`Failed to decrypt credential for ${providerId}`, {
        error: String(error),
      });
      return undefined;
    }
  }

  return undefined;
}

// ─── Save Credential ─────────────────────────────────────
export async function saveCredential(
  providerId: string,
  apiKey: string
): Promise<void> {
  const encryptedKey = encrypt(apiKey);
  const now = new Date();

  await db
    .insert(credentials)
    .values({
      providerId,
      encryptedKey,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: credentials.providerId,
      set: {
        encryptedKey,
        updatedAt: now,
      },
    });

  logger.info(`Credential saved for provider: ${providerId}`);
}

// ─── Delete Credential ───────────────────────────────────
export async function deleteCredential(
  providerId: string
): Promise<boolean> {
  const result = await db
    .delete(credentials)
    .where(eq(credentials.providerId, providerId))
    .returning();
  return result.length > 0;
}

// ─── List Credentials (masked) ───────────────────────────
export async function listCredentials(): Promise<
  Array<{
    providerId: string;
    maskedKey: string;
    source: 'env' | 'db';
  }>
> {
  const result: Array<{
    providerId: string;
    maskedKey: string;
    source: 'env' | 'db';
  }> = [];

  // Check env vars
  for (const [providerId, key] of Object.entries(config.providerEnvKeys)) {
    if (key) {
      result.push({
        providerId,
        maskedKey: maskApiKey(key),
        source: 'env',
      });
    }
  }

  // Check DB
  const dbCredentials = await db.select().from(credentials);
  for (const cred of dbCredentials) {
    // Don't duplicate if already from env
    if (!result.find((r) => r.providerId === cred.providerId)) {
      try {
        const decrypted = decrypt(cred.encryptedKey);
        result.push({
          providerId: cred.providerId,
          maskedKey: maskApiKey(decrypted),
          source: 'db',
        });
      } catch {
        result.push({
          providerId: cred.providerId,
          maskedKey: '***DECRYPT_ERROR***',
          source: 'db',
        });
      }
    }
  }

  return result;
}
