import { describe, expect, it } from 'vitest';
import { isHexColor, readableTextColor, SWATCHES } from './color';

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

  it('offers unique, valid default swatches with stable ids', () => {
    expect(SWATCHES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(SWATCHES.map((s) => s.id)).size).toBe(SWATCHES.length);
    expect(new Set(SWATCHES.map((s) => s.hex)).size).toBe(SWATCHES.length);
    for (const s of SWATCHES) expect(isHexColor(s.hex)).toBe(true);
  });
});
