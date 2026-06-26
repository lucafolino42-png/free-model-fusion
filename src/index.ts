#!/usr/bin/env node

import { config } from './config.js';
import { logger } from './utils/logger.js';
import { createServer } from './server.js';

// ─── Banner ──────────────────────────────────────────────
function printBanner(): void {
  console.log(`
  ╔════════════════════════════════════════╗
  ║        Free Model Fusion v1.0.0        ║
  ║   Self-hosted open-source AI router    ║
  ╚════════════════════════════════════════╝
  `);
}

// ─── Check Secret Key ────────────────────────────────────
function checkSecretKey(): void {
  const key = config.secretKey;
  const tooShort = key.length > 0 && key.length < 32;

  if (!key && config.isProd) {
    logger.error(
      'FUSION_SECRET_KEY is not set. Encryption of provider API keys will fail ' +
        'on first use. Set it to a random string of at least 32 characters ' +
        '(openssl rand -hex 32).'
    );
    return;
  }

  if (tooShort && config.isProd) {
    logger.error(
      `FUSION_SECRET_KEY is only ${key.length} characters; at least 32 are required. ` +
        'Encryption of provider API keys will fail on first use.'
    );
    return;
  }

  if (!key && config.isDev) {
    logger.info(
      'Dev mode: using a machine-specific fallback encryption key. ' +
        'Set FUSION_SECRET_KEY in production.'
    );
  }
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  printBanner();
  checkSecretKey();

  logger.info(`Starting Free Model Fusion...`);
  logger.info(`Database: ${config.databaseUrl}`);

  const server = await createServer();
  await server.start();
}

main().catch((error) => {
  logger.error('Fatal error during startup', { error: String(error) });
  process.exit(1);
});
