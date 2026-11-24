import { describe, expect, it } from 'vitest';
import {
  addChild,
  addSibling,
  childrenOf,
  createMindmap,
  deleteNode,
  deleteNodeKeepChildren,
  edgePath,
  layoutTree,
  mapBounds,
  MIN_NODE_WIDTH,
  moveSubtree,
  nodeLines,
  nodeSize,
  resizeNode,
  toggleCollapse,
  updateNode,
  visibleNodes,
} from './mindmap';
import { MAX_NOTE_BYTES } from './note';

const base = () => createMindmap({ id: 'm1', title: 'Peta', rootText: 'Inti', at: { x: 100, y: 200 }, now: 1 });

describe('createMindmap', () => {
  it('creates a root node at the requested position with transparent fill', () => {
    const map = base();
    const root = map.nodes[map.rootId];
    expect(root.parentId).toBeNull();
    expect(root.text).toBe('Inti');
    expect(root.x).toBe(100);
    expect(root.y).toBe(200);
    expect(root.color).toBeUndefined();
    expect(root.edgeColor).toBeUndefined();
  });
});

describe('addChild / addSibling', () => {
  it('adds a nested child to the right of its parent', () => {
    const map = addChild(base(), base().rootId, 'c1');
    const parent = map.nodes[map.rootId];
    const child = map.nodes.c1;
    expect(child.parentId).toBe(map.rootId);
    expect(child.x).toBeGreaterThan(parent.x + nodeSize(parent).width);
    const grand = addChild(map, 'c1', 'g1');
    expect(grand.nodes.g1.parentId).toBe('c1');
    expect(grand.nodes.g1.x).toBeGreaterThan(grand.nodes.c1.x);
  });

  it('places a second child below the first without overlap', () => {
    let map = base();
    map = addChild(map, map.rootId, 'c1');
    map = addChild(map, map.rootId, 'c2');
    expect(map.nodes.c2.y).toBeGreaterThanOrEqual(map.nodes.c1.y + nodeSize(map.nodes.c1).height);
    expect(childrenOf(map, map.rootId).map((n) => n.id)).toEqual(['c1', 'c2']);
  });

  it('adds a sibling under the same parent', () => {
    let map = base();
    map = addChild(map, map.rootId, 'c1');
    map = addSibling(map, 'c1', 's1');
    expect(map.nodes.s1.parentId).toBe(map.rootId);
    expect(map.nodes.s1.x).toBe(map.nodes.c1.x);
    expect(map.nodes.s1.y).toBeGreaterThan(map.nodes.c1.y);
  });

  it('ignores sibling creation on the root', () => {
    const map = base();
    expect(addSibling(map, map.rootId, 'x')).toBe(map);
  });

  it('expands a collapsed parent when a child is added', () => {
    let map = base();
    map = addChild(map, map.rootId, 'c1');
    map = toggleCollapse(map, map.rootId);
    expect(map.nodes[map.rootId].collapsed).toBe(true);
    map = addChild(map, map.rootId, 'c2');
    expect(map.nodes[map.rootId].collapsed).toBeFalsy();
  });

  it('does not mutate the input map', () => {
    const map = base();
    const snapshot = JSON.stringify(map);
    addChild(map, map.rootId, 'c1');
    expect(JSON.stringify(map)).toBe(snapshot);
  });
});

describe('moveSubtree', () => {
  it('moves a node and all its descendants by the same delta', () => {
    let map = base();
    map = addChild(map, map.rootId, 'c1');
    map = addChild(map, 'c1', 'g1');
    const before = { c: map.nodes.c1, g: map.nodes.g1 };
    const moved = moveSubtree(map, 'c1', before.c.x + 30, before.c.y - 10);
    expect(moved.nodes.c1.x).toBe(before.c.x + 30);
    expect(moved.nodes.g1.x).toBe(before.g.x + 30);
    expect(moved.nodes.g1.y).toBe(before.g.y - 10);
    expect(moved.nodes[moved.rootId].x).toBe(map.nodes[map.rootId].x);
  });
});

describe('edgePath', () => {
  it('draws a cubic bezier from parent right edge to child left edge and follows the child', () => {
    let map = base();
    map = addChild(map, map.rootId, 'c1');
    const parent = map.nodes[map.rootId];
    const path = edgePath(parent, map.nodes.c1);
    const start = `M ${parent.x + nodeSize(parent).width} ${parent.y + nodeSize(parent).height / 2}`;
    expect(path.startsWith(start)).toBe(true);
    expect(path).toContain(' C ');

    const moved = moveSubtree(map, 'c1', map.nodes.c1.x + 50, map.nodes.c1.y + 120);
    const path2 = edgePath(parent, moved.nodes.c1);
    expect(path2).not.toBe(path);
    expect(path2.endsWith(`${moved.nodes.c1.x} ${moved.nodes.c1.y + nodeSize(moved.nodes.c1).height / 2}`)).toBe(true);
  });

  it('anchors on the left side when the child sits left of the parent', () => {
    let map = base();
    map = addChild(map, map.rootId, 'c1');
    const parent = map.nodes[map.rootId];
    const left = { ...map.nodes.c1, x: parent.x - 400 };
    const path = edgePath(parent, left);
    expect(path.startsWith(`M ${parent.x} `)).toBe(true);
  });
});

