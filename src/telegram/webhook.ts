import { logger } from '../utils/logger.js';
import { sendTelegramMessage, sendChatAction } from './send.js';
import { handleFusionCommand } from '../fusion/commandsHandler.js';
import { FusionError } from '../utils/errors.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

// ─── Telegram Update Type ────────────────────────────────
interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      first_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    text?: string;
    entities?: Array<{
      type: string;
      offset: number;
      length: number;
    }>;
  };
}

// ─── Handle Telegram Webhook Request ─────────────────────
export async function handleTelegramWebhook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const update = request.body as TelegramUpdate;

    // We need to acknowledge quickly
    reply.status(200).send({ ok: true });

    // Process asynchronously
    processUpdate(update).catch((error) => {
      logger.error('Error processing Telegram update', {
        error: String(error),
        updateId: update.update_id,
      });
    });
  } catch (error) {
    logger.error('Error handling Telegram webhook', {
      error: String(error),
    });
    reply.status(200).send({ ok: true }); // Always return 200 to Telegram
  }
}

// ─── Process Update ──────────────────────────────────────
async function processUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;

  if (!message?.text) {
    return;
  }

  const chatId = message.chat.id;
  const text = message.text;

  logger.debug(`Telegram message from ${chatId}: ${text.slice(0, 100)}`);

  // Send typing indicator
  sendChatAction(chatId).catch(() => {});

  try {
    const result = await handleFusionCommand(text, {
      sessionId: `telegram:${chatId}`,
      source: 'telegram',
    });

    // Send response
    if (result.telegramHtml) {
      await sendTelegramMessage(chatId, result.telegramHtml, {
        replyToMessageId: message.message_id,
      });
    } else {
      await sendTelegramMessage(chatId, result.answer, {
        replyToMessageId: message.message_id,
      });
    }
  } catch (error) {
    const errorMessage =
      error instanceof FusionError
        ? error.message
        : 'Sorry, an unexpected error occurred. Please try again.';

    logger.error('Fusion command error', { error: String(error) });

    await sendTelegramMessage(chatId, errorMessage, {
      replyToMessageId: message.message_id,
    });
  }
}
