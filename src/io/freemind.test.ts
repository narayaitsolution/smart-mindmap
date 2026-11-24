import { describe, expect, it, vi } from 'vitest';
import { addChild, createMindmap, toggleCollapse, updateNode, childrenOf } from '../model/mindmap';
import { exportFreeMind, importFreeMind } from './freemind';
import { ImportError } from './json';

describe('FreeMind .mm', () => {
  it('exports a <map> with nested nodes, colors and edge style', () => {
    let map = createMindmap({ id: 'm', title: 'T', rootText: 'Inti & <Co>', at: { x: 0, y: 0 } });
    map = addChild(map, map.rootId, 'c1', 'Anak');
    map = updateNode(map, 'c1', { color: '#ffee00', edgeColor: '#ff0000', edgeWidth: 4 });
    const xml = exportFreeMind(map);
    expect(xml).toContain('<map version="1.0.1">');
    expect(xml).toContain('TEXT="Inti &amp; &lt;Co&gt;"');
    expect(xml).toContain('BACKGROUND_COLOR="#ffee00"');
    expect(xml).toContain('<edge COLOR="#ff0000" WIDTH="4"/>');
  });

  it('round-trips structure, colors, edge style and folded state', () => {
    let map = createMindmap({ id: 'm', title: 'T', rootText: 'Inti', at: { x: 0, y: 0 } });
    map = addChild(map, map.rootId, 'c1', 'A');
    map = addChild(map, map.rootId, 'c2', 'B');
    map = addChild(map, 'c1', 'g1', 'A1');
    map = updateNode(map, 'c1', { color: '#ffee00', edgeColor: '#ff0000', edgeWidth: 4 });
    map = toggleCollapse(map, 'c1');

    const back = importFreeMind(exportFreeMind(map));
    expect(back.title).toBe('Inti');
    const root = back.nodes[back.rootId];
    expect(root.text).toBe('Inti');
    const [a, b] = childrenOf(back, back.rootId);
    expect([a.text, b.text]).toEqual(['A', 'B']);
    expect(a).toMatchObject({ color: '#ffee00', edgeColor: '#ff0000', edgeWidth: 4, collapsed: true });
    expect(childrenOf(back, a.id).map((n) => n.text)).toEqual(['A1']);
    expect(b.color).toBeUndefined();
  });

  it('imports a hand-written FreeMind file with richcontent and thin edges', () => {
    const xml = `<?xml version="1.0"?><map version="0.9.0"><node ID="ID_1" TEXT="Root">
      <node ID="ID_2" POSITION="right"><richcontent TYPE="NODE"><html><body><p>Rich text</p></body></html></richcontent><edge COLOR="#00ff00" WIDTH="thin"/></node>
    </node></map>`;
    const map = importFreeMind(xml);
    const [child] = childrenOf(map, map.rootId);
    expect(child.text).toBe('Rich text');
    expect(child.edgeColor).toBe('#00ff00');
    expect(child.edgeWidth).toBe(1);
    expect(child.x).toBeGreaterThan(map.nodes[map.rootId].x);
  });

  it('rejects invalid xml or files without a root node', () => {
    expect(() => importFreeMind('<map')).toThrow(ImportError);
    expect(() => importFreeMind('<map version="1.0.1"></map>')).toThrow(ImportError);
    expect(() => importFreeMind('<html></html>')).toThrow(ImportError);
  });

  it('drops unsafe colors from imported files', () => {
    const xml = '<map><node TEXT="r" BACKGROUND_COLOR="red;x"><node TEXT="c"><edge COLOR="javascript:1"/></node></node></map>';
    const map = importFreeMind(xml);
    expect(map.nodes[map.rootId].color).toBeUndefined();
    expect(childrenOf(map, map.rootId)[0].edgeColor).toBeUndefined();
  });
});

