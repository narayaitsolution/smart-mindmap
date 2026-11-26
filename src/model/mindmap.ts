import { cleanNote, isSafeNoteUrl } from './note';

export interface MindNode {
  id: string;
  parentId: string | null;
  text: string;
  x: number;
  y: number;
  /** Fill color. Undefined means transparent. */
  color?: string;
  /** Color of the edge from the parent. Undefined means black. */
  edgeColor?: string;
  /** Stroke width of the edge from the parent. Undefined means default. */
  edgeWidth?: number;
  collapsed?: boolean;
  /** Manual width in px. Undefined means the width follows the text. */
  width?: number;
  /** Manual minimum height in px. The box still grows to fit wrapped text. */
  height?: number;
  /** Sanitized HTML note (see model/note.ts). Undefined means no note. */
  note?: string;
  url?: string;
}

export interface StickyNote {
  id: string;
  x: number;
  y: number;
  text: string;
}

export interface Mindmap {
  id: string;
  title: string;
  rootId: string;
  nodes: Record<string, MindNode>;
  stickyNotes?: Record<string, StickyNote>;
  createdAt: number;
  updatedAt: number;
}

export interface Point {
  x: number;
  y: number;
}

export const GAP_X = 80;
export const GAP_Y = 16;
export const NODE_HEIGHT = 40;
export const DEFAULT_EDGE_COLOR = '#000000';
export const DEFAULT_EDGE_WIDTH = 2;
export const MAX_EDGE_WIDTH = 12;

export function newId(): string {
  const raw =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  // Letter prefix keeps keys non-numeric so object insertion order stays stable.
  return `n${raw.replace(/-/g, '').slice(0, 16)}`;
}

export const MIN_NODE_WIDTH = 64;
export const MAX_NODE_WIDTH = 640;
export const MAX_NODE_HEIGHT = 640;
export const LINE_HEIGHT = 18;
const CHAR_WIDTH = 8;
const PAD_X = 36;
const PAD_Y = 22;

export const clampNodeWidth = (w: number): number => Math.round(Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, w)));
export const clampNodeHeight = (h: number): number => Math.round(Math.min(MAX_NODE_HEIGHT, Math.max(NODE_HEIGHT, h)));

type Sizable = Pick<MindNode, 'text'> & Partial<Pick<MindNode, 'width' | 'height'>>;

/**
 * Estimated advance of one character at the 14px label size. Latin text uses the 8px budget the
 * node width was always sized with; wide glyphs (CJK, emoji, capitals like W and M) get more room so
 * wrapped lines stay inside the box instead of spilling past its border.
 */
function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x80) return /[WM@%]/.test(ch) ? 13 : /[A-Z]/.test(ch) ? 10 : CHAR_WIDTH;
  const wide =
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd);
  return wide ? 15 : 9;
}

const textWidth = (s: string): number => Array.from(s).reduce((sum, ch) => sum + charWidth(ch), 0);

function resolveWidth(node: Sizable): number {
  if (node.width !== undefined) return clampNodeWidth(node.width);
  return Math.min(280, Math.max(96, textWidth(node.text.replace(/\s+/g, ' ').trim()) + PAD_X));
}

/**
 * Greedy word wrap on a pixel budget. Words wider than a line are broken between characters, and
 * every line keeps at least one character so no text is ever dropped.
 */
export function wrapText(text: string, maxWidth: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  const max = Math.max(CHAR_WIDTH, maxWidth);
  if (textWidth(clean) <= max) return [clean];
  const lines: string[] = [];
  let cur = '';
  let curW = 0;
  const flush = () => {
    if (cur) lines.push(cur);
    cur = '';
    curW = 0;
  };
  for (const word of clean.split(' ')) {
    const wordW = textWidth(word);
    if (cur && curW + CHAR_WIDTH + wordW <= max) {
      cur += ` ${word}`;
      curW += CHAR_WIDTH + wordW;
      continue;
    }
    flush();
    if (wordW <= max) {
      cur = word;
      curW = wordW;
      continue;
    }
    for (const ch of Array.from(word)) {
      const w = charWidth(ch);
      if (cur && curW + w > max) flush();
      cur += ch;
      curW += w;
    }
  }
  flush();
  return lines;
}

