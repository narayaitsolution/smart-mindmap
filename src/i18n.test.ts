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

  it('has the header labels for login, open, save and theme', () => {
    expect(messages['auth.login']).toBe('Login');
    expect(messages['auth.logout']).toBe('Logout');
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
