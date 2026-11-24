# Smart Mindmap

Browser-based mindmap editor built with React, TypeScript and Vite. Maps are stored locally in the browser (IndexedDB), so no backend or account is needed.

## Features

- **Mindmap nodes**: root node plus children on the left or right, siblings, collapse/expand with a hidden-count badge, fill color, edge color and edge width.
- **Inline editing**: double-click a node or press `F2` to edit its text in place. `Enter` or blur saves, `Escape` cancels.
- **Multiline wrapping**: long node text wraps automatically and the node grows to fit.
- **Edge resize**: drag a node edge to set width and height, or use `Alt` + arrow keys (`Shift` for larger steps). Double-click an edge or press `Alt+0` to reset to automatic size.
- **Node moving**: drag a node to reposition it. "Tidy layout" re-arranges the map.
- **Canvas panning and zoom**: drag the background to pan, scroll to zoom, plus zoom in/out and fit-to-screen controls.
- **Notes**: rich-text notes per node (bold, italic, lists, links, uploaded images) with size limits.
- **Keyboard shortcuts**: `Tab`/`Insert` add child, `Delete` remove node, `Arrow Left/Right` collapse/expand.
- **Open / Save / Save as**: `Open` picks a local `.mm` (FreeMind) or `.json` file. In browsers with the File System Access API (Chromium), `Save as` links the active map to a local `.mm` file and `Open` links an opened `.mm` file; the linked file is then rewritten every 15 s when it changed, with no further dialogs. `Save` and `Ctrl`/`Cmd`+`S` write the linked file, or open `Save as` when none is linked. Other browsers download a `.mm` file instead. Without a linked file the map stays in browser storage (IndexedDB), saved shortly after each edit and every 15 s. The browser warns before closing the tab only while changes are not yet stored.
- **Import**: JSON or FreeMind (`.mm`), through `Open`.
- **Export**: JSON, FreeMind (`.mm`), PNG, JPG, SVG and PDF.
- Sun/moon icon theme toggle (follows the OS color scheme until first toggled; the choice is stored in the browser), English-only UI, multiple mindmaps.
- The Google Drive backup code in `src/google/` and `src/ui/GoogleDriveMenu.tsx` is dormant: it is not shown in the UI.

## Server installation

### Prerequisites

| Item | Needed for | Notes |
| --- | --- | --- |
| Git | Fetching the code | Any recent version |
| Node.js 22 or newer + npm | Build, dev server, tests | Docker build uses `node:22-alpine` |
| Docker Engine + Compose v2 plugin | Container deploy (optional) | Not needed for the plain-nginx route |
| nginx | Serving `dist/` without Docker (optional) | Any recent version |

No database or backend service is needed. Maps live in each visitor's browser (IndexedDB).

### Option A: static files behind nginx

```bash
git clone <repo-url> smart-mindmap && cd smart-mindmap
npm ci
npm run build
sudo mkdir -p /var/www/smart-mindmap
sudo rsync -a --delete dist/ /var/www/smart-mindmap/dist/
sudo cp nginx.conf.example /etc/nginx/sites-available/smart-mindmap
# edit server_name and root in that file, then:
sudo ln -s /etc/nginx/sites-available/smart-mindmap /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Option B: Docker

```bash
git clone <repo-url> smart-mindmap && cd smart-mindmap
docker compose up -d --build
```

The container serves the app on port 8080 internally. `docker-compose.yml` publishes it on `100.112.187.176:8081`; edit the `ports` entry for your host before the first start.

### Option C: Node preview server (quick check only)

```bash
npm ci && npm run build && npm run preview
```

Serves `dist/` on port 4173, bound to all interfaces. Not meant for production.

### Ports

| Port | Used by |
| --- | --- |
| 5173 | `npm run dev` (Vite dev server, all interfaces) |
| 4173 | `npm run preview` |
| 8080 | nginx inside the Docker container |
| 8081 | Host side of the Docker publish (`100.112.187.176:8081`, change as needed) |
| 80 / 443 | Host nginx (Option A); terminate TLS here or at a proxy/tunnel |

### Production notes

- Serve over HTTPS. Browsers restrict some storage and file APIs on plain HTTP outside `localhost`.
- Keep the CSP and security headers from `nginx.conf.example` or `nginx.docker.conf`. They must stay in sync with `src/csp.ts` (guarded by `src/csp.test.ts`).
- Run `npm test` and `npm run build` (or `npm run verify`) before every release. `dist/` is generated; do not edit it.
- Data is per browser and per origin. Changing the domain starts with an empty workspace. Use `Save`/`Export JSON` for backups.
- Never put secrets in `.env`/build args: `VITE_*` values are embedded in the public bundle. Leave `VITE_GOOGLE_CLIENT_ID` empty; Google Drive is not exposed in the UI.
- The Docker container runs as non-root with a read-only filesystem. Rebuild with `docker compose up -d --build` to update.

## Local development

```bash
npm ci
npm run dev
```

Dev server runs at `http://localhost:5173` and binds to all interfaces.

