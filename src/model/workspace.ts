import { noteImageBytes } from './note';
import { mapBounds, newId, type MindNode, type Mindmap, type Point } from './mindmap';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Workspace {
  maps: Mindmap[];
  activeMapId: string | null;
  viewport: Viewport;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
export const MAP_GAP = 240;

export const emptyWorkspace = (): Workspace => ({ maps: [], activeMapId: null, viewport: { x: 0, y: 0, zoom: 1 } });

export function addMap(ws: Workspace, map: Mindmap): Workspace {
  return { ...ws, maps: [...ws.maps, map], activeMapId: map.id };
}

export function replaceMap(ws: Workspace, map: Mindmap): Workspace {
  return { ...ws, maps: ws.maps.map((m) => (m.id === map.id ? map : m)) };
}

export function replaceAllMaps(ws: Workspace, maps: Mindmap[]): Workspace {
  return { ...ws, maps, activeMapId: maps[0]?.id ?? null };
}

export function removeMap(ws: Workspace, id: string): Workspace {
  const maps = ws.maps.filter((m) => m.id !== id);
  const activeMapId = ws.activeMapId === id ? (maps.at(-1)?.id ?? null) : ws.activeMapId;
  return { ...ws, maps, activeMapId };
}

export function nextMapPosition(ws: Workspace): Point {
  if (ws.maps.length === 0) return { x: 0, y: 0 };
  return { x: Math.max(...ws.maps.map((m) => mapBounds(m).maxX)) + MAP_GAP, y: 0 };
}

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Add a map to the right of the existing ones. A colliding id is replaced. */
export function appendMap(ws: Workspace, incoming: Mindmap): Workspace {
  const b = mapBounds(incoming);
  const target = nextMapPosition(ws);
  const dx = target.x - b.minX;
  const dy = target.y - b.minY;
  const nodes: Record<string, MindNode> = {};
  for (const [k, n] of Object.entries(incoming.nodes)) nodes[k] = { ...n, x: n.x + dx, y: n.y + dy };
  const id = ws.maps.some((m) => m.id === incoming.id) ? newId() : incoming.id;
  return addMap(ws, { ...incoming, id, nodes });
}

/** Total decoded size of data images per map and per workspace. Keeps IndexedDB quota and memory bounded. */
export const MAX_MAP_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_WORKSPACE_IMAGE_BYTES = 20 * 1024 * 1024;

export function mapImageBytes(map: Mindmap): number {
  let total = 0;
  for (const n of Object.values(map.nodes)) if (n.note) total += noteImageBytes(n.note);
  return total;
}

export const workspaceImageBytes = (ws: Workspace): number => ws.maps.reduce((sum, m) => sum + mapImageBytes(m), 0);

/** True when replacing a map with `next` grows its images past the map or workspace cap. Shrinking is always allowed. */
export function exceedsImageBudget(ws: Workspace, next: Mindmap): boolean {
  const prev = ws.maps.find((m) => m.id === next.id);
  const before = prev ? mapImageBytes(prev) : 0;
  const after = mapImageBytes(next);
  if (after <= before) return false;
  return after > MAX_MAP_IMAGE_BYTES || workspaceImageBytes(ws) - before + after > MAX_WORKSPACE_IMAGE_BYTES;
}

export function importExceedsImageBudget(ws: Workspace, incoming: Mindmap[]): boolean {
  const sizes = incoming.map(mapImageBytes);
  return sizes.some((s) => s > MAX_MAP_IMAGE_BYTES) || workspaceImageBytes(ws) + sizes.reduce((a, b) => a + b, 0) > MAX_WORKSPACE_IMAGE_BYTES;
}
