export type ThemePref = 'system' | 'light' | 'dark';
export interface Prefs {
  theme: ThemePref;
}

const KEY = 'smart-mindmap:prefs';
const DEFAULTS: Prefs = { theme: 'system' };

/** Reads stored prefs. A retired `lang` key (the UI is English-only) is dropped and the cleaned prefs are written back. */
export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    const theme: ThemePref = raw?.theme === 'light' || raw?.theme === 'dark' || raw?.theme === 'system' ? raw.theme : DEFAULTS.theme;
    const prefs: Prefs = { theme };
    if (raw && typeof raw === 'object' && 'lang' in raw) savePrefs(prefs);
    return prefs;
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

/** The theme actually shown: the stored choice, or the OS color scheme when the choice is `system`. */
export function resolveTheme(theme: ThemePref): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
