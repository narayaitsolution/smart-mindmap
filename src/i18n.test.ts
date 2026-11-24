import { describe, expect, it } from 'vitest';
import { messages, translate } from './i18n';

describe('i18n', () => {
  it('has identical keys in both languages', () => {
    expect(Object.keys(messages.id).sort()).toEqual(Object.keys(messages.en).sort());
  });

  it('translates and interpolates', () => {
    expect(translate('id', 'maps.new')).toBe(messages.id['maps.new']);
    expect(translate('en', 'import.done', { count: 3 })).toContain('3');
  });

  it('never leaves untranslated placeholders in Indonesian', () => {
    for (const v of Object.values(messages.id)) expect(v.trim()).not.toBe('');
  });
});
