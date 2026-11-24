import { describe, expect, it } from 'vitest';
import { isHexColor, readableTextColor } from './color';

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
});
