import { describe, expect, it } from 'vitest';
import { addChild, addSibling, createMindmap, deleteNode, edgePath, layoutTree, moveSubtree, nodeSize, toggleCollapse, type Mindmap } from './mindmap';
import { frameAt, MOTION_MS, planMotion } from './motion';

const root = () => createMindmap({ id: 'm', title: 'Peta', rootText: 'Inti', at: { x: 100, y: 200 }, now: 1 });
const center = (map: Mindmap, id: string, shown?: { x: number; y: number }) => {
  const n = map.nodes[id];
  const s = nodeSize(n);
  const p = shown ?? n;
  return { x: p.x + s.width / 2, y: p.y + s.height / 2 };
};

function tree(): Mindmap {
  let m = root();
  m = addChild(m, m.rootId, 'a', 'Satu');
  m = addChild(m, m.rootId, 'b', 'Dua');
  m = addChild(m, 'a', 'a1', 'Satu-satu');
  m = addChild(m, 'a1', 'a2', 'Satu-dua');
  return layoutTree(m);
}

describe('motion duration', () => {
  it('is short', () => {
    expect(MOTION_MS).toBe(200);
  });
});

describe('planMotion', () => {
  it('returns null when nothing enters or leaves', () => {
    const m = tree();
    expect(planMotion(m, m)).toBeNull();
    expect(planMotion(m, moveSubtree(m, 'b', 500, 500))).toBeNull();
    expect(planMotion(m, toggleCollapse(toggleCollapse(m, 'b'), 'b'))).toBeNull();
  });

  it('returns null for a different map or no previous map', () => {
    const m = tree();
    expect(planMotion(undefined, m)).toBeNull();
    expect(planMotion({ ...m, id: 'other' }, m)).toBeNull();
  });
});

describe('frameAt: entering nodes', () => {
  it('starts an added child on its parent and ends at its own position', () => {
    const before = tree();
    const after = addChild(before, 'b', 'b1', 'Baru');
    const plan = planMotion(before, after)!;
    const start = frameAt(after, plan, 0);
    expect(center(after, 'b1', start.nodes.b1)).toEqual(center(after, 'b'));
    expect(start.opacity.b1).toBe(0);
    const end = frameAt(after, plan, 1);
    expect(end.nodes.b1.x).toBe(after.nodes.b1.x);
    expect(end.nodes.b1.y).toBe(after.nodes.b1.y);
    expect(end.opacity.b1).toBe(1);
  });

  it('starts an added sibling on the shared parent', () => {
    const before = tree();
    const after = addSibling(before, 'a', 's', 'Saudara');
    const plan = planMotion(before, after)!;
    const start = frameAt(after, plan, 0);
    expect(center(after, 's', start.nodes.s)).toEqual(center(after, after.nodes.s.parentId!));
  });

  it('expands a whole shown subtree from the toggled parent', () => {
    const folded = toggleCollapse(tree(), 'a');
    const shown = toggleCollapse(folded, 'a');
    const plan = planMotion(folded, shown)!;
    const start = frameAt(shown, plan, 0);
    for (const id of ['a1', 'a2']) expect(center(shown, id, start.nodes[id])).toEqual(center(shown, 'a'));
    const mid = frameAt(shown, plan, 0.5);
    expect(mid.nodes.a1.x).toBeGreaterThan(Math.min(center(shown, 'a').x - 1, shown.nodes.a1.x));
    expect(mid.opacity.a1).toBeGreaterThan(0);
    expect(mid.opacity.a1).toBeLessThan(1);
  });
});

describe('frameAt: leaving nodes', () => {
  it('keeps the hidden subtree as ghosts that contract onto the parent', () => {
    const open = tree();
    const folded = toggleCollapse(open, 'a');
    const plan = planMotion(open, folded)!;
    const start = frameAt(folded, plan, 0);
    expect(start.ghosts.map((g) => g.id).sort()).toEqual(['a1', 'a2']);
    for (const g of start.ghosts) {
      expect(g.x).toBe(open.nodes[g.id].x);
      expect(g.y).toBe(open.nodes[g.id].y);
    }
    const end = frameAt(folded, plan, 1);
    for (const g of end.ghosts) {
      expect(center(open, g.id, g)).toEqual(center(folded, 'a'));
      expect(end.opacity[g.id]).toBe(0);
    }
  });

  it('turns a deleted subtree into ghosts moving to the parent', () => {
    const open = tree();
    const gone = deleteNode(open, 'a');
    const plan = planMotion(open, gone)!;
    const end = frameAt(gone, plan, 1);
    expect(end.ghosts.map((g) => g.id).sort()).toEqual(['a', 'a1', 'a2']);
    expect(center(open, 'a', end.ghosts.find((g) => g.id === 'a'))).toEqual(center(gone, gone.rootId));
  });

  it('starts ghosts with the same offset from the parent the node had before', () => {
    const open = tree();
    const shifted = moveSubtree(toggleCollapse(open, 'a'), 'a', open.nodes.a.x + 30, open.nodes.a.y + 40);
    const plan = planMotion(open, shifted)!;
    const start = frameAt(shifted, plan, 0);
    const g = start.ghosts.find((n) => n.id === 'a1')!;
    expect(g.x).toBe(open.nodes.a1.x + 30);
    expect(g.y).toBe(open.nodes.a1.y + 40);
  });
});

describe('frameAt: unrelated nodes', () => {
  it('does not animate nodes that merely shift while another node enters', () => {
    const before = tree();
    const after = layoutTree(addChild(before, 'a', 'a3', 'Baru'));
    const plan = planMotion(before, after)!;
    const frame = frameAt(after, plan, 0.3);
    expect(Object.keys(frame.nodes)).toEqual(['a3']);
    expect(frame.ghosts).toEqual([]);
  });
});

describe('frameAt: edges', () => {
  it('lets an edge end at the displayed child position', () => {
    const before = tree();
    const after = addChild(before, 'b', 'b1', 'Baru');
    const plan = planMotion(before, after)!;
    const frame = frameAt(after, plan, 0.5);
    const shown = { ...after.nodes.b1, ...frame.nodes.b1 };
    const d = edgePath(after.nodes.b, shown);
    expect(d.endsWith(`${shown.x} ${shown.y + nodeSize(shown).height / 2}`)).toBe(true);
    expect(shown.x).not.toBe(after.nodes.b1.x);
  });
});
