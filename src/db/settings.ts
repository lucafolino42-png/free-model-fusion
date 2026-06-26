import { db } from './client.js';
import { settings } from './schema.js';
import { eq } from 'drizzle-orm';

// ─── Get Setting ─────────────────────────────────────────
export async function getSetting(key: string): Promise<string | undefined> {
  const result = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);

  return result[0]?.value;
}

// ─── Save Setting ────────────────────────────────────────
export async function saveSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({
      key,
      value,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value,
        updatedAt: new Date(),
      },
    });
}

// ─── Delete Setting ──────────────────────────────────────
export async function deleteSetting(key: string): Promise<boolean> {
  const result = await db
    .delete(settings)
    .where(eq(settings.key, key))
    .returning();
  return result.length > 0;
}
