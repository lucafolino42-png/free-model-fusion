import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import * as schema from './schema.js';

const sqliteClient = createClient({
  url: config.databaseUrl,
});

export const db = drizzle(sqliteClient, { schema });

export async function initializeDatabase(): Promise<void> {
  try {
    // Create tables if they don't exist
    await sqliteClient.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL DEFAULT 'telegram',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        summary TEXT,
        profile TEXT DEFAULT 'balanced',
        web_mode TEXT DEFAULT 'off',
        preferred_experts TEXT,
        preferred_judge TEXT,
        preferred_synthesis TEXT
      )
    `);

    await sqliteClient.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    await sqliteClient.execute(`
      CREATE TABLE IF NOT EXISTS credentials (
        provider_id TEXT PRIMARY KEY,
        encrypted_key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    await sqliteClient.execute(`
      CREATE TABLE IF NOT EXISTS custom_providers (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        auth_type TEXT NOT NULL DEFAULT 'bearer',
        api_format TEXT NOT NULL DEFAULT 'openai',
        enabled INTEGER NOT NULL DEFAULT 1,
        speed_class TEXT NOT NULL DEFAULT 'fast',
        quality_class TEXT NOT NULL DEFAULT 'good',
        max_output_tokens INTEGER NOT NULL DEFAULT 8192,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    await sqliteClient.execute(`
      CREATE TABLE IF NOT EXISTS provider_overrides (
        provider_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    await sqliteClient.execute(`
      CREATE TABLE IF NOT EXISTS custom_models (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        title TEXT NOT NULL,
        model TEXT NOT NULL,
        use_as TEXT NOT NULL DEFAULT '["expert"]',
        enabled INTEGER NOT NULL DEFAULT 1,
        speed_class TEXT NOT NULL DEFAULT 'medium',
        quality_class TEXT NOT NULL DEFAULT 'good',
        max_output_tokens INTEGER NOT NULL DEFAULT 8192,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    await sqliteClient.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Create indexes
    await sqliteClient.execute(
      `CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)`
    );
    await sqliteClient.execute(
      `CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)`
    );

    logger.info('Database initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize database', {
      error: String(error),
      url: config.databaseUrl,
    });
    throw error;
  }
}

export async function closeDatabase(): Promise<void> {
  try {
    sqliteClient.close();
    logger.info('Database connection closed');
  } catch (error) {
    logger.error('Error closing database', { error: String(error) });
  }
}
