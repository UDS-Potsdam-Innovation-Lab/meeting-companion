import { LOCALES, useI18n, type Locale, type MessageKey } from "../i18n";
import { LogoMark, PlusIcon } from "../ui/icons";

export function TopBar({ onNewMeeting }: { onNewMeeting: () => void }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <header className="top-bar">
      <div className="top-bar__brand">
        <span className="top-bar__mark">
          <LogoMark />
        </span>
        <span className="top-bar__name">{t("app.brand")}</span>
      </div>
      <span className="top-bar__divider" aria-hidden="true" />
      <button type="button" className="button button--ghost top-bar__new" onClick={onNewMeeting}>
        <PlusIcon />
        {t("topbar.newMeeting")}
      </button>
      <span className="top-bar__spacer" />
      <div className="lang-switch" role="group" aria-label={t("topbar.language")}>
        {LOCALES.map((l: Locale) => (
          <button
            key={l}
            type="button"
            lang={l}
            className="lang-switch__option"
            aria-pressed={locale === l}
            onClick={() => setLocale(l)}
          >
            {t(`language.${l}` as MessageKey)}
          </button>
        ))}
      </div>
    </header>
  );
}