/** The lines drawn inside a node, wrapped to its current width. */
export function nodeLines(node: Sizable): string[] {
  return wrapText(node.text, resolveWidth(node) - PAD_X);
}

export function nodeSize(node: Sizable): { width: number; height: number } {
  const width = resolveWidth(node);
  const fit = nodeLines(node).length * LINE_HEIGHT + PAD_Y;
  const height = Math.max(NODE_HEIGHT, fit, node.height === undefined ? 0 : clampNodeHeight(node.height));
  return { width, height };
}

/** Single-line label that fits inside the node box. Used where wrapping is not possible. */
export function fitText(text: string): string {
  const budget = nodeSize({ text }).width - PAD_X;
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  if (textWidth(chars.join('')) <= budget) return chars.join('');
  let out = '';
  for (const ch of chars) {
    if (textWidth(out + ch + '…') > budget) break;
    out += ch;
  }
  return `${out || chars[0]}…`;
}

export function createMindmap(opts: {
  id: string;
  title: string;
  rootText: string;
  at: Point;
  now?: number;
}): Mindmap {
  const now = opts.now ?? Date.now();
  const rootId = `${opts.id}:root`;
  return {
    id: opts.id,
    title: opts.title,
    rootId,
    nodes: { [rootId]: { id: rootId, parentId: null, text: opts.rootText, x: opts.at.x, y: opts.at.y } },
    createdAt: now,
    updatedAt: now,
  };
}

export function createStickyNote(map: Mindmap, id: string, x: number, y: number): Mindmap {
  const stickyNotes = { ...(map.stickyNotes ?? {}), [id]: { id, x, y, text: '' } };
  return { ...map, stickyNotes, updatedAt: Date.now() };
}

export function updateStickyNote(map: Mindmap, id: string, text: string): Mindmap {
  const note = map.stickyNotes?.[id];
  if (!note) return map;
  return { ...map, stickyNotes: { ...map.stickyNotes, [id]: { ...note, text: text.slice(0, 10000) } }, updatedAt: Date.now() };
}

export function moveStickyNote(map: Mindmap, id: string, x: number, y: number): Mindmap {
  const note = map.stickyNotes?.[id];
  if (!note || (note.x === x && note.y === y)) return map;
  return { ...map, stickyNotes: { ...map.stickyNotes, [id]: { ...note, x, y } }, updatedAt: Date.now() };
}

export function deleteStickyNote(map: Mindmap, id: string): Mindmap {
  if (!map.stickyNotes?.[id]) return map;
  const stickyNotes = { ...map.stickyNotes };
  delete stickyNotes[id];
  return { ...map, stickyNotes, updatedAt: Date.now() };
}

export function childrenOf(map: Mindmap, id: string): MindNode[] {
  return Object.values(map.nodes).filter((n) => n.parentId === id);
}

export function descendantIds(map: Mindmap, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const c of childrenOf(map, cur)) {
      out.push(c.id);
      stack.push(c.id);
    }
  }
  return out;
}

function subtreeBottom(map: Mindmap, id: string): number {
  let bottom = 0;
  for (const nid of [id, ...descendantIds(map, id)]) {
    const n = map.nodes[nid];
    bottom = Math.max(bottom, n.y + nodeSize(n).height);
  }
  return bottom;
}

function touch(map: Mindmap, nodes: Record<string, MindNode>): Mindmap {
  return { ...map, nodes, updatedAt: Date.now() };
}

export type Side = 'left' | 'right';

