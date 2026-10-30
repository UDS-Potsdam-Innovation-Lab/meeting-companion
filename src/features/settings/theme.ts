import type { ThemeSetting } from "../../lib/ipc";

/** The theme is cached here for the first paint (`public/theme-boot.js` reads the same key). */
export const THEME_STORAGE_KEY = "meeting-companion.theme";
export const THEMES: readonly ThemeSetting[] = ["light", "dark", "system"];
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function readCachedTheme(): ThemeSetting | null {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return THEMES.includes(v as ThemeSetting) ? (v as ThemeSetting) : null;
  } catch {
    return null;
  }
}

export function cacheTheme(theme: ThemeSetting) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The theme still applies for this session.
  }
}

export function systemIsDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

/** Sets `data-theme` on <html> and, for "system", follows the OS until the returned function is called. */
export function applyTheme(theme: ThemeSetting, onResolved?: (dark: boolean) => void): () => void {
  const root = document.documentElement;
  const set = (dark: boolean) => {
    root.dataset.theme = dark ? "dark" : "light";
    onResolved?.(dark);
  };
  if (theme !== "system" || typeof window.matchMedia !== "function") {
    set(theme === "dark");
    return () => {};
  }
  const query = window.matchMedia(DARK_QUERY);
  set(query.matches);
  const listener = (e: MediaQueryListEvent) => set(e.matches);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
