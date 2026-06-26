import { config } from '../config.js';
import { splitTelegramMessage } from '../format/splitTelegram.js';
import { logger } from '../utils/logger.js';

// ─── Telegram API Base URL ───────────────────────────────
function apiUrl(method: string): string {
  return `https://api.telegram.org/bot${config.telegramBotToken}/${method}`;
}

// ─── Send Message ────────────────────────────────────────
export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  options: {
    parseMode?: 'HTML' | 'Markdown';
    disableWebPagePreview?: boolean;
    replyToMessageId?: number;
  } = {}
): Promise<boolean> {
  if (!config.telegramBotToken) {
    logger.warn('Cannot send Telegram message: TELEGRAM_BOT_TOKEN not set');
    return false;
  }

  const chunks = splitTelegramMessage(text);

  let firstSuccess = false;

  for (let i = 0; i < chunks.length; i++) {
    try {
      const body: Record<string, unknown> = {
        chat_id: chatId,
        text: chunks[i],
        parse_mode: 'HTML',
        disable_web_page_preview: options.disableWebPagePreview ?? true,
      };

      if (options.replyToMessageId && i === 0) {
        body.reply_to_message_id = options.replyToMessageId;
      }

      const response = await fetch(apiUrl('sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.text().catch(() => 'Unknown error');
        logger.error(`Telegram send error (chunk ${i + 1}/${chunks.length}): ${errorData}`);

        // If HTML parse fails, try without parse mode
        if (response.status === 400 && options.parseMode !== undefined) {
          logger.info('Retrying chunk without parse mode');
          const retryBody = { ...body, parse_mode: undefined };
          const retry = await fetch(apiUrl('sendMessage'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(retryBody),
          });
          if (retry.ok) {
            firstSuccess = true;
            continue;
          }
        }

        if (!firstSuccess) {
          return false;
        }
      } else {
        firstSuccess = true;
      }
    } catch (error) {
      logger.error(`Telegram send network error (chunk ${i + 1}): ${String(error)}`);
      if (!firstSuccess) return false;
    }
  }

  return firstSuccess;
}

// ─── Send Chat Action ────────────────────────────────────
export async function sendChatAction(
  chatId: number | string,
  action: 'typing' | 'upload_photo' | 'record_video' | 'upload_video' | 'record_audio' | 'upload_audio' | 'upload_document' | 'find_location' | 'record_video_note' | 'upload_video_note' = 'typing'
): Promise<boolean> {
  if (!config.telegramBotToken) return false;

  try {
    const response = await fetch(apiUrl('sendChatAction'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        action,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ─── Set Webhook ─────────────────────────────────────────
export async function setTelegramWebhook(url: string): Promise<boolean> {
  if (!config.telegramBotToken) {
    logger.warn('Cannot set webhook: TELEGRAM_BOT_TOKEN not set');
    return false;
  }

  try {
    const response = await fetch(apiUrl('setWebhook'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        drop_pending_updates: true,
        allowed_updates: ['message', 'callback_query'],
      }),
    });

    const data = (await response.json()) as { ok: boolean; description?: string };
    if (data.ok) {
      logger.info(`Telegram webhook set to: ${url}`);
    } else {
      logger.error(`Telegram webhook setup failed: ${data.description}`);
    }
    return data.ok;
  } catch (error) {
    logger.error(`Telegram webhook setup error: ${String(error)}`);
    return false;
  }
}

// ─── Delete Webhook ──────────────────────────────────────
export async function deleteTelegramWebhook(): Promise<boolean> {
  if (!config.telegramBotToken) return false;

  try {
    const response = await fetch(apiUrl('deleteWebhook'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: true }),
    });
    const data = (await response.json()) as { ok: boolean };
    return data.ok;
  } catch {
    return false;
  }
}
