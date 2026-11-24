#!/usr/bin/env bash
# Usage: scripts/safe-push.sh "commit message"
# Runs tests + build; only on success commits current changes and pushes
# the current branch to origin. Never forces. Refuses to stage .env files.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

msg="${1:-}"
if [ -z "$msg" ]; then
  echo "usage: scripts/safe-push.sh \"commit message\"" >&2
  exit 2
fi

scripts/verify.sh

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
