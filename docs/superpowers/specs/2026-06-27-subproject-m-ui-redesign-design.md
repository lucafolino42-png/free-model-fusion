# Sub-project M — UI Redesign + In-page Instructions (Design)

**Date:** 2026-06-27  Depends on: A–L. Branch: `subproject-m-ui`

## Goal
Make the dashboard genuinely easy to use: address every flaw surfaced by L's
audit, add in-page help text everywhere, and ship the custom-model-combinations
UI the user explicitly requested. "Every detail perfect" — every page gets
explanatory text, every action is unambiguous, no dead UI.

## Scope (F1–F10 from L audit, all in)
1. **F1 — Settings token-budgets are a no-op** → fix `/settings` POST to
   mutate `config.*` live (matches K's pattern for telegram). UI gains a
   small note: "These apply immediately, no restart."
2. **F3 — Custom model combinations UI** → new "Custom Profile" section in
   Settings page: checkbox list of available models, Add/Remove buttons,
   call `POST /session/preferredExperts` (new endpoint) or update via existing
   `/add` chat command plumbing. Show current session's preferred experts.
3. **F4 — Env vs DB mental model** → merge `/keys` + `/env` into one
   **Secrets** page. Provider keys (DB-editable) as primary; environment
   variables in a collapsible "Advanced" section showing source + a clear
   note "Changes to env vars require server restart; DB keys apply live."
4. **F5 — `/env` shows system vars that aren't runtime-editable** →
   addressed by F4's collapse. The env section is read-only by design.
5. **F6 — webMode 'auto' explained** → tooltip + help-text under the
   webMode dropdown: "off: never search; on: always search; auto: search
   when the user asks about current events/recent info."
6. **F7 — Memory page help** → field-level help text.
7. **F8 — Dashboard polish** → small wins: clearer labels, help section.
8. **F9 — `/models` add flow** → preset providers dropdown instead of
   raw text input.
9. **F10 — Telegram: /start + per-chat rate-limit** → /start returns a
   welcome message with usage instructions; rate-limit (e.g. 1 message / 2s
   per chat id) using an in-memory map.
10. **In-page help text everywhere** — every page gets a "How to use this" panel
    at top with concrete steps + examples. Uses the existing `.help` CSS
    pattern (already styled in index.html).

## Architectural decision
- `/env` route: stays for backward-compat read-only; new `GET /secrets`
  aggregates keys + env. The `/env` page in the UI is removed; nav item
  "Environment" becomes "Secrets".
- The `/keys` POST/DELETE and `/api/env` GET/POST routes remain as-is; M
  consumes them but doesn't add new routes unless F3 needs them (it can use
  existing chat-command plumbing or a new `PUT /session/:id/preferredExperts`).

## Out of scope
- Re-architecting `commandsHandler.ts` (deferred since C; not part of UI).
- New color palette / redesign beyond fixes (existing dark UI aligns with
  ui-ux-pro-max recommendations; no need to rebrand).

## Non-negotiables
- 168 tests stay green; tsc clean.
- Every new behavior has a test (TDD).
- All XSS guards from D preserved.
- Help text uses `esc()` for any user-controlled content.