## Scripts

| Script | Command | Purpose |
| --- | --- | --- |
| `npm run dev` | `vite` | Start dev server |
| `npm run build` | `tsc --noEmit && vite build` | Type-check and build to `dist/` |
| `npm run preview` | `vite preview` | Serve the production build (port 4173) |
| `npm test` | `vitest run` | Run unit and component tests (jsdom) |
| `npm run verify` | `bash scripts/verify.sh` | Run tests and build; fails if either fails |
| `npm run hooks:install` | `git config core.hooksPath .githooks` | Enable the tracked `pre-push` hook (once per clone) |
| `npm run push:safe -- "message"` | `bash scripts/safe-push.sh` | Verify, then commit all changes and push the current branch (never forced), then redeploy the container if UI files changed |
| `npm run deploy:ui` | `bash scripts/deploy-ui.sh --force` | Verify, then rebuild and recreate the container unconditionally |

## Safe push automation

Git cannot detect arbitrary file edits by itself. Pushes are gated in two ways:

- `npm run hooks:install` once per clone. The tracked `.githooks/pre-push` hook then runs tests and build before every `git push` and aborts on failure. Hooks are local, so each clone must install them, and `git push --no-verify` bypasses them.
- `npm run push:safe -- "message"` runs verification, commits, and pushes in one step. It refuses to stage `.env` files.

## UI change deploy rule

Rule: after a UI change is verified, the container is rebuilt and recreated. `scripts/safe-push.sh` does this automatically after a successful push by piping changed paths to `scripts/deploy-ui.sh`:

1. Detect: any changed path in `src/` (excluding `*.test.ts(x)` and `src/test-setup.ts`), `index.html`, `vite.config.ts`, `tsconfig.json`, `package.json`, `package-lock.json`, `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `nginx.docker.conf`. Docs, scripts and tests alone do not trigger.
2. Verify: `scripts/verify.sh` (tests + build). Failure aborts before any Docker command.
3. Deploy: `docker compose build --no-cache`, then `docker compose up -d --force-recreate`.

Safety and limits:

- Never runs `docker system prune`, `docker builder prune`, `docker compose down -v` or anything touching volumes or global cache. `--no-cache` applies to this project build only.
- No loops: the deploy script never commits or pushes, ignores recursive calls (`SMARTMINDMAP_DEPLOYING`), and takes a lock so only one deploy runs at a time.
- Handles no secrets. `VITE_GOOGLE_CLIENT_ID` (unused by the UI for now) is a public OAuth Client ID only.
- Only runs through `safe-push.sh` or `npm run deploy:ui`. Plain `git push` (pre-push hook) and direct file edits do not deploy. Requires Docker access on the machine running the script.
- Skip with `SMARTMINDMAP_SKIP_DEPLOY=1`. Detection-only: `printf '%s\n' src/ui/App.tsx | scripts/deploy-ui.sh --check`.
- The container briefly restarts on deploy.

## Docker

```bash
docker compose up -d --build
```

Multi-stage build: Vite build, then served by non-root nginx on port 8080 inside the container. `docker-compose.yml` publishes it on `100.112.187.176:8081`; adjust the bind address for your environment. See `nginx.docker.conf` and `nginx.conf.example` for the CSP and server config.

## Project layout

- `src/model/`: mindmap, workspace, notes, color and viewport logic
- `src/ui/`: React components (canvas, inspector, note editor)
- `src/io/`: JSON, FreeMind, SVG, PNG/JPG and PDF import/export
- `src/storage/`: IndexedDB persistence
- `src/google/`: dormant Google Drive integration (not shown in the UI)
