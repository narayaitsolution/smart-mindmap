import { isHexColor } from '../model/color';
import { clampNodeHeight, clampNodeWidth, MAX_EDGE_WIDTH, type MindNode, type Mindmap } from '../model/mindmap';
import { isSafeNoteUrl, sanitizeNote } from '../model/note';
import { appendMap, clampZoom, emptyWorkspace, MAX_MAP_IMAGE_BYTES, mapImageBytes, type Workspace } from '../model/workspace';

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export const FORMAT = 'smart-mindmap';
const MAX_NODES = 20000;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** Call with File.size before reading the file, so an oversized file is never loaded into memory. */
export function assertImportSize(bytes: number): void {
  if (bytes > MAX_IMPORT_BYTES) throw new ImportError('File is too large (max 10 MB)');
}

/** Per-map image budget for imported content. */
export function assertImportImages(map: Mindmap): Mindmap {
  if (mapImageBytes(map) > MAX_MAP_IMAGE_BYTES) throw new ImportError('Images in this map are too large (max 6 MB per map)');
  return map;
}

/** Re-sanitize every note so nothing unsafe leaves the app or reaches storage. */
export function scrubMap(map: Mindmap): Mindmap {
  let nodes: Record<string, MindNode> | null = null;
  for (const [id, n] of Object.entries(map.nodes)) {
    const note = sanitizeNote(n.note);
    const url = typeof n.url === 'string' && isSafeNoteUrl(n.url, 'link') ? n.url.trim() : undefined;
    if (note === n.note && url === n.url) continue;
    nodes ??= { ...map.nodes };
    const { note: _old, url: _url, ...rest } = n;
    nodes[id] = { ...rest, ...(note === undefined ? {} : { note }), ...(url === undefined ? {} : { url }) };
  }
  return nodes ? { ...map, nodes } : map;
}

export function exportJson(maps: Mindmap[]): string {
  return JSON.stringify({ app: FORMAT, version: 1, maps: maps.map(scrubMap) }, null, 2);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, what: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ImportError(`Invalid number: ${what}`);
  return v;
};
const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string') throw new ImportError(`Invalid text: ${what}`);
  return v;
};

function sanitizeNode(id: string, raw: unknown): MindNode {
  if (!isObj(raw)) throw new ImportError('Invalid node');
  const parentId = raw.parentId === null ? null : str(raw.parentId, 'parentId');
  const node: MindNode = {
    id,
    parentId,
    text: str(raw.text, 'text').slice(0, 2000),
    x: num(raw.x, 'x'),
    y: num(raw.y, 'y'),
  };
  if (isHexColor(raw.color)) node.color = raw.color;
  if (isHexColor(raw.edgeColor)) node.edgeColor = raw.edgeColor;
  if (typeof raw.edgeWidth === 'number' && Number.isFinite(raw.edgeWidth)) {
    node.edgeWidth = Math.min(MAX_EDGE_WIDTH, Math.max(1, raw.edgeWidth));
  }
  if (raw.collapsed === true) node.collapsed = true;
  if (typeof raw.width === 'number' && Number.isFinite(raw.width)) node.width = clampNodeWidth(raw.width);
  if (typeof raw.height === 'number' && Number.isFinite(raw.height)) node.height = clampNodeHeight(raw.height);
  const note = sanitizeNote(raw.note);
  if (note !== undefined) node.note = note;
  if (typeof raw.url === 'string' && isSafeNoteUrl(raw.url, 'link')) node.url = raw.url.trim();
  return node;
}

export function sanitizeMap(raw: unknown): Mindmap {
  if (!isObj(raw) || !isObj(raw.nodes)) throw new ImportError('Invalid map');
  const entries = Object.entries(raw.nodes);
  if (entries.length === 0 || entries.length > MAX_NODES) throw new ImportError('Invalid node count');
  const nodes: Record<string, MindNode> = {};
  for (const [id, n] of entries) nodes[id] = sanitizeNode(id, n);
  const rootId = str(raw.rootId, 'rootId');
  if (!nodes[rootId] || nodes[rootId].parentId !== null) throw new ImportError('Invalid root');
  for (const n of Object.values(nodes)) {
    if (n.id !== rootId && (n.parentId === null || !nodes[n.parentId])) throw new ImportError('Dangling parent');
    let hops = 0;
    for (let cur: MindNode | undefined = n; cur && cur.parentId !== null; cur = nodes[cur.parentId]) {
      if (++hops > entries.length) throw new ImportError('Cycle detected');
    }
  }
  // The root must be reachable: a cycle would never reach parentId === null, caught above.
  const now = Date.now();
  const stickyNotes: NonNullable<Mindmap['stickyNotes']> = {};
  if (isObj(raw.stickyNotes)) {
    for (const [id, value] of Object.entries(raw.stickyNotes)) {
      if (!isObj(value) || typeof value.text !== 'string' || typeof value.x !== 'number' || typeof value.y !== 'number') continue;
      if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) continue;
      stickyNotes[id] = { id, x: value.x, y: value.y, text: value.text.slice(0, 10000) };
    }
  }
  return {
    id: str(raw.id, 'id'),
    title: str(raw.title, 'title').slice(0, 200),
    rootId,
    nodes,
    ...(Object.keys(stickyNotes).length ? { stickyNotes } : {}),
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
  };
}

export function importJson(text: string): Mindmap[] {
  assertImportSize(text.length);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError('Not valid JSON');
  }
  if (!isObj(data) || data.app !== FORMAT || !Array.isArray(data.maps)) throw new ImportError('Not a Smart Mindmap file');
  return data.maps.map((m) => assertImportImages(sanitizeMap(m)));
}

/** Append imported maps; any id that already exists gets a fresh one. */
export function mergeImported(ws: Workspace, incoming: Mindmap[]): Workspace {
  return incoming.reduce(appendMap, ws);
}

/** Validate untrusted stored data. Returns null when unusable. */
export function sanitizeWorkspace(raw: unknown): Workspace | null {
  if (!isObj(raw) || !Array.isArray(raw.maps)) return null;
  try {
    const maps = raw.maps.map(sanitizeMap);
    const vp = isObj(raw.viewport) ? raw.viewport : {};
    const ws = emptyWorkspace();
    return {
      maps,
      activeMapId: typeof raw.activeMapId === 'string' && maps.some((m) => m.id === raw.activeMapId) ? raw.activeMapId : (maps[0]?.id ?? null),
      viewport: {
        x: typeof vp.x === 'number' && Number.isFinite(vp.x) ? vp.x : ws.viewport.x,
        y: typeof vp.y === 'number' && Number.isFinite(vp.y) ? vp.y : ws.viewport.y,
        zoom: typeof vp.zoom === 'number' && Number.isFinite(vp.zoom) ? clampZoom(vp.zoom) : 1,
      },
    };
  } catch {
    return null;
  }
}
