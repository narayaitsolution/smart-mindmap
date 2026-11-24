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
- **Import**: JSON or FreeMind (`.mm`).
- **Export**: JSON, FreeMind (`.mm`), PNG, JPG, SVG and PDF.
- **Optional Google Drive backup/restore** (app data folder), disabled unless a client ID is set.
- Light/dark/system theme, English and Indonesian UI, multiple mindmaps.

## Requirements

- Node.js 22 or newer (the Docker build uses `node:22-alpine`)
- npm

## Local setup

```bash
npm ci
npm run dev
```

Dev server runs at `http://localhost:5173` and binds to all interfaces.

Optional Google Drive backup: copy `.env.example` to `.env` and set `VITE_GOOGLE_CLIENT_ID`. Leave it empty to disable the feature. The value is embedded in the public bundle, so use only an OAuth Client ID, never a secret.

## Scripts

| Script | Command | Purpose |
| --- | --- | --- |
| `npm run dev` | `vite` | Start dev server |
| `npm run build` | `tsc --noEmit && vite build` | Type-check and build to `dist/` |
| `npm run preview` | `vite preview` | Serve the production build (port 4173) |
| `npm test` | `vitest run` | Run unit and component tests (jsdom) |

## Docker

```bash
docker compose up -d --build
```

Multi-stage build: Vite build, then served by non-root nginx on port 8080 inside the container. `docker-compose.yml` publishes it on `100.112.187.176:8081`; adjust the bind address for your environment. Pass `VITE_GOOGLE_CLIENT_ID` as a build arg to enable Drive backup. See `nginx.docker.conf` and `nginx.conf.example` for the CSP and server config.

## Project layout

- `src/model/`: mindmap, workspace, notes, color and viewport logic
- `src/ui/`: React components (canvas, inspector, note editor)
- `src/io/`: JSON, FreeMind, SVG, PNG/JPG and PDF import/export
- `src/storage/`: IndexedDB persistence
- `src/google/`: optional Google Drive integration
