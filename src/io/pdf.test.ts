import { describe, expect, it } from 'vitest';
import { buildPdf } from './pdf';

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

describe('buildPdf', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
  const pdf = buildPdf({ jpeg, width: 400, height: 300 });
  const text = latin1(pdf);

  it('has pdf header, trailer and embeds the jpeg bytes', () => {
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/Width 400');
    expect(text).toContain('/Height 300');
    expect(text).toContain(latin1(jpeg));
  });

  it('has an xref table whose offsets point at the objects', () => {
    const start = Number(/startxref\n(\d+)\n/.exec(text)?.[1]);
    expect(text.slice(start, start + 4)).toBe('xref');
    const lines = text.slice(start).split('\n');
    const count = Number(lines[1].split(' ')[1]);
    for (let i = 1; i < count; i++) {
      const offset = Number(lines[2 + i].slice(0, 10));
      expect(text.slice(offset, offset + `${i} 0 obj`.length)).toBe(`${i} 0 obj`);
    }
  });
});

describe('buildPdf page size', () => {
  it('uses explicit page size separate from the image pixel size', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const text = latin1(buildPdf({ jpeg, width: 800, height: 600, pageWidth: 400, pageHeight: 300 }));
    expect(text).toContain('/MediaBox [0 0 400 300]');
    expect(text).toContain('/Width 800');
    expect(text).toContain('400 0 0 300 0 0 cm');
  });
});