/** Which side of its parent a node sits on, derived from geometry so it survives drags and import. */
export function sideOf(map: Mindmap, node: MindNode): Side {
  const parent = node.parentId === null ? undefined : map.nodes[node.parentId];
  return parent && node.x + nodeSize(node).width < parent.x ? 'left' : 'right';
}

export function childrenOnSide(map: Mindmap, id: string, side: Side): MindNode[] {
  return childrenOf(map, id).filter((c) => sideOf(map, c) === side);
}

function addChildRaw(map: Mindmap, parentId: string, id: string, text = 'Topic', side: Side = 'right'): Mindmap {
  const parent = map.nodes[parentId];
  if (!parent) return map;
  const siblings = childrenOnSide(map, parentId, side);
  const x = side === 'left' ? parent.x - GAP_X - nodeSize({ text }).width : parent.x + nodeSize(parent).width + GAP_X;
  const y = siblings.length
    ? Math.max(...siblings.map((s) => subtreeBottom(map, s.id))) + GAP_Y
    : parent.y + (nodeSize(parent).height - NODE_HEIGHT) / 2;
  const nodes = { ...map.nodes, [parentId]: { ...parent }, [id]: { id, parentId, text, x, y } as MindNode };
  if (parent.collapsed) delete nodes[parentId].collapsed;
  return touch(map, nodes);
}

function addSiblingRaw(map: Mindmap, siblingId: string, id: string, text = 'Topic'): Mindmap {
  const ref = map.nodes[siblingId];
  if (!ref || ref.parentId === null) return map;
  const created: MindNode = {
    id,
    parentId: ref.parentId,
    text,
    x: ref.x,
    y: subtreeBottom(map, siblingId) + GAP_Y,
  };
  // Insert right after the reference so export/layout order matches intent.
  const nodes: Record<string, MindNode> = {};
  const after = new Set([siblingId, ...descendantIds(map, siblingId)]);
  const entries = Object.entries(map.nodes);
  const lastIndex = entries.reduce((acc, [k], i) => (after.has(k) ? i : acc), -1);
  entries.forEach(([k, v], i) => {
    nodes[k] = v;
    if (i === lastIndex) nodes[id] = created;
  });
  return touch(map, nodes);
}

export function addChild(map: Mindmap, parentId: string, id: string, text = 'Topic', side: Side = 'right'): Mindmap {
  return resolveSiblingOverlaps(addChildRaw(map, parentId, id, text, side), id);
}

