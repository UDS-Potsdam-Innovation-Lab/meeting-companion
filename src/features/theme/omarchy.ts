// Job 020: the active Omarchy theme as values for the app's colour tokens (the `:root` block of
// src/styles.css). A pure function: the palette in, one hex colour per token out. The palette comes
// from theme files anyone can publish, so every value is checked again here (the core already did),
// and every text colour is moved toward the foreground side until it meets WCAG 2.2 AA.

/** The palette keys the core sends (Omarchy's semantic names). */
export const PALETTE_KEYS = [
  "accent",
  "background",
  "foreground",
  "dark_background",
  "darker_background",
  "lighter_background",
  "dark_foreground",
  "light_foreground",
  "bright_foreground",
  "muted",
  "selection",
  "red",
  "yellow",
  "orange",
  "green",
  "cyan",
  "blue",
  "magenta",
] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];

export type ThemeMode = "light" | "dark";

/** What the core sends (`omarchy_theme`, event `omarchy-theme`). */
export interface OmarchyTheme {
  /** The slug (`tokyo-night`); empty when the theme has no valid name. */
  name: string;
  mode: ThemeMode;
  palette: Partial<Record<PaletteKey, string>>;
}

/**
 * Every colour token of the `:root` block that Omarchy mode sets, as inline properties on <html>.
 * Not here: the theme previews (`--preview-*`, fixed on purpose) and the two shadows, which are not
 * colours but shadow lists; they follow `data-theme` from the token blocks.
 */
export const TOKEN_NAMES = [
  "--bg",
  "--surface",
  "--sunken",
  "--ink",
  "--ink-2",
  "--muted",
  "--line",
  "--line-strong",
  "--accent",
  "--accent-soft",
  "--accent-ink",
  "--teal-ink",
  "--teal-soft",
  "--amber-ink",
  "--amber-soft",
  "--overrun",
  "--overrun-soft",
  "--green",
  "--green-soft",
  "--green-ink",
  "--dark",
  "--dark-3",
  "--dark-ink",
  "--dark-muted",
  "--dark-accent",
  "--dark-amber",
  "--dark-overrun",
  "--on-accent",
  "--on-ink",
  "--on-avatar",
  "--dark-strong",
  "--dark-3-hover",
  "--disabled-ink",
  "--overrun-ink",
  "--hover-tint",
  "--warn-ink",
  "--warn-soft",
  "--warn-line",
] as const;
export type TokenName = (typeof TOKEN_NAMES)[number];
export type OmarchyTokens = Record<TokenName, string>;

/** The only values ever written to a token: `#rrggbb` or `#rrggbbaa`. */
export const TOKEN_VALUE = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/;

/** Text contrast with a small margin over the 4.5:1 of WCAG AA. */
const TEXT = 4.6;
/** Non-text contrast (lines, focus ring) with a small margin over 3:1. */
const NON_TEXT = 3.1;
/** Least hue distance between decisions (green), to-dos (amber), questions (accent) and overrun (red). */
export const MIN_HUE_DISTANCE = 30;
/** Below this HSL saturation a palette colour is grey and cannot carry a meaning by hue. */
const MIN_SATURATION = 0.2;

const WHITE = "#ffffff";
const BLACK = "#000000";

/** The app's own status colours, used when the palette has none that is clearly distinct. */
const OWN: Record<
  ThemeMode,
  { overrun: string; amber: string; green: string; accent: string; teal: string }
> = {
  light: { overrun: "#b42318", amber: "#8a5300", green: "#13804a", accent: "#4338ca", teal: "#0b6266" },
  dark: { overrun: "#ff8086", amber: "#f2b04a", green: "#4cc98a", accent: "#8f88ff", teal: "#4fc9cc" },
};

// ---- colour arithmetic ----------------------------------------------------------------------------

type Rgb = [number, number, number];

/** `#rgb`, `#rrggbb` or `#rrggbbaa` → `#rrggbb` (lower case, alpha dropped); anything else `null`. */
export function normaliseHex(value: unknown): string | null {
  if (typeof value !== "string" || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value))
    return null;
  const d = value.slice(1).toLowerCase();
  if (d.length === 3) return `#${d[0]}${d[0]}${d[1]}${d[1]}${d[2]}${d[2]}`;
  return `#${d.slice(0, 6)}`;
}

function rgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function hex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** `a` moved `t` (0..1) of the way to `b`. */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return hex([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * t) as Rgb);
}

