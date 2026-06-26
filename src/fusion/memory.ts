import { db } from '../db/client.js';
import { sessions, messages } from '../db/schema.js';
import { eq, desc, and, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

// ─── Get or Create Session ───────────────────────────────
export async function getOrCreateSession(
  sessionId: string,
  source: string = 'api'
): Promise<{
  id: string;
  profile: string;
  webMode: string;
  preferredExperts: string[];
  preferredJudge: string | null;
  preferredSynthesis: string | null;
  isNew: boolean;
}> {
  const existing = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (existing.length > 0) {
    const s = existing[0];
    return {
      id: s.id,
      profile: s.profile || 'balanced',
      webMode: s.webMode || 'off',
      preferredExperts: parseJsonArray(s.preferredExperts),
      preferredJudge: s.preferredJudge || null,
      preferredSynthesis: s.preferredSynthesis || null,
      isNew: false,
    };
  }

  const now = new Date();
  await db.insert(sessions).values({
    id: sessionId,
    source,
    createdAt: now,
    updatedAt: now,
    profile: config.defaultProfile,
    webMode: 'off',
  });

  logger.debug(`Created new session: ${sessionId}`);

  return {
    id: sessionId,
    profile: config.defaultProfile,
    webMode: 'off',
    preferredExperts: [],
    preferredJudge: null,
    preferredSynthesis: null,
    isNew: true,
  };
}

// ─── Get Session Messages ────────────────────────────────
export async function getSessionMessages(
  sessionId: string,
  limit: number = config.historyMessages,
  maxChars: number = config.historyChars
): Promise<
  Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>
> {
  const result = await db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit);

  // Reverse to chronological order
  const chrono = result.reverse();

  // Trim to max chars
  const trimmed: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
  let totalChars = 0;

  // Always include the most recent messages, trim from front
  const reversedTrim = [...chrono].reverse();
  for (const msg of reversedTrim) {
    const entry = {
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    };
    if (totalChars + msg.content.length > maxChars && trimmed.length > 0) {
      // Skip oldest messages if we exceed budget
      continue;
    }
    trimmed.unshift(entry);
    totalChars += msg.content.length;
  }

  return trimmed;
}

// ─── Save Message ────────────────────────────────────────
export async function saveMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await db.insert(messages).values({
    sessionId,
    role,
    content,
    metadata: metadata ? JSON.stringify(metadata) : null,
    createdAt: new Date(),
  });

  // Update session timestamp
  await db
    .update(sessions)
    .set({ updatedAt: new Date() })
    .where(eq(sessions.id, sessionId));
}

// ─── Clear Session Memory ────────────────────────────────
export async function clearSessionMemory(sessionId: string): Promise<void> {
  await db
    .delete(messages)
    .where(eq(messages.sessionId, sessionId));

  // Reset summary
  await db
    .update(sessions)
    .set({
      summary: null,
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, sessionId));

  logger.info(`Cleared memory for session: ${sessionId}`);
}

// ─── Update Session Settings ─────────────────────────────
export async function updateSessionSettings(
  sessionId: string,
  settings: {
    profile?: string;
    webMode?: string;
    preferredExperts?: string[];
    preferredJudge?: string;
    preferredSynthesis?: string;
  }
): Promise<void> {
  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (settings.profile !== undefined) updateData.profile = settings.profile;
  if (settings.webMode !== undefined) updateData.webMode = settings.webMode;
  if (settings.preferredExperts !== undefined)
    updateData.preferredExperts = JSON.stringify(settings.preferredExperts);
  if (settings.preferredJudge !== undefined)
    updateData.preferredJudge = settings.preferredJudge;
  if (settings.preferredSynthesis !== undefined)
    updateData.preferredSynthesis = settings.preferredSynthesis;

  await db
    .update(sessions)
    .set(updateData)
    .where(eq(sessions.id, sessionId));
}

// ─── Helper ──────────────────────────────────────────────
function parseJsonArray(val: string | null): string[] {
  if (!val) return [];
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
