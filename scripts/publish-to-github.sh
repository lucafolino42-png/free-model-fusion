#!/usr/bin/env bash
# scripts/publish-to-github.sh
# One-shot publish script. Run this once after `gh auth login`.
# Usage:
#   1. winget install --id GitHub.cli -e --source winget    # if not installed
#   2. gh auth login                                       # browser auth
#   3. ./scripts/publish-to-github.sh lucas                # replace 'lucas' with your GH username
#
# Idempotent: re-running after the initial push is a no-op for `add`+`push`,
# but `release create` will fail if the tag already exists (delete it first or
# bump to v1.0.1).

set -euo pipefail

REPO_SLUG="${1:?Usage: $0 <github-username>}"
REPO_NAME="free-model-fusion"
PUBLIC_DESC="Self-hosted AI router: every chat message is sent to multiple models in parallel, judged, and synthesized."

cd "$(dirname "$0")/.."

echo "==> Step 1/5: verifying gh auth"
gh auth status

echo "==> Step 2/5: creating repo ${REPO_SLUG}/${REPO_NAME} (public)"
gh repo create "${REPO_SLUG}/${REPO_NAME}" --public --description "${PUBLIC_DESC}" --source=. --remote=origin 2>/dev/null \
  || gh repo create "${REPO_SLUG}/${REPO_NAME}" --public --description "${PUBLIC_DESC}"  # if --source/. failed (e.g. remote already set)

echo "==> Step 3/5: pushing master"
git push -u origin master

echo "==> Step 4/5: tagging v1.0.0"
git tag -f v1.0.0
git push origin v1.0.0 --force

echo "==> Step 5/5: creating GitHub release"
gh release create v1.0.0 \
  --title "Free Model Fusion v1.0.0" \
  --notes-file <(cat <<'NOTES'
# Free Model Fusion v1.0.0

First public release.

## What it does
Routes every chat message through multiple AI models in parallel (the **expert panel**), evaluates their answers with a judge, and produces a final synthesized response. Self-hosted, single-binary, no external dependencies.

## Highlights
- **Multi-model expert panel + judge + synthesis** pipeline with automatic fallback.
- **Speed / balanced / quality / custom** routing profiles, plus a `custom` profile that lets you pick exactly which models participate.
- **Session memory** with full conversation history (cross-turn context works with cheap models).
- **Web search** via Tavily, with `off` / `auto` / `on` modes.
- **Telegram bot** with `/start` welcome, per-chat rate limiting, live token updates.
- **Custom providers** — any OpenAI-compatible endpoint (vLLM, Ollama, LM Studio, self-hosted).
- **Encrypted credential storage** (AES-256-GCM with `FUSION_SECRET_KEY`).
- **Security headers**, rate limiting, SSRF protection.
- **In-website `/docs` page** with the full API reference.
- **CI**: model-freshness check (weekly + on preset PRs).

## Tech
- Backend: **Fastify 5 + TypeScript 5.7 (strict) + Drizzle + libsql (SQLite)**.
- Frontend: hand-written vanilla SPA (no framework), accessibility-tested.
- Tests: **184 vitest tests** (pure-logic + hermetic in-memory DB + HTTP inject).
- Docker image ships UI, favicon, JS modules.

## Test plan (for reviewers)
```bash
npm install
cp .env.example .env
echo "FUSION_SECRET_KEY=$(openssl rand -hex 32)" >> .env
echo "GROQ_API_KEY=gsk_your_key" >> .env
npm run dev                # → http://localhost:3000
npx vitest run             # 184 tests
npx tsc --noEmit           # type check
npm run check:models       # live provider freshness
```

## Documentation
Open `/docs` after launching, or see `public/docs.html` / `README.md` / `CONTRIBUTING.md`.

## License
MIT — see `LICENSE`.
NOTES
)

echo ""
echo "✅ Published: https://github.com/${REPO_SLUG}/${REPO_NAME}"
echo "✅ Release:   https://github.com/${REPO_SLUG}/${REPO_NAME}/releases/tag/v1.0.0"
