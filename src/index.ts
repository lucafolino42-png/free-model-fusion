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
  if (!config.secretKey && !config.isDev) {
    logger.warn(
      'FUSION_SECRET_KEY is not set. API key encryption is disabled in production. ' +
        'Set FUSION_SECRET_KEY to a random string of at least 32 characters.'
    );
  }

  if (!config.secretKey && config.isDev) {
    logger.info(
      'Dev mode: using fallback encryption key. ' +
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