/** WCAG relative luminance. */
export function luminance(colour: string): number {
  const [r, g, b] = rgb(colour).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1..21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** HSL hue in degrees and saturation 0..1. */
export function hueOf(colour: string): { hue: number; saturation: number } {
  const [r, g, b] = rgb(colour).map((c) => c / 255) as Rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return { hue: 0, saturation: 0 };
  const saturation = d / (1 - Math.abs(2 * l - 1));
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { hue, saturation };
}

export function hueDistance(a: string, b: string): number {
  const d = Math.abs(hueOf(a).hue - hueOf(b).hue) % 360;
  return Math.min(d, 360 - d);
}

/** White or black, whichever stands out more against all of `grounds`. */
function extremeFor(grounds: string[]): string {
  const worst = (c: string) => Math.min(...grounds.map((g) => contrast(c, g)));
  return worst(WHITE) >= worst(BLACK) ? WHITE : BLACK;
}

/**
 * `colour` if it reaches `min` on every ground; otherwise moved in small steps toward each target in
 * turn until it does. Moving toward white or black keeps the hue.
 */
function ensure(colour: string, grounds: string[], min: number, targets: string[] = []): string {
  const passes = (c: string) => grounds.every((g) => contrast(c, g) >= min);
  if (passes(colour)) return colour;
  let from = colour;
  for (const target of [...targets, extremeFor(grounds)]) {
    for (let t = 0.02; t <= 1.0001; t += 0.02) {
      const c = mix(from, target, Math.min(1, t));
      if (passes(c)) return c;
    }
    from = target;
  }
  return from;
}

/** The first of `candidates` that reaches `min` on every ground (else the best one). */
function onColour(grounds: string[], candidates: string[]): string {
  const worst = (c: string) => Math.min(...grounds.map((g) => contrast(c, g)));
  const all = [...candidates, WHITE, BLACK];
  return all.find((c) => worst(c) >= TEXT) ?? all.reduce((a, b) => (worst(b) > worst(a) ? b : a));
}

// ---- the mapping --------------------------------------------------------------------------------

/** Only the known palette keys, each a valid colour, normalised. */
export function cleanPalette(palette: unknown): Partial<Record<PaletteKey, string>> {
  const out: Partial<Record<PaletteKey, string>> = {};
  if (typeof palette !== "object" || palette === null) return out;
  for (const key of PALETTE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(palette, key)) continue;
    const v = normaliseHex((palette as Record<string, unknown>)[key]);
    if (v) out[key] = v;
  }
  return out;
}

/** Picks a colour for each meaning, in order, so no two lie closer than {@link MIN_HUE_DISTANCE}. */
function pickHues(p: Partial<Record<PaletteKey, string>>, own: (typeof OWN)["light"]) {
  const picked: string[] = [];
  const pick = (candidates: (string | undefined)[], fallback: string) => {
    const ok = (c: string) =>
      hueOf(c).saturation >= MIN_SATURATION && picked.every((q) => hueDistance(c, q) >= MIN_HUE_DISTANCE);
    const chosen = candidates.find((c): c is string => !!c && ok(c)) ?? fallback;
    picked.push(chosen);
    return chosen;
  };
  const overrun = pick([p.red], own.overrun);
  const amber = pick([p.yellow, p.orange], own.amber);
  const green = pick([p.green], own.green);
  const accent = pick([p.accent, p.blue, p.magenta, p.cyan], own.accent);
  const teal = p.cyan && hueOf(p.cyan).saturation >= MIN_SATURATION ? p.cyan : own.teal;
  return { overrun, amber, green, accent, teal };
}

/**
 * The token values for an Omarchy theme, or `null` when it has no usable background and foreground
 * (the app then keeps its own tokens). Invalid palette values are ignored key by key.
 */
