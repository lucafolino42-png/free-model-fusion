# Sub-project M — UI Redesign Implementation Plan (TDD)

> Steps use checkbox (`- [ ]`) syntax.

## Task 1 — F1: Settings token-budgets live-mutate config
TDD a test that POSTs `{expertMaxTokens, judgeMaxTokens, synthesisMaxTokens}`
to `/settings` and asserts `config.expertMaxTokens` etc. mutate live. Fix the
route (parallel pattern to K's telegram fix). Add UI note "applies immediately".

## Task 2 — F3: Custom-profile endpoint + UI
TDD `PUT /session/:id/preferredExperts` route (set the array; persists to
DB; switches session profile to 'custom' if non-empty). Add UI section in
Settings page with checkbox list of available models, Save button, current
state display. Hook refresh on session switch.

## Task 3 — F4 + F5: Merge /keys + /env into a single Secrets page
Add a `GET /secrets` endpoint returning `{ providerKeys: [...], envVars: [...], help }`.
Refactor `public/index.html`: remove nav item "Environment", rename to
"Secrets"; replace the two separate view blocks with one; provider keys as
primary editable table, env vars in a collapsible "Advanced" details element
with "requires restart" notes. TDD: route test for /secrets.

## Task 4 — F6: webMode 'auto' tooltips + help
Pure UI: add `title` attributes + visible help text under each dropdown
option. No test needed (static markup).

## Task 5 — F7: Memory page field-level help
UI: add small help lines under each column header (session id, message count,
created). No test needed.

## Task 6 — F8: Dashboard help section
UI: small "How to read this" panel; minor stat-card label polish.

## Task 7 — F9: /models add-flow provider dropdown
UI: replace raw provider text input in addModel modal with `<select>`
populated from `/providers`. Backend: GET /providers already returns the list.

## Task 8 — F10: Telegram /start + per-chat rate-limit
TDD:
- `/start` chat command returns a welcome message with usage instructions.
- Rate-limit (1 message / 2s per chat id) using in-memory `Map<chatId, lastTs>`;
  returns "Slow down" reply when exceeded. New test verifies the map blocks
  bursts and allows spaced messages.

## Task 9 — In-page help text everywhere + final verification
Add the `.help` panel at the top of every page (Chat, Dashboard, Providers,
Models, Secrets, Settings, Memory). Text is hand-written, concise, with
concrete examples. Run tsc + full suite + boot smoke (toggle preset, chat
round-trip, /chat with `web: 'on'` triggers Tavily mock, settings token-budget
save reflected in config).
