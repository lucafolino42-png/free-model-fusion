# Contributing to Free Model Fusion

Thanks for your interest in contributing! 🎉

## Quick links
- **Docs:** open `/docs` in the running app (or see `public/docs.html`)
- **In-website help:** every page has a "How to use" panel
- **Tests:** `npm test` — 184 tests, must stay green
- **Type check:** `npm run typecheck`
- **Live config check:** `npm run check:models` — verifies `presets.ts` against provider APIs

## Development setup
```bash
git clone https://github.com/<you>/free-model-fusion.git
cd free-model-fusion
npm install
cp .env.example .env
# Add at least one provider API key to .env (e.g. GROQ_API_KEY=gsk_...)
echo "GROQ_API_KEY=sk-your-test-key" >> .env
npm run dev   # starts on http://localhost:3000
```

`tests/setup.ts` already sets deterministic env for the test suite, so tests pass without any `.env` file.

## Workflow
1. **Branch** from `master`: `git checkout -b fix/short-description` or `feat/...`.
2. **Test-first** for behavior changes. Add the failing test first, watch it fail for the expected reason, then implement until green.
3. **Keep changes focused.** One concern per PR. If you find a second bug while working, file an issue rather than expanding the PR.
4. **Run the full gate** before pushing:
   ```bash
   npx tsc --noEmit
   npx vitest run
   ```
5. **Commit messages:** conventional style preferred (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`). Reference the issue or sub-project when relevant.
6. **Open the PR** against `master`. CI runs the type check + full test suite + model-freshness check.

## Project structure
```
src/
├── api/routes/        # Fastify routes (one file per group, split from a single routes.ts)
├── fusion/            # The core fusion engine
│   ├── commands.ts              # /command parser
│   ├── commandsHandler.ts       # Top-level handleFusionCommand + the ~40 command handlers
│   ├── expertPanel.ts           # Parallel model calls
│   ├── judge.ts                 # Evaluates expert responses
│   ├── synthesis.ts             # Combines expert + judge into final answer
│   ├── continuation.ts          # Handles finish_reason: length
│   ├── memory.ts                # Sessions + messages
│   ├── routing.ts               # Expert / judge / synthesis selection per profile
│   ├── webSearch.ts             # Tavily integration
│   ├── normalizeInput.ts        # Input sanitization + session id resolution
│   └── prompts.ts               # System prompts
├── providers/         # Provider registry + credentials + presets + model client
├── telegram/          # Telegram bot, webhook, send
├── db/                # Drizzle schema, client, settings store, seed
├── utils/             # crypto, logger, errors, URL validator
└── server.ts          # Fastify assembly

public/                 # SPA (no framework): index.html + docs.html + js/utils.js (tested)
tests/                  # 184 tests across pure-logic, hermetic DB, and HTTP inject
docs/superpowers/       # Design specs + implementation plans per sub-project
scripts/                # CLI utilities (e.g. model-freshness check)
.github/workflows/      # CI: model-freshness weekly + on preset PRs
```

## Where to help
- **New providers:** add a preset to `src/providers/presets.ts` (id, endpoint, 1+ model entries with `useAs`). Add a test in `tests/presets.test.ts`.
- **Better routing strategies:** `src/fusion/routing.ts` — speed/quality scoring + provider dedup.
- **New fusion features:** judge prompts (`src/fusion/prompts.ts`), synthesis strategies, multi-round.
- **Web UI:** the SPA is intentionally framework-free. Use vanilla JS in `public/index.html` + small modules in `public/js/`. Keep `esc`/`escapeAttr` for safety.
- **Test coverage:** areas intentionally under-tested today: Telegram bot polling loop (high churn, hard to hermetically test), `/chat` integration with mocked provider fetches (we have a start in `tests/fusionPipeline.test.ts` — extend it), and the `commandsHandler.ts` command-by-command matrix.

## Coding conventions
- TypeScript strict mode. No `any`. No non-null assertions (`!`) — use type guards or explicit narrowing.
- ES modules (`import/export`).
- TDD when feasible. Watch the test fail before implementing.
- Commit messages explain *why*, not just *what*. Reference the failing scenario for bug fixes.

## Reporting bugs
Open a GitHub issue using the "Bug report" template. Include:
- What you did (exact request / UI steps)
- What you expected
- What happened (with logs from `npm run dev` if applicable)
- Your environment (Node version, OS, providers involved)

## Feature requests
Open a "Feature request" issue. Describe the use case first; the implementation can be discussed in the thread.

## Security
Found a vulnerability? Please open an issue with the `security` label, or email the maintainers directly rather than filing a public CVE-ready disclosure until we have a chance to patch.

## License
By contributing, you agree that your contributions will be licensed under the project's MIT License (see `LICENSE`).
