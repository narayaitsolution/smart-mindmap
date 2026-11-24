import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, loadPrefs, savePrefs } from './prefs';

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('prefs', () => {
  it('defaults to system theme and English', () => {
    expect(loadPrefs()).toEqual({ theme: 'system', lang: 'en' });
  });

  it('persists valid prefs and ignores invalid stored values', () => {
    savePrefs({ theme: 'dark', lang: 'id' });
    expect(loadPrefs()).toEqual({ theme: 'dark', lang: 'id' });
    localStorage.setItem('smart-mindmap:prefs', '{"theme":"neon","lang":"xx"}');
    expect(loadPrefs()).toEqual({ theme: 'system', lang: 'en' });
    localStorage.setItem('smart-mindmap:prefs', 'garbage');
    expect(loadPrefs()).toEqual({ theme: 'system', lang: 'en' });
  });

  it('applyTheme leaves system unset and forces light/dark', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
