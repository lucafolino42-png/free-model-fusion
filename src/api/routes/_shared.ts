import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Shared path constants ───────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// routes/ is one level deeper than the old routes.ts, so resolve up one more.
export const PUBLIC_DIR = path.resolve(__dirname, '../../../public');
export const ENV_FILE = path.resolve(__dirname, '../../../.env');

// ─── Mask sensitive env values for display ───────────────
export function maskValue(key: string, value: string): string {
  if (key.endsWith('_API_KEY') || key === 'FUSION_SECRET_KEY' || key === 'TELEGRAM_BOT_TOKEN') {
    if (value.length <= 8) return '***';
    return value.slice(0, 4) + '****' + value.slice(-4);
  }
  return value;
}

// ─── Read a static file from public/ ─────────────────────
export function readPublicFile(filename: string): string | null {
  try {
    return fs.readFileSync(path.join(PUBLIC_DIR, filename), 'utf-8');
  } catch {
    return null;
  }
}