export function addSibling(map: Mindmap, siblingId: string, id: string, text = 'Topic'): Mindmap {
  return resolveSiblingOverlaps(addSiblingRaw(map, siblingId, id, text), id);
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const rectsOverlap = (a: Rect, b: Rect): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Keeps sibling blocks (a node plus its visible subtree) on one side of a parent from overlapping.
 * `id` is the node that just changed, by creation or by a finished drag. Its block stays where it
 * is; any sibling block it overlaps is shifted vertically, as a rigid subtree, just far enough to
 * leave GAP_Y. The same is repeated for each ancestor, since their blocks may have grown. Blocks
 * that do not overlap are never moved, so manual layout survives. Returns `map` when nothing moves.
 */
export function resolveSiblingOverlaps(map: Mindmap, id: string): Mindmap {
  if (!map.nodes[id]) return map;
  const kids = new Map<string, string[]>();
  for (const n of Object.values(map.nodes)) {
    if (n.parentId !== null) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n.id]);
  }
  const nodes: Record<string, MindNode> = { ...map.nodes };
  const visibleBlock = (root: string): string[] => {
    const out: string[] = [];
    const stack = [root];
    while (stack.length) {
      const cur = stack.pop() as string;
      out.push(cur);
      if (!nodes[cur].collapsed) stack.push(...(kids.get(cur) ?? []));
    }
    return out;
  };
  const rectOf = (root: string): Rect => {
    const r: Rect = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const nid of visibleBlock(root)) {
      const n = nodes[nid];
      const size = nodeSize(n);
      r.left = Math.min(r.left, n.x);
      r.top = Math.min(r.top, n.y);
      r.right = Math.max(r.right, n.x + size.width);
      r.bottom = Math.max(r.bottom, n.y + size.height);
    }
    return r;
  };
  const shift = (root: string, dy: number) => {
    for (const nid of [root, ...descendantIds({ ...map, nodes }, root)]) nodes[nid] = { ...nodes[nid], y: nodes[nid].y + dy };
  };

  let changed = false;
  for (let cur = id; nodes[cur].parentId !== null; cur = nodes[cur].parentId as string) {
    const parentId = nodes[cur].parentId as string;
    const side = sideOf({ ...map, nodes }, nodes[cur]);
    const others = (kids.get(parentId) ?? []).filter((k) => k !== cur && sideOf({ ...map, nodes }, nodes[k]) === side);
    if (others.length === 0) continue;
    const anchor = rectOf(cur);
    const placed: Rect[] = [anchor];
    const rects = new Map(others.map((k) => [k, rectOf(k)]));
    const topOf = (k: string) => (rects.get(k) as Rect).top;
    const below = others.filter((k) => topOf(k) >= anchor.top).sort((a, b) => topOf(a) - topOf(b));
    const above = others.filter((k) => topOf(k) < anchor.top).sort((a, b) => (rects.get(b) as Rect).bottom - (rects.get(a) as Rect).bottom);
    for (const [group, dir] of [[below, 1], [above, -1]] as const) {
      for (const k of group) {
        let r = rects.get(k) as Rect;
        const hits = placed.filter((p) => rectsOverlap(p, r));
        if (hits.length) {
          const dy = dir === 1 ? Math.max(...hits.map((p) => p.bottom)) + GAP_Y - r.top : Math.min(...hits.map((p) => p.top)) - GAP_Y - r.bottom;
          shift(k, dy);
          r = { ...r, top: r.top + dy, bottom: r.bottom + dy };
          changed = true;
        }
        placed.push(r);
      }
    }
  }
  return changed ? touch(map, nodes) : map;
}

export function reparentNode(map: Mindmap, id: string, parentId: string): Mindmap {
  const node = map.nodes[id];
  const parent = map.nodes[parentId];
  if (!node || !parent || id === map.rootId || id === parentId || node.parentId === parentId) return map;
  if (descendantIds(map, id).includes(parentId)) return map;

  const childSize = nodeSize(node);
  const nextX = parent.x + nodeSize(parent).width + GAP_X;
  const siblingBlocks = childrenOnSide(map, parentId, 'right').filter((child) => child.id !== id);
  const nextY = siblingBlocks.length
    ? Math.max(...siblingBlocks.map((child) => subtreeBottom(map, child.id))) + GAP_Y
    : parent.y + (nodeSize(parent).height - childSize.height) / 2;
  const moved = moveSubtree(map, id, nextX, nextY);
  const nextNode = { ...moved.nodes[id], parentId };
  const nodes = { ...moved.nodes, [id]: nextNode };
  if (parent.collapsed) {
    const nextParent = { ...parent };
    delete nextParent.collapsed;
    nodes[parentId] = nextParent;
  }
  return resolveSiblingOverlaps(touch(map, nodes), id);
}

export function moveSubtree(map: Mindmap, id: string, x: number, y: number): Mindmap {
  const node = map.nodes[id];
  if (!node) return map;
  const dx = x - node.x;
  const dy = y - node.y;
  if (dx === 0 && dy === 0) return map;
  const nodes = { ...map.nodes };
  for (const nid of [id, ...descendantIds(map, id)]) {
    const n = nodes[nid];
    nodes[nid] = { ...n, x: n.x + dx, y: n.y + dy };
  }
  return touch(map, nodes);
}

export interface NodeSizePatch {
  width?: number;
  height?: number;
  /** Which vertical edge stays put when the width changes. Defaults to the edge facing the parent. */
  anchor?: 'left' | 'right';
  /** Which horizontal edge stays put when the height changes. Defaults to the top edge. */
  anchorY?: 'top' | 'bottom';
}

