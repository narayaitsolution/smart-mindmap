#!/usr/bin/env bash
# Rebuild and recreate the app container when UI-related files changed.
# Usage:
#   printf '%s\n' path1 path2 | scripts/deploy-ui.sh        # deploy only if a path is UI-related
#   scripts/deploy-ui.sh --force                            # skip detection
#   scripts/deploy-ui.sh --check < paths                    # detect only, no verify/docker
# Flow: detect -> scripts/verify.sh (unless SMARTMINDMAP_VERIFIED=1)
#       -> docker compose build --no-cache -> docker compose up -d --force-recreate
# Never prunes images/cache and never touches volumes. Never calls git commit/push,
# so it cannot re-trigger safe-push or the pre-push hook. Skip: SMARTMINDMAP_SKIP_DEPLOY=1.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mode="detect"
case "${1:-}" in
  --force) mode="force" ;;
  --check) mode="check" ;;
  "") ;;
  *) echo "usage: scripts/deploy-ui.sh [--force|--check] (paths on stdin)" >&2; exit 2 ;;
esac

if [ "${SMARTMINDMAP_SKIP_DEPLOY:-}" = "1" ]; then
  echo "deploy-ui: skipped (SMARTMINDMAP_SKIP_DEPLOY=1)"
  exit 0
fi
if [ "${SMARTMINDMAP_DEPLOYING:-}" = "1" ]; then
  echo "deploy-ui: already running, refusing to recurse" >&2
  exit 0
fi
export SMARTMINDMAP_DEPLOYING=1

# UI-related = anything baked into the image bundle or served by it.
# Test files and docs/scripts do not trigger a deploy.
is_ui_path() {
  case "$1" in
    *.test.ts|*.test.tsx|src/test-setup.ts) return 1 ;;
    src/*|index.html|vite.config.ts|tsconfig.json) return 0 ;;
    package.json|package-lock.json) return 0 ;;
    Dockerfile|.dockerignore|docker-compose.yml|nginx.docker.conf) return 0 ;;
    *) return 1 ;;
  esac
}

ui_hit=""
if [ "$mode" != "force" ]; then
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if is_ui_path "$p"; then ui_hit="$p"; break; fi
  done
  if [ -z "$ui_hit" ]; then
    echo "deploy-ui: no UI-related changes, container untouched"
    exit 0
  fi
  echo "deploy-ui: UI change detected ($ui_hit)"
fi
[ "$mode" = "check" ] && exit 0

if [ "${SMARTMINDMAP_VERIFIED:-}" != "1" ]; then
  scripts/verify.sh
fi

# Single run at a time.
exec 9>"${TMPDIR:-/tmp}/smart-mindmap-deploy.lock"
if ! flock -n 9; then
  echo "deploy-ui: another deploy is running" >&2
  exit 1
fi

docker compose build --no-cache
docker compose up -d --force-recreate
echo "deploy-ui: container rebuilt and recreated"
