#!/usr/bin/env bash
# scripts/configure-github.sh
# One-time setup: stamp your GitHub username into package.json + README
# placeholder so the publish script knows where to push.
#
# Usage: ./scripts/configure-github.sh <github-username>

set -euo pipefail

USERNAME="${1:?Usage: $0 <github-username>}"
cd "$(dirname "$0")/.."

# Stamp the repo URL into package.json via python (cross-platform safe).
python - <<PY
import json, pathlib
p = pathlib.Path("package.json")
pkg = json.loads(p.read_text(encoding="utf-8"))
repo = "https://github.com/${USERNAME}/free-model-fusion.git"
pkg["repository"] = {"type": "git", "url": repo}
pkg["homepage"] = f"https://github.com/${USERNAME}/free-model-fusion#readme"
pkg["bugs"] = {"url": f"https://github.com/${USERNAME}/free-model-fusion/issues"}
p.write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")
print("→ package.json: repository.url =", repo)
PY

# README badge URL uses the same slug — leave as `<your-username>` only if you
# want it baked into the README at publish time. For most users the badges
# auto-resolve per repo, so the README keeps the literal placeholder; the
# user can swap it once. Print a reminder:
echo ""
echo "→ README badges use the literal <your-username> placeholder."
echo "  Replace once in README.md (8 occurrences in the badge block at the top):"
echo "  sed -i 's|<your-username>|${USERNAME}|g' README.md"
