#!/usr/bin/env bash
# Usage: scripts/safe-push.sh "commit message"
# Runs tests + build; only on success commits current changes and pushes
# the current branch to origin. Never forces. Refuses to stage .env files.
# After a successful push, if changed/pushed files are UI-related, runs
# scripts/deploy-ui.sh (docker compose build --no-cache + up -d --force-recreate).
# Set SMARTMINDMAP_SKIP_DEPLOY=1 to skip the deploy step.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

msg="${1:-}"
if [ -z "$msg" ]; then
  echo "usage: scripts/safe-push.sh \"commit message\"" >&2
  exit 2
fi

scripts/verify.sh

# Paths touched: working tree + commits not yet on upstream.
changed="$( { git diff --name-only HEAD; git ls-files -o --exclude-standard; \
  git diff --name-only '@{u}..HEAD' 2>/dev/null || true; } | sort -u )"

git add -A
if git diff --cached --name-only | grep -E '(^|/)\.env(\..*)?$' | grep -qv '\.env\.example$'; then
  git reset -q
  echo "refusing to commit .env file" >&2
  exit 1
fi

if ! git diff --cached --quiet; then
  git commit -m "$msg"
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
SMARTMINDMAP_SKIP_VERIFY=1 git push origin "$branch"

printf '%s\n' "$changed" | SMARTMINDMAP_VERIFIED=1 scripts/deploy-ui.sh
