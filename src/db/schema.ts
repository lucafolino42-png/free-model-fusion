import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// ─── Sessions ────────────────────────────────────────────
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  source: text('source').notNull().default('telegram'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  summary: text('summary'),
  profile: text('profile').default('balanced'),
  webMode: text('web_mode').default('off'), // off | auto | on
  preferredExperts: text('preferred_experts'), // JSON array of model keys
  preferredJudge: text('preferred_judge'),
  preferredSynthesis: text('preferred_synthesis'),
});

// ─── Messages ────────────────────────────────────────────
export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // user | assistant | system
  content: text('content').notNull(),
  metadata: text('metadata'), // JSON
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// ─── Credentials ─────────────────────────────────────────
export const credentials = sqliteTable('credentials', {
  providerId: text('provider_id').primaryKey(),
  encryptedKey: text('encrypted_key').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// ─── Custom Providers ────────────────────────────────────
export const customProviders = sqliteTable('custom_providers', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  endpoint: text('endpoint').notNull(),
  authType: text('auth_type').notNull().default('bearer'),
  apiFormat: text('api_format').notNull().default('openai'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  speedClass: text('speed_class').notNull().default('fast'),
  qualityClass: text('quality_class').notNull().default('good'),
  maxOutputTokens: integer('max_output_tokens').notNull().default(8192),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// ─── Custom Models ───────────────────────────────────────
export const customModels = sqliteTable('custom_models', {
  id: text('id').primaryKey(), // model_key
  providerId: text('provider_id').notNull(),
  title: text('title').notNull(),
  model: text('model').notNull(), // actual provider model ID
  useAs: text('use_as').notNull().default('["expert"]'), // JSON array
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  speedClass: text('speed_class').notNull().default('medium'),
  qualityClass: text('quality_class').notNull().default('good'),
  maxOutputTokens: integer('max_output_tokens').notNull().default(8192),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// ─── Settings ────────────────────────────────────────────
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// ─── Type Inference ──────────────────────────────────────
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;
export type CustomProvider = typeof customProviders.$inferSelect;
export type NewCustomProvider = typeof customProviders.$inferInsert;
export type CustomModel = typeof customModels.$inferSelect;
export type NewCustomModel = typeof customModels.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
