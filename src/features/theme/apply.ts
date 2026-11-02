// Job 020: puts the Omarchy token map on <html> as inline custom properties (CSSOM, allowed by the
// CSP's `style-src 'self'`), and caches it for the first paint of the next start
// (`public/theme-boot.js` reads the same key and accepts the same names and values only).
import {
  omarchyTokens,
  themeDisplayName,
  TOKEN_NAMES,
  TOKEN_VALUE,
  type OmarchyTheme,
  type OmarchyTokens,
  type ThemeMode,
} from "./omarchy";

export const OMARCHY_STORAGE_KEY = "meeting-companion.omarchy";

/** An Omarchy theme ready to apply. */
export interface AppliedOmarchy {
  /** For the settings hint ("Tokyo Night"); empty when unknown (e.g. from the cache). */
  name: string;
  mode: ThemeMode;
  /** Complete when mapped from the core; the cache may have lost entries that were not valid. */
  tokens: Partial<OmarchyTokens>;
}

/** The theme the core reported, mapped; `null` if it is not usable. */
export function toApplied(theme: OmarchyTheme | null): AppliedOmarchy | null {
  if (!theme) return null;
  const tokens = omarchyTokens(theme);
  if (!tokens) return null;
  return { name: themeDisplayName(theme.name), mode: theme.mode === "light" ? "light" : "dark", tokens };
}

/** Sets every token of `tokens` on <html>, or removes them all (`null`). Only known names, only hex. */
export function setOmarchyTokens(tokens: Partial<Record<string, unknown>> | null) {
  const style = document.documentElement.style;
  for (const name of TOKEN_NAMES) {
    const value = tokens?.[name];
    if (typeof value === "string" && TOKEN_VALUE.test(value)) style.setProperty(name, value);
    else style.removeProperty(name);
  }
}

/** The cached map, with unknown names and non-hex values dropped; `null` if there is none. */
export function readOmarchyCache(): AppliedOmarchy | null {
  try {
    const raw = localStorage.getItem(OMARCHY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { mode?: unknown; tokens?: unknown };
    if (parsed?.mode !== "light" && parsed?.mode !== "dark") return null;
    if (typeof parsed.tokens !== "object" || parsed.tokens === null) return null;
    const source = parsed.tokens as Record<string, unknown>;
    const tokens: Partial<OmarchyTokens> = {};
    for (const name of TOKEN_NAMES) {
      const v = Object.prototype.hasOwnProperty.call(source, name) ? source[name] : undefined;
      if (typeof v === "string" && TOKEN_VALUE.test(v)) tokens[name] = v;
    }
    return Object.keys(tokens).length > 0 ? { name: "", mode: parsed.mode, tokens } : null;
  } catch {
    return null;
  }
}

/** Replaces the cache with this map, or clears it. Colours and the mode only. */
export function cacheOmarchy(applied: AppliedOmarchy | null) {
  try {
    if (applied)
      localStorage.setItem(
        OMARCHY_STORAGE_KEY,
        JSON.stringify({ mode: applied.mode, tokens: applied.tokens }),
      );
    else localStorage.removeItem(OMARCHY_STORAGE_KEY);
  } catch {
    // The theme still applies for this session.
  }
}
