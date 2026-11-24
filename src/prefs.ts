export type ThemePref = 'system' | 'light' | 'dark';
export type Lang = 'en' | 'id';
export interface Prefs {
  theme: ThemePref;
  lang: Lang;
}

const KEY = 'smart-mindmap:prefs';
const DEFAULTS: Prefs = { theme: 'system', lang: 'en' };

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    const theme: ThemePref = raw?.theme === 'light' || raw?.theme === 'dark' || raw?.theme === 'system' ? raw.theme : DEFAULTS.theme;
    const lang: Lang = raw?.lang === 'id' || raw?.lang === 'en' ? raw.lang : DEFAULTS.lang;
    return { theme, lang };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage may be blocked; preferences just won't persist.
  }
}

/** `system` removes the override so the CSS prefers-color-scheme rules apply. */
export function applyTheme(theme: ThemePref): void {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
