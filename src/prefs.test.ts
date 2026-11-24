import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, loadPrefs, savePrefs } from './prefs';

const KEY = 'smart-mindmap:prefs';

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('prefs', () => {
  it('defaults to the system theme', () => {
    expect(loadPrefs()).toEqual({ theme: 'system' });
  });

  it('persists a valid theme and ignores invalid stored values', () => {
    savePrefs({ theme: 'dark' });
    expect(loadPrefs()).toEqual({ theme: 'dark' });
    localStorage.setItem(KEY, '{"theme":"neon"}');
    expect(loadPrefs()).toEqual({ theme: 'system' });
    localStorage.setItem(KEY, 'garbage');
    expect(loadPrefs()).toEqual({ theme: 'system' });
  });

  it('drops the retired language preference and keeps the theme', () => {
    localStorage.setItem(KEY, '{"theme":"light","lang":"id"}');
    expect(loadPrefs()).toEqual({ theme: 'light' });
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({ theme: 'light' });
  });

  it('does not write storage when nothing needs migrating', () => {
    loadPrefs();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('applyTheme leaves system unset and forces light/dark', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
