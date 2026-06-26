import { z } from 'zod';

// ─── Chat Request ────────────────────────────────────────
export const chatRequestSchema = z.object({
  message: z.string().min(1, 'Message is required').max(10000, 'Message too long'),
  sessionId: z.string().optional(),
  profile: z.enum(['speed', 'balanced', 'quality', 'custom']).optional(),
  web: z.enum(['on', 'off', 'auto']).optional(),
  source: z.enum(['api', 'webhook']).optional().default('api'),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

// ─── Chat Response ───────────────────────────────────────
export const chatResponseSchema = z.object({
  answer: z.string(),
  telegramHtml: z.string().optional(),
  meta: z.object({
    routing: z.object({
      profile: z.enum(['speed', 'balanced', 'quality', 'custom']),
      expertsUsed: z.number(),
      judgeUsed: z.boolean(),
      synthesisUsed: z.boolean(),
      continued: z.boolean(),
      truncated: z.boolean(),
    }),
    models: z.object({
      experts: z.array(z.string()),
      judge: z.string().optional(),
      synthesis: z.string().optional(),
    }),
    web: z.object({
      enabled: z.boolean(),
      searched: z.boolean(),
      resultsCount: z.number(),
      warning: z.string().optional(),
    }),
    memory: z.object({
      sessionId: z.string(),
      messagesLoaded: z.number(),
      messagesSaved: z.boolean(),
    }),
    tokens: z.object({
      expert: z.number(),
      judge: z.number(),
      synthesis: z.number(),
      continuation: z.number(),
      totalEstimated: z.number(),
    }),
    errors: z
      .array(
        z.object({
          provider: z.string(),
          model: z.string(),
          error: z.string(),
        })
      )
      .optional(),
  }),
});

// ─── Provider Schema ─────────────────────────────────────
export const addProviderSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().optional(),
  endpoint: z.string().url(),
  speedClass: z.string().optional(),
  qualityClass: z.string().optional(),
  maxOutputTokens: z.number().optional(),
});

// ─── Model Schema ────────────────────────────────────────
export const addModelSchema = z.object({
  provider: z.string().min(1),
  key: z.string().min(1),
  title: z.string().optional(),
  model: z.string().min(1),
  useAs: z.array(z.string()).optional(),
  speedClass: z.string().optional(),
  qualityClass: z.string().optional(),
  maxOutputTokens: z.number().optional(),
});

// ─── Key Schema ──────────────────────────────────────────
export const addKeySchema = z.object({
  providerId: z.string().min(1),
  apiKey: z.string().min(1),
});

// ─── Settings Schema ─────────────────────────────────────
export const settingsSchema = z.object({
  profile: z.enum(['speed', 'balanced', 'quality', 'custom']).optional(),
  webMode: z.enum(['on', 'off', 'auto']).optional(),
  expertMaxTokens: z.number().optional(),
  judgeMaxTokens: z.number().optional(),
  synthesisMaxTokens: z.number().optional(),
});
