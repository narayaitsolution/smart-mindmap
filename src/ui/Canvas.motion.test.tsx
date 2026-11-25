import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addChild, createMindmap, edgePath, layoutTree, nodeSize, toggleCollapse, type Mindmap } from '../model/mindmap';
import { Canvas, type CanvasActions } from './Canvas';

const actions: CanvasActions = {
  select: () => undefined,
  move: () => undefined,
  settle: () => undefined,
  resize: () => undefined,
  setViewport: () => undefined,
  addChild: () => undefined,
  addSibling: () => undefined,
  remove: () => undefined,
  toggle: () => undefined,
  rename: () => undefined,
};

const t = (key: string) => key;
const viewport = { x: 0, y: 0, zoom: 1 };

function base(): Mindmap {
  let m = createMindmap({ id: 'm', title: 'Peta', rootText: 'Inti', at: { x: 100, y: 200 }, now: 1 });
  m = addChild(m, m.rootId, 'a', 'Satu');
  m = addChild(m, m.rootId, 'b', 'Dua');
  m = addChild(m, 'a', 'a1', 'Anak');
  return layoutTree(m);
}

const view = (map: Mindmap) => (
  <Canvas maps={[map]} selected={null} viewport={viewport} t={t as never} actions={actions} editing={null} onEditCommit={() => undefined} onEditCancel={() => undefined} />
);

const nodeEl = (c: HTMLElement, id: string) => c.querySelector(`[data-node-id="${id}"]`);
const pos = (el: Element | null) => {
  const m = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(el?.getAttribute('transform') ?? '');
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
};

let clock = 0;
let queue: FrameRequestCallback[] = [];
const tick = (ms: number) => {
  clock += ms;
  const run = queue;
  queue = [];
  act(() => run.forEach((cb) => cb(clock)));
};
const reduced = (on: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: on && query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));

beforeEach(() => {
  clock = 1000;
  queue = [];
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  reduced(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Canvas show/hide motion', () => {
  it('shows an added child at its parent first, then at its own place', () => {
    const before = base();
    const { container, rerender } = render(view(before));
    const after = addChild(before, 'b', 'b1', 'Baru');
    rerender(view(after));
    const parent = after.nodes.b;
    const ps = nodeSize(parent);
    const ns = nodeSize(after.nodes.b1);
    expect(pos(nodeEl(container, 'b1'))).toEqual({ x: parent.x + ps.width / 2 - ns.width / 2, y: parent.y + ps.height / 2 - ns.height / 2 });
    tick(250);
    expect(pos(nodeEl(container, 'b1'))).toEqual({ x: after.nodes.b1.x, y: after.nodes.b1.y });
  });

  it('keeps a hidden subtree as a ghost, then removes it', () => {
    const open = base();
    const { container, rerender } = render(view(open));
    rerender(view(toggleCollapse(open, 'a')));
    expect(nodeEl(container, 'a1')).toBeNull();
    const ghost = container.querySelector('[data-ghost-id="a1"]');
    expect(ghost).not.toBeNull();
    expect(ghost?.getAttribute('aria-hidden')).toBe('true');
    tick(100);
    expect(container.querySelector('[data-ghost-id="a1"]')).not.toBeNull();
    tick(150);
    expect(container.querySelector('[data-ghost-id="a1"]')).toBeNull();
  });

  it('skips animation when the user prefers reduced motion', () => {
    reduced(true);
    const open = base();
    const { container, rerender } = render(view(open));
    rerender(view(toggleCollapse(open, 'a')));
    expect(container.querySelector('[data-ghost-id]')).toBeNull();
    expect(queue).toHaveLength(0);
    const after = addChild(open, 'b', 'b1', 'Baru');
    rerender(view(after));
    expect(pos(nodeEl(container, 'b1'))).toEqual({ x: after.nodes.b1.x, y: after.nodes.b1.y });
  });

  it('does not move nodes that were already visible', () => {
    const before = base();
    const { container, rerender } = render(view(before));
    const after = layoutTree(addChild(before, 'a', 'a2', 'Baru'));
    rerender(view(after));
    for (const id of ['b', 'a', 'a1']) expect(pos(nodeEl(container, id))).toEqual({ x: after.nodes[id].x, y: after.nodes[id].y });
  });

  it('draws the edge of an entering node to its displayed position', () => {
    const before = base();
    const { container, rerender } = render(view(before));
    const after = addChild(before, 'b', 'b1', 'Baru');
    rerender(view(after));
    const shown = { ...after.nodes.b1, ...pos(nodeEl(container, 'b1')) };
    const edges = [...container.querySelectorAll('path.edge')].map((p) => p.getAttribute('d'));
    expect(edges).toContain(edgePath(after.nodes.b, shown));
    tick(250);
    const settled = [...container.querySelectorAll('path.edge')].map((p) => p.getAttribute('d'));
    expect(settled).toContain(edgePath(after.nodes.b, after.nodes.b1));
  });

  it('draws the edge of a leaving node to its displayed ghost position', () => {
    const open = base();
    const { container, rerender } = render(view(open));
    const folded = toggleCollapse(open, 'a');
    rerender(view(folded));
    expect(container.querySelectorAll('path.edge')).toHaveLength(3);
    tick(100);
    const ghostPos = pos(container.querySelector('[data-ghost-id="a1"] .node'))!;
    const edges = [...container.querySelectorAll('path.edge')].map((p) => p.getAttribute('d'));
    expect(edges).toContain(edgePath(folded.nodes.a, { ...open.nodes.a1, ...ghostPos }));
    tick(150);
    expect(container.querySelectorAll('path.edge')).toHaveLength(2);
  });
});