/**
 * Sets the manual size of a node, or clears it with null. The anchored edge stays where it is,
 * and the children hanging off the edge that moved follow it so gaps and sides stay intact.
 */
export function resizeNode(map: Mindmap, id: string, size: NodeSizePatch | null): Mindmap {
  const node = map.nodes[id];
  if (!node) return map;
  const next: MindNode = { ...node };
  if (size === null) {
    delete next.width;
    delete next.height;
  } else {
    if (size.width !== undefined && Number.isFinite(size.width)) next.width = clampNodeWidth(size.width);
    if (size.height !== undefined && Number.isFinite(size.height)) next.height = clampNodeHeight(size.height);
  }
  const dw = nodeSize(next).width - nodeSize(node).width;
  const anchor = size?.anchor ?? (node.parentId !== null && sideOf(map, node) === 'left' ? 'right' : 'left');
  if (anchor === 'right') next.x = node.x - dw;
  if (size?.anchorY === 'bottom') next.y = node.y - (nodeSize(next).height - nodeSize(node).height);
  if (next.width === node.width && next.height === node.height && next.x === node.x && next.y === node.y) return map;
  const nodes = { ...map.nodes, [id]: next };
  if (dw !== 0) {
    const shifts: Record<Side, number> = anchor === 'left' ? { right: dw, left: 0 } : { right: 0, left: -dw };
    for (const side of ['left', 'right'] as const) {
      if (shifts[side] === 0) continue;
      for (const child of childrenOnSide(map, id, side)) {
        for (const nid of [child.id, ...descendantIds(map, child.id)]) nodes[nid] = { ...nodes[nid], x: nodes[nid].x + shifts[side] };
      }
    }
  }
  return touch(map, nodes);
}

export function toggleCollapse(map: Mindmap, id: string): Mindmap {
  const node = map.nodes[id];
  if (!node || childrenOf(map, id).length === 0) return map;
  const next = { ...node };
  if (node.collapsed) delete next.collapsed;
  else next.collapsed = true;
  return touch(map, { ...map.nodes, [id]: next });
}

export type NodePatch = Partial<Pick<MindNode, 'text' | 'color' | 'edgeColor' | 'edgeWidth' | 'note' | 'url'>>;

export function updateNode(map: Mindmap, id: string, patch: NodePatch): Mindmap {
  const node = map.nodes[id];
  if (!node) return map;
  if (typeof patch.url === 'string') {
    const url = patch.url.trim();
    if (url && !isSafeNoteUrl(url, 'link')) return map;
    patch = { ...patch, url: url || undefined };
  }
  if (typeof patch.note === 'string') {
    const cleaned = cleanNote(patch.note);
    // An oversized note is refused so the previous one survives.
    if (cleaned.tooLarge) return map;
    patch = { ...patch, note: cleaned.html };
  }
  const next: MindNode = { ...node, ...patch };
  for (const key of Object.keys(patch) as (keyof NodePatch)[]) {
    if (patch[key] === undefined) delete next[key];
  }
  return touch(map, { ...map.nodes, [id]: next });
}

export function deleteNode(map: Mindmap, id: string): Mindmap {
  const node = map.nodes[id];
  if (!node || node.parentId === null) return map;
  const doomed = new Set([id, ...descendantIds(map, id)]);
  const nodes: Record<string, MindNode> = {};
  for (const [k, v] of Object.entries(map.nodes)) if (!doomed.has(k)) nodes[k] = v;
  return touch(map, nodes);
}

/** Removes one node and re-attaches its children to its parent. The root cannot be removed. */
export function deleteNodeKeepChildren(map: Mindmap, id: string): Mindmap {
  const node = map.nodes[id];
  if (!node || node.parentId === null) return map;
  const nodes: Record<string, MindNode> = {};
  for (const [k, v] of Object.entries(map.nodes)) {
    if (k === id) continue;
    nodes[k] = v.parentId === id ? { ...v, parentId: node.parentId } : v;
  }
  return touch(map, nodes);
}

