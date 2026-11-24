import { describe, expect, it } from 'vitest';
import { addChild, createMindmap, toggleCollapse, updateNode } from '../model/mindmap';
import { mapToSvg } from './raster';
import { renderMapSvg } from './svg';

describe('renderMapSvg', () => {
  const build = () => {
    let map = createMindmap({ id: 'm', title: 'T', rootText: 'A <b> & "q"', at: { x: 0, y: 0 } });
    map = addChild(map, map.rootId, 'c1', 'Anak');
    map = addChild(map, 'c1', 'g1', 'Cucu');
    map = updateNode(map, 'c1', { color: '#ffee00', edgeColor: '#ff0000', edgeWidth: 5 });
    return map;
  };

  it('renders valid svg with escaped text, black default edge and colored overrides', () => {
    const { svg, width, height } = renderMapSvg(build(), { background: '#ffffff' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(`width="${width}"`);
    expect(svg).toContain(`height="${height}"`);
    expect(svg).toContain('A &lt;b&gt; &amp; &quot;q&quot;');
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('stroke="#ff0000"');
    expect(svg).toContain('stroke-width="5"');
    expect(svg).toContain('stroke="#000000"');
    expect(svg).toContain('fill="#ffee00"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('<rect width="100%" height="100%" fill="#ffffff"/>');
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
  });

  it('omits the background when null and skips collapsed descendants', () => {
    const map = toggleCollapse(build(), 'c1');
    const { svg } = renderMapSvg(map, { background: null });
    expect(svg).not.toContain('Cucu');
    expect(svg).not.toContain('<rect width="100%"');
  });
});

describe('renderMapSvg wrapping', () => {
  it('draws a long label on several lines inside a taller box', () => {
    const map = createMindmap({ id: 'm', title: 'T', rootText: 'Teks yang cukup panjang supaya terbagi menjadi beberapa baris di dalam kotak', at: { x: 0, y: 0 } });
    const { svg } = renderMapSvg(map, { background: null });
    const rows = [...svg.matchAll(/<text [^>]*text-anchor="middle"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.join(' ')).toBe(map.nodes[map.rootId].text);
    expect(Number(/<rect x="0" y="0" width="\d+" height="(\d+)"/.exec(svg)?.[1])).toBeGreaterThan(40);
  });
});

describe('renderMapSvg with notes', () => {
  const noted = (note: string) => {
    let map = createMindmap({ id: 'm', title: 'T', rootText: 'Akar', at: { x: 0, y: 0 } });
    map = addChild(map, map.rootId, 'c1', 'Anak');
    map = addChild(map, 'c1', 'g1', 'Cucu');
    return updateNode(map, map.rootId, { note });
  };

  it('prints visible notes under the map as plain, escaped text', () => {
    const plain = renderMapSvg(createMindmap({ id: 'p', title: 'T', rootText: 'Akar', at: { x: 0, y: 0 } }), { background: null });
    const { svg, height } = renderMapSvg(noted('<p>rahasia &lt;b&gt; &amp; <b>tebal</b></p><ul><li>satu</li></ul>'), { background: '#ffffff' });
    expect(svg).toContain('Akar');
    expect(svg).toContain('rahasia &lt;b&gt; &amp; tebal');
    expect(svg).toContain('• satu');
    expect(svg).not.toContain('<b>');
    expect(height).toBeGreaterThan(plain.height);
    expect(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror')).toBeNull();
  });

  it('keeps remote and local images out of the file but marks them', () => {
    const { svg } = renderMapSvg(noted('<p>a<img src="data:image/png;base64,AAAA"><img src="https://a.com/p.png" alt="foto"></p>'), { background: null });
    expect(svg).toContain('[image]');
    expect(svg).toContain('foto (https://a.com/p.png)');
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('<img');
    expect(svg).not.toContain('data:image');
  });

  it('skips notes of nodes hidden by a collapsed parent', () => {
    let map = noted('<p>akar</p>');
    map = updateNode(map, 'g1', { note: '<p>tersembunyi</p>' });
    expect(renderMapSvg(map, { background: null }).svg).toContain('tersembunyi');
    map = toggleCollapse(map, 'c1');
    expect(renderMapSvg(map, { background: null }).svg).not.toContain('tersembunyi');
  });

  it('omits the notes section when no visible node has a note', () => {
    const { svg, height } = renderMapSvg(createMindmap({ id: 'p', title: 'T', rootText: 'Akar', at: { x: 0, y: 0 } }), { background: null });
    expect(height).toBeLessThan(200);
    expect(svg).not.toContain('Notes');
  });

  it('wraps long lines and truncates huge notes so the export stays bounded', () => {
    const { svg, width } = renderMapSvg(noted(`<p>${'kata '.repeat(5000)}</p>`), { background: null });
    expect(svg).toContain('…');
    expect(svg.length).toBeLessThan(200_000);
    const lines = [...svg.matchAll(/<text [^>]*data-note[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length * 7).toBeLessThanOrEqual(width);
  });

  it('is what mapToSvg writes to the file', async () => {
    const text = await mapToSvg(noted('<p>dalam berkas</p>')).text();
    expect(text).toContain('dalam berkas');
  });
});
