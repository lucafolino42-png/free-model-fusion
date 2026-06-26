import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { setTelegramWebhook, deleteTelegramWebhook } from './send.js';
import type { FastifyInstance } from 'fastify';

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

  // Set webhook if URL is configured
  if (config.telegramWebhookUrl) {
    const webhookUrl = `${config.telegramWebhookUrl.replace(/\/$/, '')}/telegram/webhook`;
    const success = await setTelegramWebhook(webhookUrl);
    if (success) {
      logger.info(`Telegram bot webhook set to: ${webhookUrl}`);
    } else {
      logger.warn('Failed to set Telegram webhook, falling back to polling');
      await startPolling();
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
      const response = await fetch(
        `https://api.telegram.org/bot${config.telegramBotToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=30&allowed_updates=["message"]`,
        { method: 'GET' }
      );

      if (!response.ok) {
        await sleep(pollInterval);
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