describe('FreeMind notes', () => {
  it('exports a note as richcontent TYPE="NOTE" with well-formed XHTML', () => {
    let map = createMindmap({ id: 'm', title: 'T', rootText: 'Inti', at: { x: 0, y: 0 } });
    map = updateNode(map, map.rootId, { note: '<p>a &amp; b<br><img src="data:image/png;base64,AAAA" alt="x"></p>' });
    const xml = exportFreeMind(map);
    expect(xml).toContain('<richcontent TYPE="NOTE"><html><head></head><body><p>a &amp; b<br/><img src="data:image/png;base64,AAAA" alt="x"/></p></body></html></richcontent>');
    expect(new DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror')).toBeNull();
  });

  it('round-trips notes on parent and leaf nodes', () => {
    let map = createMindmap({ id: 'm', title: 'T', rootText: 'Inti', at: { x: 0, y: 0 } });
    map = addChild(map, map.rootId, 'c1', 'A');
    const rootNote = '<h2>Judul</h2><ul><li>satu</li></ul>';
    const leafNote = '<p><a href="https://a.com/?q=1&amp;r=2">x</a> <b>t</b><img src="data:image/png;base64,AAAA"></p>';
    map = updateNode(updateNode(map, map.rootId, { note: rootNote }), 'c1', { note: leafNote });
    const back = importFreeMind(exportFreeMind(map));
    expect(back.nodes[back.rootId].note).toBe(rootNote);
    expect(childrenOf(back, back.rootId)[0].note).toBe(leafNote);
    expect(childrenOf(back, back.rootId)[0].text).toBe('A');
  });

  it('imports a hand-written FreeMind note and keeps the NODE richcontent as text', () => {
    const xml = `<map version="1.0.1"><node TEXT="Root">
      <richcontent TYPE="NOTE"><html><head/><body><p>Catatan <i>miring</i></p><p/></body></html></richcontent>
      <node><richcontent TYPE="NOTE"><html><body><p>nota</p></body></html></richcontent><richcontent TYPE="NODE"><html><body><p>Judul</p></body></html></richcontent></node>
    </node></map>`;
    const map = importFreeMind(xml);
    expect(map.nodes[map.rootId].note).toBe('<p>Catatan <i>miring</i></p><p></p>');
    const child = childrenOf(map, map.rootId)[0];
    expect(child.text).toBe('Judul');
    expect(child.note).toBe('<p>nota</p>');
  });

  it('sanitizes unsafe note markup from imported files', () => {
    const xml = `<map><node TEXT="r"><richcontent TYPE="NOTE"><html><body><p onclick="x">a</p><script>alert(1)</script><a href="javascript:alert(1)">l</a><img src="data:image/svg+xml;base64,AAAA"/><span>s</span></body></html></richcontent></node></map>`;
    const map = importFreeMind(xml);
    expect(map.nodes[map.rootId].note).toBe('<p>a</p>ls');
  });

  it('rejects files larger than 10 MB', () => {
    expect(() => importFreeMind(`<map>${' '.repeat(10 * 1024 * 1024)}</map>`)).toThrow(/too large/i);
  });
});

describe('FreeMind parser limits', () => {
  const parse = () => vi.spyOn(DOMParser.prototype, 'parseFromString');

  it('rejects deeply nested elements before parsing', () => {
    const spy = parse();
    const xml = `<map><node TEXT="r">${'<b>'.repeat(5000)}x${'</b>'.repeat(5000)}</node></map>`;
    expect(() => importFreeMind(xml)).toThrow(ImportError);
    expect(() => importFreeMind(xml)).toThrow(/too deep/i);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('rejects mindmaps nested deeper than the tree limit', () => {
    const xml = `<map>${'<node TEXT="a">'.repeat(600)}${'</node>'.repeat(600)}</map>`;
    expect(() => importFreeMind(xml)).toThrow(/too deep/i);
  });

  it('accepts a reasonably deep mindmap', () => {
    const xml = `<map>${'<node TEXT="a">'.repeat(100)}${'</node>'.repeat(100)}</map>`;
    expect(Object.keys(importFreeMind(xml).nodes)).toHaveLength(100);
  });

  it('rejects too many elements of any kind before parsing', () => {
    const spy = parse();
    const xml = `<map><node TEXT="r">${'<x/>'.repeat(250_000)}</node></map>`;
    expect(() => importFreeMind(xml)).toThrow(/too many elements/i);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('rejects a map whose note images exceed the per-map cap', () => {
    const img = `<img src="data:image/png;base64,${'A'.repeat(1_398_100)}"/>`;
    const nodes = Array.from({ length: 7 }, (_, i) => `<node TEXT="n${i}"><richcontent TYPE="NOTE"><html><body><p>x</p>${img}</body></html></richcontent></node>`).join('');
    expect(() => importFreeMind(`<map><node TEXT="r">${nodes}</node></map>`)).toThrow(/images/i);
  });
});
