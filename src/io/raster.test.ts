import { describe, expect, it } from 'vitest';
import { addChild, createMindmap, updateNode } from '../model/mindmap';
import { clampScale, dataUrlToBytes, mapToSvg, rasterSvgInput } from './raster';

describe('raster helpers', () => {
  it('keeps the exported canvas within safe pixel limits', () => {
    expect(clampScale(1000, 500, 2)).toBe(2);
    expect(clampScale(10000, 500, 2)).toBeCloseTo(0.8);
    expect(clampScale(100, 100, 2)).toBe(2);
  });

  it('decodes a base64 data url into bytes', () => {
    expect(Array.from(dataUrlToBytes('data:image/jpeg;base64,/9j/'))).toEqual([0xff, 0xd8, 0xff]);
  });
});

describe('raster input', () => {
  it('feeds PNG, JPG and PDF the same SVG that includes notes', async () => {
    let map = createMindmap({ id: 'm', title: 'T', rootText: 'Akar', at: { x: 0, y: 0 } });
    map = addChild(map, map.rootId, 'c1', 'Anak');
    map = updateNode(map, 'c1', { note: '<p>isi catatan</p>' });
    const input = rasterSvgInput(map);
    expect(input.svg).toContain('isi catatan');
    expect(input.svg).toBe(await mapToSvg(map).text());
  });
});
