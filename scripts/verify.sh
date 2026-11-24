#!/usr/bin/env bash
# Gate: tests and build (tsc --noEmit + vite build) must both pass.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
npm test
npm run build
