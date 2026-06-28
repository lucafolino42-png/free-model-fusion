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

// ─── Bot Commands (autocomplete when typing /) ────────────
export interface BotCommand {
  command: string;
  description: string;
}

const BOT_COMMANDS: BotCommand[] = [
  { command: 'start', description: 'Show welcome message and instructions' },
  { command: 'help', description: 'Show all available commands' },
  { command: 'profile', description: 'Change routing profile (speed|balanced|quality|custom)' },
  { command: 'speed', description: 'Quick answers with fast models' },
  { command: 'balanced', description: 'Mix of speed and quality (default)' },
  { command: 'quality', description: 'Deep reasoning with strong models' },
  { command: 'models', description: 'List all available AI models' },
  { command: 'providers', description: 'List all configured providers' },
  { command: 'addkey', description: 'Add an API key for a provider' },
  { command: 'deletekey', description: 'Delete a stored API key' },
  { command: 'listkeys', description: 'Show configured API keys (masked)' },
  { command: 'add', description: 'Add a model to custom expert set' },
  { command: 'remove', description: 'Remove a model from custom expert set' },
  { command: 'web', description: 'Control web search mode (on|off|auto)' },
  { command: 'search', description: 'Perform a raw web search' },
  { command: 'memory', description: 'Show recent conversation history' },
  { command: 'newchat', description: 'Start a fresh conversation' },
  { command: 'stats', description: 'Show session statistics' },
  { command: 'tokens', description: 'Show token budget settings' },
  { command: 'wizard', description: 'Guided setup wizard' },
];

/**
 * Register bot commands with Telegram so users see autocomplete when typing /.
 * Uses default scope (all private chats + groups where the bot is admin).
 */
export async function setBotCommands(): Promise<boolean> {
  if (!config.telegramBotToken) {
    logger.warn('Cannot set bot commands: TELEGRAM_BOT_TOKEN not set');
    return false;
  }

  try {
    const response = await fetch(apiUrl('setMyCommands'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: BOT_COMMANDS }),
    });

    const data = (await response.json()) as { ok: boolean; description?: string };
    if (data.ok) {
      logger.info(`Registered ${BOT_COMMANDS.length} bot commands for autocomplete`);
    } else {
      logger.warn(`Failed to register bot commands: ${data.description}`);
    }
    return data.ok;
  } catch (error) {
    logger.error(`Error registering bot commands: ${String(error)}`);
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
