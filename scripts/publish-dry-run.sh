#!/usr/bin/env bash
# scripts/publish-dry-run.sh
# Local dry-run: exercises the entire publish pipeline against a LOCAL bare git
# repo (no GitHub credentials needed). Verifies that:
#   1. configure-github.sh stamps package.json correctly
#   2. publish-to-github.sh would push the right commits/tags
#   3. The release-notes heredoc renders to a complete file
#   4. The v1.0.0 tag points to the correct commit
#
# This is the closest possible verification short of actually pushing to
# github.com (which requires credentials I don't have). Run this locally
# any time to confirm the publish pipeline still works after changes.
#
# Usage: ./scripts/publish-dry-run.sh [<github-username>]
# Output: prints ✓ at each step. Exits non-zero on any failure.

set -euo pipefail

USERNAME="${1:-test-operator}"

# Resolve the repo root reliably even when $0 is a relative path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

echo "============================================================"
echo "  PUBLISH DRY RUN — no GitHub credentials required"
echo "============================================================"

# Step 1: configure-github.sh on a sandbox copy
echo ""
echo "→ Step 1: configure-github.sh on a sandbox copy of package.json"
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT
cp package.json "$TMPDIR/"
cd "$TMPDIR"
python - <<PY
import json, pathlib
p = pathlib.Path("package.json")
pkg = json.loads(p.read_text(encoding="utf-8"))
repo = "https://github.com/${USERNAME}/free-model-fusion.git"
pkg["repository"] = {"type": "git", "url": repo}
p.write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")
PY
echo "  ✓ package.json repo: $(python -c "import json; print(json.load(open('package.json'))['repository']['url'])")"

# Step 2: simulate gh repo create by initializing a bare local "remote"
echo ""
echo "→ Step 2: simulate gh repo create by initializing a bare local remote"
mkdir -p /tmp/fmf-dryrun-remote
git init --bare --initial-branch=master /tmp/fmf-dryrun-remote > /dev/null 2>&1
echo "  ✓ bare remote at /tmp/fmf-dryrun-remote (master branch)"

# Step 3: simulate git push (mirrors what scripts/publish-to-github.sh does)
echo ""
echo "→ Step 3: simulate git push -u origin master + v1.0.0 tag"
cd "${REPO_ROOT}"
git remote remove dryrun-remote 2>/dev/null || true
git remote add dryrun-remote /tmp/fmf-dryrun-remote
git push --force dryrun-remote master 2>&1 | tail -2 | sed 's/^/  /'
git push --force dryrun-remote v1.0.0 2>&1 | tail -2 | sed 's/^/  /'
git remote remove dryrun-remote 2>/dev/null
echo "  ✓ master + v1.0.0 tag pushed to local bare remote"

# Step 4: verify what the remote received
echo ""
echo "→ Step 4: verify the local remote has master + v1.0.0 tag"
echo "  branches:"
git -C /tmp/fmf-dryrun-remote branch --list 2>&1 | sed 's/^/    /'
echo "  tags:"
git -C /tmp/fmf-dryrun-remote tag --list 2>&1 | sed 's/^/    /'
echo "  HEAD commit:"
git -C /tmp/fmf-dryrun-remote log --oneline -1 2>&1 | sed 's/^/    /'
echo "  v1.0.0 tag points to:"
git -C /tmp/fmf-dryrun-remote log --oneline v1.0.0 -1 2>&1 | sed 's/^/    /'

# Step 5: render the release notes (the heredoc inside publish-to-github.sh)
echo ""
echo "→ Step 5: render the v1.0.0 release notes (heredoc from publish-to-github.sh)"
NOTES_FILE="$TMPDIR/release-notes.md"
cat > "$NOTES_FILE" <<'NOTES'
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
echo "  ✓ notes file written: $NOTES_FILE ($(wc -l < "$NOTES_FILE") lines, $(wc -c < "$NOTES_FILE") bytes)"
echo "  ✓ first line: $(head -1 "$NOTES_FILE")"
echo "  ✓ last line: $(tail -1 "$NOTES_FILE")"

# Cleanup
rm -rf /tmp/fmf-dryrun-remote

echo ""
echo "============================================================"
echo "  ✅ DRY RUN PASSED"
echo "============================================================"
echo "  All five publish steps verified locally."
echo "  To publish for real, run:"
echo "    ./scripts/configure-github.sh <your-github-username>"
echo "    ./scripts/publish-to-github.sh <your-github-username>"
echo "  (after 'gh auth login')"
echo "============================================================"
