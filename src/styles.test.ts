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

describe('workspace theming', () => {
  const light = tokens(':root {');
  const dark = tokens(":root[data-theme='dark']");
  const system = tokens(':root:not([data-theme])');
  const rule = (sel: string) => {
    const start = css.indexOf(`\n${sel} {`);
    expect(start, sel).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('}', start));
  };

  it.each([
    ['forced dark', dark],
    ['system dark', system],
  ])('%s recolors canvas paper, ink, default edges and canvas controls', (_n, t) => {
    for (const key of ['--paper', '--canvas-ink', '--canvas-muted', '--edge-default', '--control-bg', '--control-ink', '--node-stroke']) {
      expect(t[key], key).toBeDefined();
      expect(t[key], key).not.toBe(light[key]);
    }
    const [r, g, b] = rgb(t['--paper']);
    expect(b, 'paper stays blue, not black').toBeGreaterThan(r + 15);
    expect(Math.max(r, g, b)).toBeGreaterThanOrEqual(0x1a);
    expect(contrast(t['--canvas-ink'], t['--paper'])).toBeGreaterThanOrEqual(7);
    expect(contrast(t['--canvas-muted'], t['--paper'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['--canvas-soft'], t['--paper'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['--edge-default'], t['--paper'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['--node-stroke'], t['--paper'])).toBeGreaterThanOrEqual(3);
    expect(contrast(t['--canvas-accent'], t['--paper'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['--control-ink'], t['--control-bg'])).toBeGreaterThanOrEqual(7);
  });

  it('light theme keeps its paper canvas with readable ink', () => {
    expect(contrast(light['--canvas-ink'], light['--paper'])).toBeGreaterThanOrEqual(7);
    expect(contrast(light['--canvas-muted'], light['--paper'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light['--edge-default'], light['--paper'])).toBeGreaterThanOrEqual(7);
  });

  it('stage, overlay, nodes, edges and controls read the themed tokens', () => {
    expect(rule('.stage')).toContain('background: var(--paper)');
    expect(rule('.overlay')).toContain('color: var(--canvas-ink)');
    expect(rule('.node-edit')).toContain('background: var(--canvas-field)');
    expect(css).toMatch(/\.edge\[data-default='true'\]\s*\{[^}]*stroke:\s*var\(--edge-default\)/);
    expect(css).toMatch(/\.node text\.node-label-auto\s*\{[^}]*fill:\s*var\(--canvas-ink\)/);
    expect(rule('.side-control circle')).toContain('fill: var(--control-bg)');
  });

  it('keeps the topbar matte dark blue in every theme', () => {
    const bar = rule('.topbar');
    for (const [prop, token] of [
      ['--surface', '--chrome-bg'],
      ['--field', '--chrome-field'],
      ['--text', '--chrome-text'],
      ['--border', '--chrome-border'],
      ['--accent', '--chrome-accent'],
    ]) {
      expect(bar).toContain(`${prop}: var(${token})`);
    }
    expect(light['--chrome-bg']).toBeDefined();
    expect(light['--chrome-text']).toBeDefined();
    const [r, g, b] = rgb(light['--chrome-bg']);
    expect(b).toBeGreaterThan(r + 15);
    expect(b).toBeGreaterThan(g + 8);
    expect(contrast(light['--chrome-text'], light['--chrome-bg'])).toBeGreaterThanOrEqual(7);
    expect(contrast(light['--chrome-muted'], light['--chrome-bg'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light['--chrome-accent'], light['--chrome-bg'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light['--chrome-danger'], light['--chrome-bg'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light['--chrome-border'], light['--chrome-bg'])).toBeGreaterThanOrEqual(3);
    expect(contrast(light['--chrome-text'], light['--chrome-field'])).toBeGreaterThanOrEqual(7);
  });
});

describe('compact sidebar', () => {
  const rule = (sel: string) => {
    const start = css.indexOf(`\n${sel} {`);
    expect(start, sel).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('}', start));
  };

  it('keeps each swatch row on one line', () => {
    expect(rule('.swatches')).toContain('flex-wrap: nowrap');
  });

  it('lays out note actions in one row and makes Clear note a large full-width button', () => {
    expect(rule('.note-actions')).toContain('flex-wrap: nowrap');
    const clear = rule('button.note-clear');
    expect(clear).toContain('width: 100%');
    expect(clear).toMatch(/min-height:\s*(4\d|5\d)px/);
  });

  it('shows transparent as a distinct slashed swatch', () => {
    expect(css).toMatch(/button\.swatch\.transparent\s*\{/);
  });
});
