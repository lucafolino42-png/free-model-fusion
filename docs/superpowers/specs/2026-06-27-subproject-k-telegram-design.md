# Sub-project K — Telegram Connection Fix (Design + Plan)

**Date:** 2026-06-27  Depends on: A–J + live-test fixes. Branch: `subproject-k-telegram`

## Problem
User reports: Telegram bot does not work after updating the token.

## Diagnosis (grounded in code)
`src/telegram/bot.ts` reads `config.telegramBotToken` once at module-load
(line 1) inside `initTelegramBot`. `config` (`src/config.ts`) is built once
when first imported and never re-reads env after that. The `/api/env`
mutation route (in `src/api/routes/env.ts`) mutates `process.env` and then
*does* mutate `config.providerEnvKeys`/`config.tavilyApiKey` directly — but
**does NOT mutate `config.telegramBotToken`**. So updating the token via UI
silently has no effect on the running polling loop; the loop keeps using
whatever value was loaded at startup.

Secondary risks to verify:
1. The webhook route is registered on every `initTelegramBot` call even if a
   webhook is already configured (idempotency + racing setWebhook).
2. There is no test for the polling loop or webhook route.
3. `setTelegramWebhook`/`deleteTelegramWebhook` — need to confirm they're
   auth-aware (use the current token, not a captured one).

## Scope (in)
1. **Read token live in the polling loop** (and webhook handler) — every
   iteration reads `process.env.TELEGRAM_BOT_TOKEN` so an update via
   `/api/env` takes effect on the next poll (within ~2s), no restart.
   `config.telegramBotToken` is kept for the early-return check and for
   `setTelegramWebhook`/`sendTelegramMessage` (these need a token at call
   time — already read from config; ensure they re-read on every call too).
2. **`/api/env` mutation propagates to config** — add `config.telegramBotToken =
   value` in the env-write route for `TELEGRAM_BOT_TOKEN`.
3. **Re-register webhook only on token change** — track last-registered
   (token, url) pair in `initTelegramBot`; skip setWebhook if unchanged
   (avoids a Telegram API call + the resulting "webhook set" log spam on
   restart). Also tolerate setWebhook failure gracefully (already does —
   falls back to polling).
4. **Tests** — for the env mutation propagation (unit) and for the polling
   loop's read-live-token behavior (mocked fetch).

## Scope (out)
- Telegram command UX, inline keyboards, richer reply formatting.
- Switching the polling loop to long-polling only (`timeout=30` already set).
- Webhook signature verification.

## Non-negotiables
- 164 existing tests stay green; tsc clean.
- Polling loop must not crash if the token is cleared mid-run.