describe('collapse', () => {
  it('hides descendants of a collapsed node from visibleNodes', () => {
    let map = base();
    map = addChild(map, map.rootId, 'c1');
    map = addChild(map, 'c1', 'g1');
    map = addChild(map, map.rootId, 'c2');
    map = toggleCollapse(map, 'c1');
    expect(visibleNodes(map).map((n) => n.id).sort()).toEqual([map.rootId, 'c1', 'c2'].sort());
    map = toggleCollapse(map, 'c1');
    expect(visibleNodes(map)).toHaveLength(4);
  });

  it('does nothing on a leaf', () => {
    const map = base();
    expect(toggleCollapse(map, map.rootId)).toBe(map);
  });
});

describe('updateNode / deleteNode', () => {
  it('sets and clears colors and edge size', () => {
    let map = base();
    map = addChild(map, map.rootId, 'c1');
    map = updateNode(map, 'c1', { color: '#ffcc00', edgeColor: '#ff0000', edgeWidth: 4 });
    expect(map.nodes.c1).toMatchObject({ color: '#ffcc00', edgeColor: '#ff0000', edgeWidth: 4 });
    map = updateNode(map, 'c1', { color: undefined });
    expect('color' in map.nodes.c1).toBe(false);
  });

  it('deletes a subtree but never the root', () => {
    let map = base();
    map = addChild(map, map.rootId, 'c1');
    map = addChild(map, 'c1', 'g1');
    expect(deleteNode(map, map.rootId)).toBe(map);
    map = deleteNode(map, 'c1');
    expect(Object.keys(map.nodes)).toEqual([map.rootId]);
  });
});

describe('deleteNodeKeepChildren', () => {
  it('removes only the node and promotes its children to the parent', () => {
    let map = base();
    map = addChild(map, map.rootId, 'c1');
    map = addChild(map, 'c1', 'g1');
    map = addChild(map, 'c1', 'g2');
    map = addChild(map, 'g1', 'h1');
    const next = deleteNodeKeepChildren(map, 'c1');
    expect(next.nodes.c1).toBeUndefined();
    expect(next.nodes.g1.parentId).toBe(map.rootId);
    expect(next.nodes.g2.parentId).toBe(map.rootId);
    expect(next.nodes.h1.parentId).toBe('g1');
    expect(next.nodes.g1.x).toBe(map.nodes.g1.x);
  });

  it('never deletes the root and ignores unknown ids', () => {
    const map = base();
    expect(deleteNodeKeepChildren(map, map.rootId)).toBe(map);
    expect(deleteNodeKeepChildren(map, 'nope')).toBe(map);
  });
});

describe('layoutTree / mapBounds', () => {
  it('lays out children right of parents without vertical overlap', () => {
    let map = base();
    map = addChild(map, map.rootId, 'c1');
    map = addChild(map, map.rootId, 'c2');
    map = addChild(map, 'c1', 'g1');
    map = addChild(map, 'c1', 'g2');
    const laid = layoutTree(map);
    const g1 = laid.nodes.g1;
    const g2 = laid.nodes.g2;
    expect(g2.y - g1.y).toBeGreaterThanOrEqual(nodeSize(g1).height);
    expect(laid.nodes.c1.x).toBeGreaterThan(laid.nodes[laid.rootId].x);
    expect(laid.nodes.c2.y).toBeGreaterThanOrEqual(laid.nodes.g2.y + nodeSize(g2).height);
  });

  it('computes bounds from visible nodes only', () => {
    let map = base();
    map = addChild(map, map.rootId, 'c1');
    map = addChild(map, 'c1', 'g1');
    const full = mapBounds(map);
    const hidden = mapBounds(toggleCollapse(map, 'c1'));
    expect(hidden.maxX).toBeLessThan(full.maxX);
  });
});

describe('fitText', () => {
  it('keeps short text and truncates long text with an ellipsis within the node width', async () => {
    const { fitText, nodeSize: size } = await import('./mindmap');
    expect(fitText('Halo')).toBe('Halo');
    const long = 'x'.repeat(500);
    const out = fitText(long);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length * 8 + 36).toBeLessThanOrEqual(size({ text: long }).width);
  });
});

describe('node notes', () => {
  it('stores a sanitized note and removes it when cleared', () => {
    let map = base();
    map = updateNode(map, map.rootId, { note: '<p onclick="x">Hi</p><script>1</script>' });
    expect(map.nodes[map.rootId].note).toBe('<p>Hi</p>');
    map = updateNode(map, map.rootId, { note: undefined });
    expect('note' in map.nodes[map.rootId]).toBe(false);
    map = updateNode(map, map.rootId, { note: '<p>Hi</p>' });
    map = updateNode(map, map.rootId, { note: '<p><br></p>' });
    expect('note' in map.nodes[map.rootId]).toBe(false);
  });

  it('keeps the previous note when the new one is over the size limit', () => {
    let map = updateNode(base(), base().rootId, { note: '<p>Lama</p>' });
    map = updateNode(map, map.rootId, { note: 'x'.repeat(MAX_NOTE_BYTES + 1) });
    expect(map.nodes[map.rootId].note).toBe('<p>Lama</p>');
  });

  it('does not touch notes when other fields change', () => {
    let map = updateNode(base(), base().rootId, { note: '<p>Tetap</p>' });
    map = updateNode(map, map.rootId, { text: 'Baru' });
    expect(map.nodes[map.rootId].note).toBe('<p>Tetap</p>');
  });
});