export function omarchyTokens(theme: OmarchyTheme): OmarchyTokens | null {
  const p = cleanPalette(theme?.palette);
  if (!p.background || !p.foreground) return null;
  const mode: ThemeMode = theme.mode === "light" || theme.mode === "dark" ? theme.mode : "dark";

  // A background in the middle of the grey scale leaves no room for text: move it toward its end.
  let bg = p.background;
  const bgEnd = luminance(bg) < 0.18 ? BLACK : WHITE;
  for (let t = 0.1; contrast(bg, bgEnd === BLACK ? WHITE : BLACK) < 7 && t <= 1.0001; t += 0.1)
    bg = mix(p.background, bgEnd, Math.min(1, t));
  const darkGround = bgEnd === BLACK;
  const fg = p.foreground;
  // The foreground side: white on a dark ground, black on a light one.
  const fgEnd = darkGround ? WHITE : BLACK;

  const lighter = p.lighter_background;
  const surface = darkGround
    ? lighter && luminance(lighter) > luminance(bg) && contrast(lighter, WHITE) >= 7
      ? lighter
      : mix(bg, fgEnd, 0.05)
    : mix(bg, WHITE, 0.7);
  const sunken = darkGround ? mix(surface, fgEnd, 0.06) : mix(bg, BLACK, 0.035);
  const hues = pickHues(p, OWN[mode]);
  const soft = (c: string) => mix(surface, c, darkGround ? 0.2 : 0.12);
  const accentSoft = soft(hues.accent);
  const tealSoft = soft(hues.teal);
  const amberSoft = soft(hues.amber);
  const overrunSoft = soft(hues.overrun);
  const greenSoft = soft(hues.green);
  // Every text colour is checked on every ground the stylesheet puts text on: the three neutrals and
  // the soft tints (a chip, the current agenda row, a selected choice, an unsure voice row, …).
  const grounds = [bg, surface, sunken, accentSoft, tealSoft, amberSoft, overrunSoft, greenSoft];
  const text = (c: string, toward: string[] = []) => ensure(c, grounds, TEXT, toward);

  const ink = text(fg, [fgEnd]);
  const ink2 = text(mix(ink, surface, 0.25), [ink]);
  const muted = text(p.muted ?? p.dark_foreground ?? mix(ink, surface, 0.45), [ink]);
  const line = mix(surface, ink, darkGround ? 0.14 : 0.12);
  const lineStrong = ensure(mix(surface, ink, 0.4), [surface, bg], NON_TEXT, [ink]);

  // Accent (also the questions' colour and the focus ring); it is used as text, too.
  const accent = text(hues.accent);
  const accentInk = text(hues.accent);
  const tealInk = text(hues.teal);
  const amberInk = text(hues.amber);
  const overrun = text(hues.overrun);
  const overrunInk = text(hues.overrun);
  const green = text(hues.green);
  const greenInk = text(hues.green);
  // The warning icon writes its glyph in the soft tint on the line colour.
  const warnLine = ensure(hues.amber, [amberSoft], TEXT);

  // The dark cards of the live view (timer, nudge) stay dark in a light theme as well.
  const darkBase = darkGround
    ? p.darker_background && luminance(p.darker_background) <= luminance(bg)
      ? p.darker_background
      : mix(bg, BLACK, 0.4)
    : mix(ink, BLACK, 0.35);
  let dark = darkBase;
  for (let t = 0.15; luminance(dark) > 0.02 && t <= 1.0001; t += 0.15)
    dark = mix(darkBase, BLACK, Math.min(1, t));
  const dark3 = mix(dark, WHITE, 0.1);
  const dark3Hover = mix(dark, WHITE, 0.15);
  const darkGrounds = [dark, dark3, dark3Hover];
  const darkInk = ensure(darkGround ? (p.bright_foreground ?? ink) : bg, darkGrounds, TEXT, [WHITE]);
  const darkMuted = ensure(mix(darkInk, dark, 0.35), [dark, dark3], TEXT, [darkInk]);
  const darkStrong = ensure(mix(darkInk, WHITE, 0.5), darkGrounds, TEXT, [WHITE]);
  const onDark = (c: string, min: number) => ensure(c, [dark, dark3], min, [WHITE]);

  const tokens: OmarchyTokens = {
    "--bg": bg,
    "--surface": surface,
    "--sunken": sunken,
    "--ink": ink,
    "--ink-2": ink2,
    "--muted": muted,
    "--line": line,
    "--line-strong": lineStrong,
    "--accent": accent,
    "--accent-soft": accentSoft,
    "--accent-ink": accentInk,
    "--teal-ink": tealInk,
    "--teal-soft": tealSoft,
    "--amber-ink": amberInk,
    "--amber-soft": amberSoft,
    "--overrun": overrun,
    "--overrun-soft": overrunSoft,
    "--green": green,
    "--green-soft": greenSoft,
    "--green-ink": greenInk,
    "--dark": dark,
    "--dark-3": dark3,
    "--dark-ink": darkInk,
    "--dark-muted": darkMuted,
    "--dark-accent": onDark(hues.accent, TEXT),
    "--dark-amber": onDark(hues.amber, TEXT),
    "--dark-overrun": onDark(hues.overrun, TEXT),
    "--on-accent": onColour([accent], [surface, ink]),
    "--on-ink": onColour([ink, overrun], [surface, bg]),
    // The avatars keep their fixed colours (src/ui/Avatar.tsx), designed for white initials.
    "--on-avatar": WHITE,
    "--dark-strong": darkStrong,
    "--dark-3-hover": dark3Hover,
    "--disabled-ink": mix(muted, surface, 0.45),
    "--overrun-ink": overrunInk,
    "--hover-tint": `${ink}${darkGround ? "14" : "0a"}`,
    "--warn-ink": amberInk,
    "--warn-soft": amberSoft,
    "--warn-line": warnLine,
  };
  // Defence in depth: nothing but a hex colour ever leaves this function.
  for (const name of TOKEN_NAMES) if (!TOKEN_VALUE.test(tokens[name])) return null;
  return tokens;
}

/** `tokyo-night` → `Tokyo Night`; empty for an empty or invalid slug. */
export function themeDisplayName(slug: unknown): string {
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,64}$/.test(slug)) return "";
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}
