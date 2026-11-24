import { describe, expect, it } from 'vitest';
import { messages, translate } from './i18n';

describe('i18n', () => {
  it('is English only', () => {
    expect(Object.keys(messages).every((k) => typeof k === 'string')).toBe(true);
    expect(Object.values(messages).every((v) => typeof v === 'string' && v.trim() !== '')).toBe(true);
    expect(messages['maps.new']).toBe('New mindmap');
  });

  it('translates and interpolates', () => {
    expect(translate('import.done', { count: 3 })).toBe('Imported 3 mindmap(s).');
  });

  it('has the header labels for open, save, save as and theme, and no login labels', () => {
    expect(Object.keys(messages)).not.toContain('auth.login');
    expect(Object.keys(messages)).not.toContain('auth.logout');
    expect(messages['io.saveAs']).toBe('Save as');
    expect(messages['io.open']).toBe('Open');
    expect(messages['io.save']).toBe('Save');
    expect(messages['theme.dark']).toBe('Dark theme');
  });
});

describe('i18n sidebar labels', () => {
  it('uses Line width and color swatch names', () => {
    expect(messages['node.edgeWidth']).toBe('Line width');
    expect(translate('node.swatchFill', { color: translate('color.red') })).toBe('Fill: Red');
  });
});

describe('i18n fullscreen and presets', () => {
  it('names the fullscreen states and drops the separate reset buttons', () => {
    expect(messages['fullscreen.enter']).toBe('Enter fullscreen');
    expect(messages['fullscreen.exit']).toBe('Exit fullscreen');
    expect(messages['fullscreen.unsupported']).toBe('Fullscreen is not available in this browser');
    expect(messages['fullscreen.failed']).toBe('The browser blocked fullscreen.');
    expect(messages['color.transparent']).toBe('Transparent');
    expect(Object.keys(messages)).not.toContain('node.transparent');
    expect(Object.keys(messages)).not.toContain('node.black');
  });
});
