import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { setTelegramWebhook, deleteTelegramWebhook } from './send.js';
import type { FastifyInstance } from 'fastify';

// ─── Track last-registered webhook (for idempotent re-init) ─
let lastRegisteredWebhook: { url: string; token: string } | null = null;

// ─── Initialize Telegram Bot ─────────────────────────────
export async function initTelegramBot(
  fastify: FastifyInstance
): Promise<void> {
  if (!config.telegramBotToken) {
    logger.info(
      'Telegram bot disabled: TELEGRAM_BOT_TOKEN not set. ' +
        'Set it in .env to enable Telegram support.'
    );
    return;
  }

  // Register webhook route
  fastify.post('/telegram/webhook', async (request, reply) => {
    const { handleTelegramWebhook } = await import('./webhook.js');
    return handleTelegramWebhook(request, reply);
  });

  // Set webhook if URL is configured. Skip if same (token, url) was already
  // registered — avoids unnecessary Telegram API calls + log spam on restart.
  if (config.telegramWebhookUrl) {
    const webhookUrl = `${config.telegramWebhookUrl.replace(/\/$/, '')}/telegram/webhook`;
    const alreadyRegistered =
      lastRegisteredWebhook &&
      lastRegisteredWebhook.url === webhookUrl &&
      lastRegisteredWebhook.token === config.telegramBotToken;

    if (alreadyRegistered) {
      logger.debug(`Telegram webhook already registered: ${webhookUrl}`);
    } else {
      const success = await setTelegramWebhook(webhookUrl);
      if (success) {
        lastRegisteredWebhook = { url: webhookUrl, token: config.telegramBotToken };
        logger.info(`Telegram bot webhook set to: ${webhookUrl}`);
      } else {
        logger.warn('Failed to set Telegram webhook, falling back to polling');
        await startPolling();
      }
    }
  } else {
    logger.info(
      'TELEGRAM_WEBHOOK_URL not set. Use polling for local development.'
    );
    await startPolling();
  }
}

// ─── Start Polling (for local dev) ───────────────────────
async function startPolling(): Promise<void> {
  if (!config.telegramBotToken) return;

  logger.info('Starting Telegram polling mode for local development');

  // Delete any existing webhook first
  await deleteTelegramWebhook();

  // Poll in background
  startPollingLoop().catch((error) => {
    logger.error('Telegram polling error', { error: String(error) });
  });
}

// ─── Polling Loop ────────────────────────────────────────
async function startPollingLoop(): Promise<void> {
  let lastUpdateId = 0;
  const pollInterval = 2000; // 2 seconds

  // Dynamic import to avoid circular dependencies
  const { handleFusionCommand } = await import('../fusion/commandsHandler.js');

  while (true) {
    try {
      // Read the token LIVE on every iteration so updates via /api/env take
      // effect within one poll cycle (~2s), with no server restart. Also
      // gracefully no-op if the token was just cleared.
      const token = config.telegramBotToken;
      if (!token) {
        await sleep(pollInterval);
        continue;
      }

      const response = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=30&allowed_updates=["message"]`,
        { method: 'GET' }
      );

      if (!response.ok) {
        // 401/403 from Telegram means our token is bad or revoked — wait
        // longer than usual to avoid hammering the API while the operator
        // fixes the token.
        if (response.status === 401 || response.status === 403) {
          logger.warn(`Telegram polling got ${response.status}; check TELEGRAM_BOT_TOKEN.`);
          await sleep(15000);
        } else {
          await sleep(pollInterval);
        }
        continue;
      }

      const data = (await response.json()) as {
        ok: boolean;
        result: Array<{
          update_id: number;
          message?: {
            message_id: number;
            chat: { id: number; type: string };
            text?: string;
          };
        }>;
      };

      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          lastUpdateId = Math.max(lastUpdateId, update.update_id);

          const message = update.message;
          if (!message?.text) continue;

          const chatId = message.chat.id;
          const text = message.text;

          logger.debug(`Polling: message from ${chatId}: ${text.slice(0, 100)}`);

          try {
            const { sendTelegramMessage, sendChatAction } = await import('./send.js');
            await sendChatAction(chatId);

            const result = await handleFusionCommand(text, {
              sessionId: `telegram:${chatId}`,
              source: 'telegram',
            });

            await sendTelegramMessage(chatId, result.telegramHtml || result.answer, {
              replyToMessageId: message.message_id,
            });
          } catch (error) {
            logger.error('Polling command error', { error: String(error) });
          }
        }
      }
    } catch (error) {
      logger.error('Polling error', { error: String(error) });
      await sleep(pollInterval);
    }
  }
}

// ─── Utility ─────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
