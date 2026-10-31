import type { ReactNode } from "react";
import { LOCALES, useI18n, type Locale, type MessageKey } from "../i18n";
import { useSettings } from "../features/settings/useSettings";
import { BackIcon, GearIcon, LogoMark, PlusIcon } from "../ui/icons";

interface Props {
  /** Setup: the "New meeting" button. */
  onNewMeeting?: () => void;
  /** Live meeting: the meeting title next to the brand. */
  meetingTitle?: string;
  /** Live meeting: recording indicator and controls, before the language switch. */
  actions?: ReactNode;
  /** Opens the settings view; the "Settings" button after the language switch. */
  onOpenSettings?: () => void;
  /** The settings view is open: the button shows it, and "Back" returns. */
  settingsOpen?: boolean;
  onBack?: () => void;
  backLabel?: string;
}

/** The attribute focus returns to when the settings view closes. */
export const SETTINGS_BUTTON = "data-settings-button";

export function TopBar({
  onNewMeeting,
  meetingTitle,
  actions,
  onOpenSettings,
  settingsOpen = false,
  onBack,
  backLabel,
}: Props) {
  const { t, locale } = useI18n();
  const { update } = useSettings();
  // The same setting as "App language" in the settings.
  const setLocale = (l: Locale) => void update({ key: "locale", value: l });
  return (
    <header className="top-bar">
      <div className="top-bar__brand">
        <span className="top-bar__mark">
          <LogoMark />
        </span>
        <span className="top-bar__name">{t("app.brand")}</span>
      </div>
      <span className="top-bar__divider" aria-hidden="true" />
      {onNewMeeting ? (
        <button type="button" className="button button--ghost top-bar__new" onClick={onNewMeeting}>
          <PlusIcon />
          {t("topbar.newMeeting")}
        </button>
      ) : null}
      {meetingTitle !== undefined ? <span className="top-bar__title">{meetingTitle}</span> : null}
      <span className="top-bar__spacer" />
      {actions}
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
      {onOpenSettings ? (
        <button
          type="button"
          className={`button button--outline top-bar__settings${settingsOpen ? " top-bar__settings--open" : ""}`}
          onClick={onOpenSettings}
          aria-current={settingsOpen ? "page" : undefined}
          aria-keyshortcuts="Control+Comma Meta+Comma"
          {...{ [SETTINGS_BUTTON]: "" }}
        >
          <GearIcon />
          <span className="top-bar__settings-label">{t("settings.open")}</span>
        </button>
      ) : null}
      {onBack ? (
        <button type="button" className="button button--dark top-bar__back" onClick={onBack}>
          <BackIcon />
          {backLabel}
        </button>
      ) : null}
    </header>
  );
}
