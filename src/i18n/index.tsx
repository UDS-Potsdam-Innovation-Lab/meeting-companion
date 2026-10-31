import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import de from "./de.json";
import en from "./en.json";

export type Locale = "de" | "en";
export const LOCALES: readonly Locale[] = ["de", "en"];
export const DEFAULT_LOCALE: Locale = "de";
export const LOCALE_STORAGE_KEY = "meeting-companion.locale";

export type MessageKey = keyof typeof de;
type Params = Record<string, string | number>;

export const messages: Record<Locale, Record<MessageKey, string>> = { de, en };

function format(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

export interface I18n {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: Params) => string;
  /** Picks `<key>.one` or `<key>.other` by the plural rules of the locale; `{count}` is filled in. */
  tp: (key: string, count: number, params?: Params) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return LOCALES.includes(stored as Locale) ? (stored as Locale) : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

interface ProviderProps {
  children: ReactNode;
  /** Test aid: every string renders as `⟦key⟧`, so text that bypasses the catalogue stands out. */
  keyMode?: boolean;
  /** A locale chosen by the caller (the phone page follows the phone); nothing is read from storage. */
  fixedLocale?: Locale;
}

export function I18nProvider({ children, keyMode = false, fixedLocale }: ProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => fixedLocale ?? readStoredLocale());

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable; the switch still works for this session.
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const dict = messages[locale];
    const t = (key: MessageKey, params?: Params) => (keyMode ? `⟦${key}⟧` : format(dict[key], params));
    const plural = new Intl.PluralRules(locale);
    const tp = (key: string, count: number, params?: Params) => {
      const exact = `${key}.${plural.select(count)}` as MessageKey;
      const resolved = exact in dict ? exact : (`${key}.other` as MessageKey);
      return t(resolved, { count, ...params });
    };
    return { locale, setLocale, t, tp };
  }, [locale, setLocale, keyMode]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
