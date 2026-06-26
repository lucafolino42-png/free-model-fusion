import crypto from 'node:crypto';
import { config } from '../config.js';
import { ConfigurationError } from './errors.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

// ─── Machine-specific dev key file ───────────────────────
// In dev mode without FUSION_SECRET_KEY, we generate a unique key
// per machine, stored in the data directory. This ensures each
// developer gets their own key, unlike a hardcoded fallback.
import fs from 'node:fs';
import path from 'node:path';

function getDevKeyFile(): string {
  const dbUrl = config.databaseUrl;
  // Extract the data directory from the DB URL
  const dataDir = dbUrl.startsWith('file:') ? path.dirname(dbUrl.slice(5)) : './data';
  return path.join(dataDir, '.dev-encryption-key');
}

function loadOrCreateDevKey(): Buffer {
  const keyFile = getDevKeyFile();
  try {
    if (fs.existsSync(keyFile)) {
      const stored = fs.readFileSync(keyFile, 'utf-8').trim();
      if (stored.length >= 32) {
        return Buffer.from(stored.slice(0, 32), 'utf-8');
      }
    }
  } catch {
    // If we can't read the file, generate a new one
  }

  // Generate a new random 32-byte hex key
  const newKey = crypto.randomBytes(16).toString('hex'); // 32 hex chars
  try {
    const dir = path.dirname(keyFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(keyFile, newKey, 'utf-8');
    // Set restrictive permissions (only owner read/write)
    try { fs.chmodSync(keyFile, 0o600); } catch { /* best effort on Windows */ }
  } catch {
    // If we can't write the key file, use an ephemeral in-memory key
    // This means keys won't persist across restarts in dev
  }

  return Buffer.from(newKey.slice(0, 32), 'utf-8');
}

function getKey(): Buffer {
  if (!config.secretKey || config.secretKey.length < 32) {
    if (config.isDev) {
      // In dev mode, use a machine-specific persisted key
      return loadOrCreateDevKey();
    }
    throw new ConfigurationError(
      'FUSION_SECRET_KEY is required for production. Set it to a random string of at least 32 characters. ' +
        'In development, a machine-specific key is generated automatically.'
    );
  }
  // Use first 32 bytes of the secret key as the encryption key
  return Buffer.from(config.secretKey.padEnd(32, 'x').slice(0, 32), 'utf-8');
}

export function encrypt(text: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf-8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag();

  // Format: iv:tag:encrypted (all hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

export function decrypt(encryptedData: string): string {
  const key = getKey();
  const parts = encryptedData.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');

  return decrypted;
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) {
    return key.slice(0, 2) + '****';
  }
  return key.slice(0, 4) + '****' + key.slice(-4);
}
