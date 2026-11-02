import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LOCALE_STORAGE_KEY, useI18n } from "../../i18n";
import {
  DEFAULT_SETTINGS,
  loadOmarchyTheme,
  loadSettings,
  onOmarchyTheme,
  onSettingsChanged,
  updateSetting,
  type SettingChange,
  type Settings,
  type SettingsStatus,
} from "../../lib/ipc";
import {
  cacheOmarchy,
  readOmarchyCache,
  setOmarchyTokens,
  toApplied,
  type AppliedOmarchy,
} from "../theme/apply";
import type { OmarchyTheme } from "../theme/omarchy";
import { applyTheme, cacheTheme, readCachedTheme } from "./theme";

/** Where job 003 remembered the speech model. Moved into the settings store once, then removed. */
export const LEGACY_MODEL_STORAGE_KEY = "meeting-companion.speechModel";

export interface SettingsState {
  settings: Settings;
  /** `null` until the core answered. */
  status: SettingsStatus | null;
  storageFolder: string;
  /** The system theme right now (for "System · now dark"). */
  systemDark: boolean;
  /**
   * The Omarchy theme "System" follows (job 020): `name` for the hint, empty if unknown. `null`: no
   * Omarchy theme, "System" follows `prefers-color-scheme`.
   */
  omarchy: { name: string } | null;
  /** The last change could not be stored on this device; it holds for this session. */
  notSaved: boolean;
  /** Sends a change to the core; every view applies it from the `settings-changed` event. */
  update: (change: SettingChange) => Promise<void>;
}

const SettingsContext = createContext<SettingsState | null>(null);

function readLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Loads the settings from the core once, follows `settings-changed`, and applies locale and theme.
 * Locale and theme are cached in `localStorage` for the first paint; nothing else is.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { locale, setLocale } = useI18n();
  const [settings, setSettings] = useState<Settings>(() => ({
    ...DEFAULT_SETTINGS,
    locale,
    theme: readCachedTheme() ?? DEFAULT_SETTINGS.theme,
  }));
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [storageFolder, setStorageFolder] = useState("");
  const [notSaved, setNotSaved] = useState(false);
  const [systemDark, setSystemDark] = useState(false);
  // Until the core answers, the cached map (already applied by theme-boot.js) holds.
  const [omarchy, setOmarchy] = useState<AppliedOmarchy | null>(readOmarchyCache);
  const localeRef = useRef(setLocale);
  useEffect(() => {
    localeRef.current = setLocale;
  }, [setLocale]);

  useEffect(() => {
    let cancelled = false;
    const stop = onSettingsChanged((s) => {
      if (!cancelled) setSettings(s);
    });
    void loadSettings({
      locale: readLocalStorage(LOCALE_STORAGE_KEY),
      theme: readCachedTheme(),
      speechModel: readLocalStorage(LEGACY_MODEL_STORAGE_KEY),
    }).then((load) => {
      if (cancelled || !load) return;
      // The model choice of job 003 lives in the store from now on.
      try {
        localStorage.removeItem(LEGACY_MODEL_STORAGE_KEY);
      } catch {
        // Nothing to remove.
      }
      setSettings(load.settings);
      setStatus(load.status);
      setStorageFolder(load.storageFolder);
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  // The Omarchy theme: what the core holds now, then every switch. Each report replaces the cache.
  useEffect(() => {
    let cancelled = false;
    let switched = false;
    const report = (theme: OmarchyTheme | null) => {
      const next = toApplied(theme);
      cacheOmarchy(next);
      setOmarchy(next);
    };
    const stop = onOmarchyTheme((theme) => {
      if (cancelled) return;
      switched = true;
      report(theme);
    });
    void loadOmarchyTheme().then((answer) => {
      // An event that came first is newer than this answer.
      if (!cancelled && !switched && answer) report(answer.theme);
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  // Locale and theme follow the settings, wherever they were changed.
  useEffect(() => {
    localeRef.current(settings.locale);
  }, [settings.locale]);
  useEffect(() => {
    cacheTheme(settings.theme);
  }, [settings.theme]);
  // Before the paint, so tokens and `data-theme` change in the same frame.
  const following = settings.theme === "system" ? omarchy : null;
  useLayoutEffect(() => {
    if (following) {
      setOmarchyTokens(following.tokens);
      document.documentElement.dataset.theme = following.mode;
      return;
    }
    setOmarchyTokens(null);
    return applyTheme(settings.theme, setSystemDark);
  }, [settings.theme, following]);

  const update = useCallback(async (change: SettingChange) => {
    // Shown at once; the core's answer (and its event) confirms or corrects it.
    setSettings((s) => ({ ...s, [change.key]: change.value }));
    try {
      const result = await updateSetting(change);
      setSettings(result.settings);
      setNotSaved(!result.saved);
    } catch {
      // Refused (e.g. the device was unplugged meanwhile): back to what the core holds.
      const load = await loadSettings({});
      if (load) setSettings(load.settings);
    }
  }, []);

  const omarchyName = omarchy?.name ?? null;
  const omarchyHint = useMemo(() => (omarchyName === null ? null : { name: omarchyName }), [omarchyName]);
  const value = useMemo<SettingsState>(
    () => ({ settings, status, storageFolder, systemDark, omarchy: omarchyHint, notSaved, update }),
    [settings, status, storageFolder, systemDark, omarchyHint, notSaved, update],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