describe('node wrapping and manual size', () => {
  const long = 'Satu kalimat panjang yang harus pindah ke baris berikutnya supaya tetap terbaca';

  it('wraps long text onto several lines and grows the height', () => {
    const lines = nodeLines({ text: long });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe(long);
    expect(nodeSize({ text: long }).height).toBeGreaterThan(nodeSize({ text: 'Pendek' }).height);
  });

  it('breaks a single word longer than the line', () => {
    const lines = nodeLines({ text: 'x'.repeat(200) });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('x'.repeat(200));
  });

  it('keeps wide glyphs inside the box and never drops text', () => {
    const cjk = '日本語'.repeat(40);
    const lines = nodeLines({ text: cjk });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(cjk);
    const wide = 'W'.repeat(60);
    expect(nodeLines({ text: wide }).join('')).toBe(wide);
    expect(nodeLines({ text: wide, width: MIN_NODE_WIDTH }).join('')).toBe(wide);
  });

  it('keeps short text on one line at the default size', () => {
    expect(nodeLines({ text: 'Halo' })).toEqual(['Halo']);
    expect(nodeSize({ text: 'Halo' })).toEqual({ width: 96, height: 40 });
  });

  it('uses a manual width and rewraps, never smaller than the content needs', () => {
    const wide = nodeSize({ text: long, width: 600 });
    const narrow = nodeSize({ text: long, width: 100 });
    expect(wide.width).toBe(600);
    expect(narrow.width).toBe(100);
    expect(narrow.height).toBeGreaterThan(wide.height);
    expect(nodeSize({ text: 'a', height: 120 }).height).toBe(120);
    expect(nodeSize({ text: 'a', width: 5 }).width).toBe(64);
  });

  it('anchors the bottom edge when resizing from the top', () => {
    const map = base();
    const root = map.nodes[map.rootId];
    const next = resizeNode(map, map.rootId, { height: 100, anchorY: 'bottom' }).nodes[map.rootId];
    expect(next.y + nodeSize(next).height).toBe(root.y + nodeSize(root).height);
    expect(nodeSize(next).height).toBe(100);
  });

  it('resizes a right-side node and shifts its children with the right edge', () => {
    let map = base();
    map = addChild(map, map.rootId, 'c1');
    map = addChild(map, 'c1', 'g1');
    const before = map.nodes;
    const out = resizeNode(map, 'c1', { width: 200, height: 100 });
    expect(out.nodes.c1.width).toBe(200);
    expect(out.nodes.c1.height).toBe(100);
    expect(out.nodes.c1.x).toBe(before.c1.x);
    expect(out.nodes.g1.x).toBe(before.g1.x + 200 - nodeSize(before.c1).width);
    expect(before.c1.width).toBeUndefined();
  });

  it('keeps the right edge fixed when resizing a left-side node', () => {
    let map = base();
    map = addChild(map, map.rootId, 'c1', 'Topic', 'left');
    const right = map.nodes.c1.x + nodeSize(map.nodes.c1).width;
    const out = resizeNode(map, 'c1', { width: 220 });
    expect(out.nodes.c1.x + nodeSize(out.nodes.c1).width).toBe(right);
    expect(sideOfLeft(out)).toBe(true);
  });

  it('anchors the right edge when asked, and resets with null', () => {
    let map = base();
    map = addChild(map, map.rootId, 'c1');
    const x = map.nodes.c1.x;
    const w = nodeSize(map.nodes.c1).width;
    const grown = resizeNode(map, 'c1', { width: w + 50, anchor: 'right' });
    expect(grown.nodes.c1.x).toBe(x - 50);
    const reset = resizeNode(grown, 'c1', null);
    expect(reset.nodes.c1.width).toBeUndefined();
    expect(reset.nodes.c1.height).toBeUndefined();
  });

  it('clamps sizes and ignores a no-op', () => {
    let map = base();
    map = addChild(map, map.rootId, 'c1');
    expect(resizeNode(map, 'c1', { width: 99999 }).nodes.c1.width).toBe(640);
    expect(resizeNode(map, 'c1', { width: 1, height: 1 }).nodes.c1.height).toBe(40);
    expect(resizeNode(map, 'c1', {})).toBe(map);
    expect(resizeNode(map, 'zzz', { width: 200 })).toBe(map);
  });
});

function sideOfLeft(map: ReturnType<typeof base>): boolean {
  return map.nodes.c1.x + nodeSize(map.nodes.c1).width < map.nodes[map.rootId].x;
}
