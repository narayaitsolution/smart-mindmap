import { nodeSize, visibleNodes, type MindNode, type Mindmap } from './mindmap';

/** Length of the show/hide animation. */
export const MOTION_MS = 200;

interface Enter {
  id: string;
  /** Center of the nearest ancestor that was already on screen, in the new layout. */
  from: { x: number; y: number };
}

interface Leave {
  /** The node as it was drawn before it disappeared, already shifted with its anchor. */
  node: MindNode;
  /** Center of the nearest surviving ancestor, in the new layout. */
  to: { x: number; y: number };
}

export interface MotionPlan {
  enter: Enter[];
  leave: Leave[];
}

export interface MotionFrame {
  /** Displayed position of entering nodes only. Every other node stays where the layout puts it. */
  nodes: Record<string, { x: number; y: number }>;
  /** Nodes that just left, still drawn while they contract toward their anchor. */
  ghosts: MindNode[];
  opacity: Record<string, number>;
}

const centerOf = (n: MindNode) => {
  const s = nodeSize(n);
  return { x: n.x + s.width / 2, y: n.y + s.height / 2 };
};

const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Compares two states of one map and lists only nodes that appear or disappear. Nodes present in
 * both, including ones a tidy layout nudged, are left out so they never animate.
 */
export function planMotion(prev: Mindmap | undefined, next: Mindmap): MotionPlan | null {
  if (!prev || prev.id !== next.id) return null;
  const before = new Set(visibleNodes(prev).map((n) => n.id));
  const after = new Set(visibleNodes(next).map((n) => n.id));

  const anchor = (map: Mindmap, id: string, keep: Set<string>): MindNode | undefined => {
    let cur = map.nodes[id]?.parentId ?? null;
    while (cur !== null && !keep.has(cur)) cur = map.nodes[cur]?.parentId ?? null;
    return cur === null ? undefined : map.nodes[cur];
  };

  const enter: Enter[] = [];
  for (const id of after) {
    if (before.has(id)) continue;
    const a = anchor(next, id, before);
    if (a) enter.push({ id, from: centerOf(a) });
  }

  const leave: Leave[] = [];
  for (const id of before) {
    if (after.has(id)) continue;
    const old = anchor(prev, id, after);
    const now = old && next.nodes[old.id];
    if (!old || !now) continue;
    const n = prev.nodes[id];
    leave.push({ node: { ...n, x: n.x + now.x - old.x, y: n.y + now.y - old.y }, to: centerOf(now) });
  }

  return enter.length || leave.length ? { enter, leave } : null;
}

/** Positions and opacity at progress `t` (0 = just changed, 1 = settled). */
export function frameAt(next: Mindmap, plan: MotionPlan, t: number): MotionFrame {
  const e = ease(t);
  const done = t >= 1;
  const nodes: MotionFrame['nodes'] = {};
  const ghosts: MindNode[] = [];
  const opacity: Record<string, number> = {};

  for (const { id, from } of plan.enter) {
    const n = next.nodes[id];
    if (!n) continue;
    const s = nodeSize(n);
    const sx = from.x - s.width / 2;
    const sy = from.y - s.height / 2;
    nodes[id] = done ? { x: n.x, y: n.y } : { x: sx + (n.x - sx) * e, y: sy + (n.y - sy) * e };
    opacity[id] = done ? 1 : e;
  }

  for (const { node, to } of plan.leave) {
    const s = nodeSize(node);
    const tx = to.x - s.width / 2;
    const ty = to.y - s.height / 2;
    ghosts.push({ ...node, x: node.x + (tx - node.x) * e, y: node.y + (ty - node.y) * e });
    opacity[node.id] = 1 - e;
  }

  return { nodes, ghosts, opacity };
}
