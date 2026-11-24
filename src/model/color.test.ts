import { describe, expect, it } from 'vitest';
import { FILL_SWATCHES, isHexColor, LINE_SWATCHES, readableTextColor } from './color';

describe('color', () => {
  it('accepts only hex colors', () => {
    for (const ok of ['#fff', '#FFEE00', '#ffee0080']) expect(isHexColor(ok)).toBe(true);
    for (const bad of ['red', 'url(#a)', '#12', '#ggg', 'red" onload="x', 42, undefined, null]) expect(isHexColor(bad)).toBe(false);
  });

  it('picks readable text for light and dark fills', () => {
    expect(readableTextColor('#ffee00')).toBe('#000000');
    expect(readableTextColor('#102a43')).toBe('#ffffff');
    expect(readableTextColor('#fff')).toBe('#000000');
    expect(readableTextColor(undefined)).toBe('#000000');
  });

  it('offers one compact row of fill presets starting with transparent', () => {
    expect(FILL_SWATCHES[0]).toEqual({ id: 'transparent', hex: undefined });
    expect(FILL_SWATCHES.length).toBeGreaterThanOrEqual(6);
    expect(FILL_SWATCHES.length).toBeLessThanOrEqual(8);
  });

  it('offers one compact row of line presets starting with black, the default line', () => {
    expect(LINE_SWATCHES[0]).toEqual({ id: 'black', hex: undefined });
    expect(LINE_SWATCHES.length).toBeGreaterThanOrEqual(6);
    expect(LINE_SWATCHES.length).toBeLessThanOrEqual(8);
  });

  it('keeps every preset distinct across both rows, with valid hex values and stable ids', () => {
    const all = [...FILL_SWATCHES, ...LINE_SWATCHES];
    const colors = all.filter((s) => s.hex !== undefined);
    for (const s of colors) expect(isHexColor(s.hex)).toBe(true);
    expect(new Set(colors.map((s) => s.hex)).size).toBe(colors.length);
    expect(new Set(FILL_SWATCHES.map((s) => s.id)).size).toBe(FILL_SWATCHES.length);
    expect(new Set(LINE_SWATCHES.map((s) => s.id)).size).toBe(LINE_SWATCHES.length);
    expect(FILL_SWATCHES.filter((s) => LINE_SWATCHES.some((l) => l.id === s.id)).map((s) => s.id)).toEqual([]);
  });
});
