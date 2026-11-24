import { describe, expect, it } from 'vitest';
import { addChild, createMindmap, mapBounds, updateNode } from './mindmap';
import { MAX_NOTE_IMAGE_BYTES } from './note';
import {
  addMap,
  emptyWorkspace,
  exceedsImageBudget,
  importExceedsImageBudget,
  MAX_MAP_IMAGE_BYTES,
  MAX_WORKSPACE_IMAGE_BYTES,
  mapImageBytes,
  nextMapPosition,
  removeMap,
  replaceMap,
  workspaceImageBytes,
} from './workspace';

describe('workspace', () => {
  it('starts empty with identity viewport', () => {
    const ws = emptyWorkspace();
    expect(ws.maps).toEqual([]);
    expect(ws.activeMapId).toBeNull();
    expect(ws.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('adds maps and activates the newest one', () => {
    let ws = emptyWorkspace();
    ws = addMap(ws, createMindmap({ id: 'a', title: 'A', rootText: 'A', at: { x: 0, y: 0 } }));
    ws = addMap(ws, createMindmap({ id: 'b', title: 'B', rootText: 'B', at: { x: 0, y: 0 } }));
    expect(ws.maps.map((m) => m.id)).toEqual(['a', 'b']);
    expect(ws.activeMapId).toBe('b');
  });

  it('puts the next map to the right of existing ones without overlap', () => {
    let ws = emptyWorkspace();
    expect(nextMapPosition(ws)).toEqual({ x: 0, y: 0 });
    const first = createMindmap({ id: 'a', title: 'A', rootText: 'A', at: { x: 0, y: 0 } });
    ws = addMap(ws, first);
    expect(nextMapPosition(ws).x).toBeGreaterThan(mapBounds(first).maxX);
  });

  it('removes a map and falls back the active id', () => {
    let ws = emptyWorkspace();
    ws = addMap(ws, createMindmap({ id: 'a', title: 'A', rootText: 'A', at: { x: 0, y: 0 } }));
    ws = addMap(ws, createMindmap({ id: 'b', title: 'B', rootText: 'B', at: { x: 0, y: 0 } }));
    ws = removeMap(ws, 'b');
    expect(ws.maps.map((m) => m.id)).toEqual(['a']);
    expect(ws.activeMapId).toBe('a');
    ws = removeMap(ws, 'a');
    expect(ws.activeMapId).toBeNull();
  });

  it('replaces a map by id', () => {
    let ws = emptyWorkspace();
    const a = createMindmap({ id: 'a', title: 'A', rootText: 'A', at: { x: 0, y: 0 } });
    ws = addMap(ws, a);
    ws = replaceMap(ws, { ...a, title: 'Baru' });
    expect(ws.maps[0].title).toBe('Baru');
  });
});

describe('replaceAllMaps', () => {
  it('swaps every map, activates the first and keeps the viewport', async () => {
    const { replaceAllMaps } = await import('./workspace');
    let ws = addMap(emptyWorkspace(), createMindmap({ id: 'a', title: 'A', rootText: 'A', at: { x: 0, y: 0 } }));
    ws = { ...ws, viewport: { x: 1, y: 2, zoom: 3 } };
    const b = createMindmap({ id: 'b', title: 'B', rootText: 'B', at: { x: 0, y: 0 } });
    const out = replaceAllMaps(ws, [b]);
    expect(out.maps.map((m) => m.id)).toEqual(['b']);
    expect(out.activeMapId).toBe('b');
    expect(out.viewport).toEqual({ x: 1, y: 2, zoom: 3 });
    expect(replaceAllMaps(ws, []).activeMapId).toBeNull();
  });
});

describe('appendMap', () => {
  it('places an imported map right of existing maps, activates it and renames colliding ids', async () => {
    const { appendMap } = await import('./workspace');
    const a = createMindmap({ id: 'a', title: 'A', rootText: 'A', at: { x: 0, y: 0 } });
    const ws = addMap(emptyWorkspace(), a);
    const incoming = createMindmap({ id: 'a', title: 'Dup', rootText: 'Dup', at: { x: -500, y: 300 } });
    const out = appendMap(ws, incoming);
    expect(out.maps).toHaveLength(2);
    expect(new Set(out.maps.map((m) => m.id)).size).toBe(2);
    const added = out.maps[1];
    expect(mapBounds(added).minX).toBeGreaterThan(mapBounds(a).maxX);
    expect(mapBounds(added).minY).toBe(0);
    expect(out.activeMapId).toBe(added.id);
    expect(added.nodes[added.rootId].text).toBe('Dup');
  });
});

describe('image budget', () => {
  /** 1,048,575 decoded bytes each. */
  const img = `<img src="data:image/png;base64,${'A'.repeat(1_398_100)}">`;
  const withImages = (id: string, count: number) => {
    let map = createMindmap({ id, title: id, rootText: id, at: { x: 0, y: 0 } });
    for (let i = 0; i < count; i++) {
      map = addChild(map, map.rootId, `${id}-c${i}`, 'x');
      map = updateNode(map, `${id}-c${i}`, { note: `<p>n</p>${img}` });
    }
    return map;
  };

  it('has map and workspace caps above one note and below unbounded growth', () => {
    expect(MAX_MAP_IMAGE_BYTES).toBeGreaterThan(MAX_NOTE_IMAGE_BYTES);
    expect(MAX_WORKSPACE_IMAGE_BYTES).toBeGreaterThan(MAX_MAP_IMAGE_BYTES);
  });

  it('sums decoded data image bytes over every node of a map, collapsed or not', () => {
    const map = withImages('a', 2);
    expect(mapImageBytes(map)).toBe(2 * 1_048_575);
    expect(workspaceImageBytes(addMap(addMap(emptyWorkspace(), map), withImages('b', 1)))).toBe(3 * 1_048_575);
  });

  it('refuses a change that pushes a map past its cap but allows shrinking', () => {
    const ws = addMap(emptyWorkspace(), withImages('a', 5));
    const full = replaceMap(ws, updateNode(ws.maps[0], 'a-c0', { note: `<p>n</p>${img}${img}` }));
    expect(mapImageBytes(full.maps[0])).toBeLessThanOrEqual(MAX_MAP_IMAGE_BYTES);
    expect(exceedsImageBudget(ws, full.maps[0])).toBe(false);
    const over = updateNode(full.maps[0], 'a-c1', { note: `<p>n</p>${img}${img}` });
    expect(mapImageBytes(over)).toBeGreaterThan(MAX_MAP_IMAGE_BYTES);
    expect(exceedsImageBudget(full, over)).toBe(true);
    expect(exceedsImageBudget(full, updateNode(full.maps[0], 'a-c0', { note: undefined }))).toBe(false);
  });

  it('refuses a change that pushes the whole workspace past its cap', () => {
    let ws = emptyWorkspace();
    for (const [id, n] of [['a', 4], ['b', 6], ['c', 6], ['d', 4]] as const) ws = addMap(ws, withImages(id, n));
    expect(workspaceImageBytes(ws)).toBeLessThanOrEqual(MAX_WORKSPACE_IMAGE_BYTES);
    const grown = updateNode(ws.maps[0], 'a-c0', { note: `<p>n</p>${img}${img}` });
    expect(mapImageBytes(grown)).toBeLessThanOrEqual(MAX_MAP_IMAGE_BYTES);
    expect(exceedsImageBudget(ws, grown)).toBe(true);
  });

  it('refuses imported maps that would push the workspace over its cap', () => {
    let ws = emptyWorkspace();
    for (const [id, n] of [['a', 6], ['b', 6], ['c', 6]] as const) ws = addMap(ws, withImages(id, n));
    expect(importExceedsImageBudget(ws, [withImages('d', 1)])).toBe(false);
    expect(importExceedsImageBudget(ws, [withImages('d', 1), withImages('e', 1), withImages('f', 1)])).toBe(true);
    expect(importExceedsImageBudget(emptyWorkspace(), [withImages('d', 7)])).toBe(true);
  });
});