export function visibleNodes(map: Mindmap): MindNode[] {
  const out: MindNode[] = [];
  const walk = (id: string) => {
    const n = map.nodes[id];
    if (!n) return;
    out.push(n);
    if (!n.collapsed) for (const c of childrenOf(map, id)) walk(c.id);
  };
  walk(map.rootId);
  return out;
}

export function hiddenChildCount(map: Mindmap, id: string): number {
  return descendantIds(map, id).length;
}

/** Bezier path from the parent's facing edge to the child's facing edge. */
export function edgePath(parent: MindNode, child: MindNode): string {
  const p = nodeSize(parent);
  const c = nodeSize(child);
  const childIsLeft = child.x + c.width < parent.x;
  const sx = childIsLeft ? parent.x : parent.x + p.width;
  const sy = parent.y + p.height / 2;
  const ex = childIsLeft ? child.x + c.width : child.x;
  const ey = child.y + c.height / 2;
  const mid = (sx + ex) / 2;
  return `M ${sx} ${sy} C ${mid} ${sy}, ${mid} ${ey}, ${ex} ${ey}`;
}

/** Tidy layout. Every child keeps the side of its parent it is on; the root stays where it is. */
export function layoutTree(map: Mindmap): Mindmap {
  const root = map.nodes[map.rootId];
  const nodes: Record<string, MindNode> = { ...map.nodes };
  const heightCache = new Map<string, number>();

  const sideKids = (id: string, side: Side) => childrenOnSide(map, id, side);
  const stack = (kids: MindNode[]) => (kids.length ? kids.reduce((sum, k) => sum + blockHeight(k.id), 0) + GAP_Y * (kids.length - 1) : 0);

  const blockHeight = (id: string): number => {
    const cached = heightCache.get(id);
    if (cached !== undefined) return cached;
    const n = map.nodes[id];
    const own = nodeSize(n).height;
    const h = n.collapsed ? own : Math.max(own, stack(sideKids(id, 'left')), stack(sideKids(id, 'right')));
    heightCache.set(id, h);
    return h;
  };

  const translateHidden = (id: string, dx: number, dy: number) => {
    for (const d of descendantIds(map, id)) nodes[d] = { ...nodes[d], x: nodes[d].x + dx, y: nodes[d].y + dy };
  };

  const place = (id: string, x: number, top: number) => {
    const n = map.nodes[id];
    const block = blockHeight(id);
    const y = top + (block - nodeSize(n).height) / 2;
    nodes[id] = { ...n, x, y };
    if (n.collapsed) {
      translateHidden(id, x - n.x, y - n.y);
      return;
    }
    for (const side of ['right', 'left'] as const) {
      const kids = sideKids(id, side);
      let cursor = top + (block - stack(kids)) / 2;
      for (const k of kids) {
        const childX = side === 'right' ? x + nodeSize(n).width + GAP_X : x - GAP_X - nodeSize(k).width;
        place(k.id, childX, cursor);
        cursor += blockHeight(k.id) + GAP_Y;
      }
    }
  };

  place(map.rootId, root.x, root.y);
  const laidRoot = nodes[map.rootId];
  const dy = root.y - laidRoot.y;
  if (dy !== 0) for (const k of Object.keys(nodes)) nodes[k] = { ...nodes[k], y: nodes[k].y + dy };
  return touch(map, nodes);
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function mapBounds(map: Mindmap): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const n of visibleNodes(map)) {
    const s = nodeSize(n);
    b.minX = Math.min(b.minX, n.x);
    b.minY = Math.min(b.minY, n.y);
    b.maxX = Math.max(b.maxX, n.x + s.width);
    b.maxY = Math.max(b.maxY, n.y + s.height);
  }
  return b;
}
