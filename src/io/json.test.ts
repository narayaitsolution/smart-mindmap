import { describe, expect, it } from 'vitest';
import { addChild, createMindmap, updateNode } from '../model/mindmap';
import { exportJson, ImportError, assertImportSize, importJson, mergeImported, sanitizeWorkspace } from './json';
import { addMap, emptyWorkspace } from '../model/workspace';
import { MAX_NOTE_BYTES } from '../model/note';
import { MAX_MAP_IMAGE_BYTES } from '../model/workspace';

const sample = () => {
  let map = createMindmap({ id: 'm1', title: 'Peta', rootText: 'Inti', at: { x: 0, y: 0 }, now: 5 });
  map = addChild(map, map.rootId, 'c1', 'Anak');
  map = updateNode(map, 'c1', { color: '#ffee00', edgeColor: '#ff0000', edgeWidth: 3 });
  return map;
};

describe('json import/export', () => {
  it('round-trips maps', () => {
    const map = sample();
    const result = importJson(exportJson([map]));
    expect(result).toEqual([map]);
  });

  it('rejects malformed JSON and wrong format', () => {
    expect(() => importJson('{nope')).toThrow(ImportError);
    expect(() => importJson(JSON.stringify({ app: 'other', version: 1, maps: [] }))).toThrow(ImportError);
  });

  it('rejects a map with a dangling parent or a cycle', () => {
    const map = sample();
    const broken = { ...map, nodes: { ...map.nodes, c1: { ...map.nodes.c1, parentId: 'ghost' } } };
    expect(() => importJson(exportJson([broken]))).toThrow(ImportError);
    const cyc = {
      ...map,
      nodes: {
        ...map.nodes,
        [map.rootId]: { ...map.nodes[map.rootId], parentId: 'c1' },
      },
    };
    expect(() => importJson(exportJson([cyc]))).toThrow(ImportError);
  });

  it('drops unsafe color values instead of keeping them', () => {
    const map = sample();
    const evil = { ...map, nodes: { ...map.nodes, c1: { ...map.nodes.c1, color: 'red" onload="x', edgeColor: 'url(#a)' } } };
    const [out] = importJson(exportJson([evil]));
    expect(out.nodes.c1.color).toBeUndefined();
    expect(out.nodes.c1.edgeColor).toBeUndefined();
  });

  it('clamps edge width and rejects non-finite coordinates', () => {
    const map = sample();
    const fat = { ...map, nodes: { ...map.nodes, c1: { ...map.nodes.c1, edgeWidth: 999 } } };
    expect(importJson(exportJson([fat]))[0].nodes.c1.edgeWidth).toBe(12);
    const bad = JSON.parse(exportJson([map]));
    bad.maps[0].nodes.c1.x = 'NaN';
    expect(() => importJson(JSON.stringify(bad))).toThrow(ImportError);
  });

  it('gives imported maps new ids when they collide with existing ones', () => {
    const ws = addMap(emptyWorkspace(), sample());
    const merged = mergeImported(ws, importJson(exportJson([sample()])));
    expect(merged.maps).toHaveLength(2);
    expect(new Set(merged.maps.map((m) => m.id)).size).toBe(2);
  });

  it('sanitizeWorkspace returns null for garbage and keeps a valid viewport', () => {
    expect(sanitizeWorkspace(42)).toBeNull();
    const ws = addMap(emptyWorkspace(), sample());
    const out = sanitizeWorkspace({ ...ws, viewport: { x: 10, y: 20, zoom: 2 } });
    expect(out?.viewport).toEqual({ x: 10, y: 20, zoom: 2 });
    const clamped = sanitizeWorkspace({ ...ws, viewport: { x: 0, y: 0, zoom: 1e9 } });
    expect(clamped?.viewport.zoom).toBeLessThanOrEqual(4);
  });
});

describe('json notes', () => {
  const withNote = () =>
    JSON.parse(exportJson([sample()])) as { maps: { nodes: Record<string, Record<string, unknown>> }[] };

  it('round-trips notes with links and images', () => {
    const note = '<h1>T</h1><p>a <a href="https://a.com/?q=1&amp;r=2">link</a><img src="data:image/png;base64,AAAA" alt="x"><img src="data:image/png;base64,AAAA"></p>';
    const map = updateNode(sample(), 'c1', { note });
    const [out] = importJson(exportJson([map]));
    expect(out.nodes.c1.note).toBe(note);
    expect(out).toEqual(map);
  });

  it('sanitizes notes on import', () => {
    const data = withNote();
    data.maps[0].nodes.c1.note = '<p onclick="x">ok</p><img src="javascript:x"><script>1</script><a href="javascript:x">l</a>';
    const [out] = importJson(JSON.stringify(data));
    expect(out.nodes.c1.note).toBe('<p>ok</p>l');
  });

  it('drops notes that are not strings, empty, or over 100 KB', () => {
    const data = withNote();
    data.maps[0].nodes.c1.note = 42;
    data.maps[0].nodes[Object.keys(data.maps[0].nodes)[0]].note = 'x'.repeat(MAX_NOTE_BYTES + 1);
    const [out] = importJson(JSON.stringify(data));
    expect(out.nodes.c1.note).toBeUndefined();
    expect(out.nodes[out.rootId].note).toBeUndefined();
  });

  it('sanitizes notes when exporting', () => {
    const map = sample();
    const dirty = { ...map, nodes: { ...map.nodes, c1: { ...map.nodes.c1, note: '<p>ok</p><script>1</script>' } } };
    expect(exportJson([dirty])).not.toContain('script');
  });

  it('sanitizes notes read from stored workspaces', () => {
    const map = sample();
    const ws = addMap(emptyWorkspace(), { ...map, nodes: { ...map.nodes, c1: { ...map.nodes.c1, note: '<img src=x onerror=1>hi' } } });
    expect(sanitizeWorkspace(ws)?.maps[0].nodes.c1.note).toBe('hi');
  });

  it('keeps a clamped manual size and drops a malformed one', () => {
    const map = sample();
    const raw = { ...map, nodes: { ...map.nodes, c1: { ...map.nodes.c1, width: 9999, height: 'x' } } };
    const out = importJson(JSON.stringify({ app: 'smart-mindmap', version: 1, maps: [raw] }))[0];
    expect(out.nodes.c1.width).toBe(640);
    expect(out.nodes.c1.height).toBeUndefined();
  });

  it('rejects imports larger than 10 MB', () => {
    expect(() => importJson(' '.repeat(10 * 1024 * 1024 + 1))).toThrow(/too large/i);
    expect(() => importJson(' '.repeat(10 * 1024 * 1024 + 1))).toThrow(ImportError);
  });
});

describe('import limits', () => {
  it('checks the file size before anything is read', () => {
    expect(() => assertImportSize(10 * 1024 * 1024)).not.toThrow();
    expect(() => assertImportSize(10 * 1024 * 1024 + 1)).toThrow(ImportError);
    expect(() => assertImportSize(10 * 1024 * 1024 + 1)).toThrow(/too large/i);
  });

  it('rejects a map whose data images exceed the per-map cap', () => {
    const img = `<img src="data:image/png;base64,${'A'.repeat(1_398_100)}">`;
    let map = sample();
    for (let i = 0; i < 7; i++) map = updateNode(addChild(map, map.rootId, `big${i}`, 'x'), `big${i}`, { note: `<p>n</p>${img}` });
    expect(MAX_MAP_IMAGE_BYTES).toBeLessThan(7 * 1_048_575);
    expect(() => importJson(JSON.stringify({ app: 'smart-mindmap', version: 1, maps: [map] }))).toThrow(/images/i);
  });
});
