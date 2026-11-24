import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles.css', 'utf8');

/** Custom properties declared in the rule whose selector contains `selector`. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`missing ${selector}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe.each([
  ['forced dark theme', ":root[data-theme='dark']"],
  ['system dark theme', ':root:not([data-theme])'],
])('%s', (_name, selector) => {
  const t = tokens(selector);

  it('uses matte dark blue chrome, not black or neutral grey', () => {
    for (const key of ['--bg', '--surface']) {
      const [r, g, b] = rgb(t[key]);
      expect(b, key).toBeGreaterThan(r + 15);
      expect(b, key).toBeGreaterThan(g + 8);
      expect(Math.max(r, g, b), key).toBeGreaterThanOrEqual(0x1a);
    }
  });

  it('keeps readable text, muted text and accent on the chrome surface', () => {
    expect(contrast(t['--text'], t['--surface'])).toBeGreaterThanOrEqual(7);
    expect(contrast(t['--muted'], t['--surface'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['--accent'], t['--surface'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['--danger'], t['--surface'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['--border'], t['--surface'])).toBeGreaterThanOrEqual(3);
  });
});

describe('chrome surfaces', () => {
  it('draw header, sidebar and zoom controls from the themed surface token', () => {
    for (const sel of ['.topbar {', '.zoombar {', '.inspector {']) {
      const start = css.indexOf(`\n${sel}`);
      expect(start, sel).toBeGreaterThan(-1);
      expect(css.slice(start, css.indexOf('}', start))).toContain('background: var(--surface)');
    }
  });

  it('has no hard-coded near-black chrome background', () => {
    expect(css).not.toMatch(/\.map-title:hover[^{]*\{[^}]*background:\s*#0b1a33/);
  });
});
