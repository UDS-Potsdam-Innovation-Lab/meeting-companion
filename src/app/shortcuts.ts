import type { MessageKey } from "../i18n";

/**
 * The keyboard shortcut registry. Every key the app binds is matched here and nowhere else
 * (`matches` and `tabTarget`), and the "Keyboard shortcuts" list in Help is generated from
 * `SHORTCUTS`. `shortcuts.test.ts` fails when a component compares keys itself, when a bound
 * shortcut is missing from the list, or when a listed one is not bound.
 */

/** The parts of a keyboard event a match needs (DOM and React events both have them). */
export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Shortcuts the app binds itself. */
export type BoundShortcut = "openSettings" | "back" | "moveTabs";
/** Keys the web view handles for every page; listed so people find them, bound by nobody here. */
export type NativeShortcut = "nextControl" | "confirm";
export type ShortcutId = BoundShortcut | NativeShortcut;

export interface Shortcut {
  id: ShortcutId;
  /** The key caps shown, each a message key (key names differ by language: Strg, Pos1). */
  keys: readonly MessageKey[];
  label: MessageKey;
  /** Where it works. */
  where: MessageKey;
  /** Handled by the web view, not by the app. */
  native: boolean;
}

export const SHORTCUTS: readonly Shortcut[] = [
  {
    id: "openSettings",
    keys: ["key.ctrl", "key.comma"],
    label: "shortcut.openSettings",
    where: "shortcut.openSettings.where",
    native: false,
  },
  {
    id: "back",
    keys: ["key.esc"],
    label: "shortcut.back",
    where: "shortcut.back.where",
    native: false,
  },
  {
    id: "moveTabs",
    keys: ["key.left", "key.right", "key.up", "key.down", "key.home", "key.end"],
    label: "shortcut.moveTabs",
    where: "shortcut.moveTabs.where",
    native: false,
  },
  {
    id: "nextControl",
    keys: ["key.tab"],
    label: "shortcut.nextControl",
    where: "shortcut.everywhere",
    native: true,
  },
  {
    id: "confirm",
    keys: ["key.enter"],
    label: "shortcut.confirm",
    where: "shortcut.everywhere",
    native: true,
  },
];

const noModifier = (e: KeyLike) => !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;

const MATCHERS: Record<Exclude<BoundShortcut, "moveTabs">, (e: KeyLike) => boolean> = {
  // Ctrl+, (Cmd+, on macOS). `code` covers layouts where the comma needs a modifier.
  openSettings: (e) =>
    (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "," || e.code === "Comma"),
  // Escape: back from Settings or Help & legal, or cancel the edit that has focus.
  back: (e) => e.key === "Escape",
};

/** Whether `e` is the shortcut `id`. */
export function matches(id: Exclude<BoundShortcut, "moveTabs">, e: KeyLike): boolean {
  return MATCHERS[id](e);
}

/**
 * The "moveTabs" shortcut for a tab list: the tab that arrow keys (with wrap-around), Home or End
 * move to from `current`, or null for any other key.
 */
export function tabTarget<T>(e: KeyLike, items: readonly T[], current: T): T | null {
  if (!noModifier(e) || items.length === 0) return null;
  const i = Math.max(0, items.indexOf(current));
  const n = items.length;
  switch (e.key) {
    case "ArrowDown":
    case "ArrowRight":
      return items[(i + 1) % n]!;
    case "ArrowUp":
    case "ArrowLeft":
      return items[(i + n - 1) % n]!;
    case "Home":
      return items[0]!;
    case "End":
      return items[n - 1]!;
    default:
      return null;
  }
}

/** `aria-keyshortcuts` of the Settings button. */
export const OPEN_SETTINGS_ARIA = "Control+Comma Meta+Comma";
