import type { ComponentType } from "react";
import { SHORTCUTS } from "../../app/shortcuts";
import { useI18n, type MessageKey } from "../../i18n";
import {
  GearIcon,
  ListIcon,
  PersonIcon,
  RecordIcon,
  StopIcon,
  StopwatchIcon,
  WaveIcon,
} from "../../ui/icons";
import type { Section as SettingsSection } from "../settings/SettingsView";
import { HelpCard } from "./HelpCard";

const HOW: { key: string; Icon: ComponentType }[] = [
  { key: "agenda", Icon: ListIcon },
  { key: "free", Icon: StopwatchIcon },
  { key: "consent", Icon: RecordIcon },
  { key: "speakers", Icon: PersonIcon },
  { key: "wave", Icon: WaveIcon },
  { key: "end", Icon: StopIcon },
];

/**
 * Troubleshooting entries and the settings section each opens: the microphone is under Audio, both
 * model pickers under "On this device".
 */
export const TROUBLE: { key: string; tone: "error" | "warn"; section: SettingsSection }[] = [
  { key: "mic", tone: "error", section: "audio" },
  { key: "speech", tone: "warn", section: "device" },
  { key: "speaker", tone: "warn", section: "device" },
];

/** The "Help" tab (frames 19, 19b): how a meeting works, keyboard shortcuts, troubleshooting. */
export function HelpContent({ onOpenSettingsAt }: { onOpenSettingsAt: (s: SettingsSection) => void }) {
  const { t } = useI18n();
  return (
    <>
      <HelpCard id="how-it-works" title={t("help.how.title")}>
        <ul className="how-list">
          {HOW.map(({ key, Icon }) => (
            <li key={key} className="how-item">
              <span className="how-item__icon" aria-hidden="true">
                <Icon />
              </span>
              <div className="how-item__text">
                <h3 className="how-item__title">{t(`help.how.${key}.title` as MessageKey)}</h3>
                <p className="how-item__body">{t(`help.how.${key}.body` as MessageKey)}</p>
              </div>
            </li>
          ))}
        </ul>
      </HelpCard>

      <HelpCard id="shortcuts" title={t("help.shortcuts.title")} sub={t("help.shortcuts.intro")}>
        <ul className="shortcut-list">
          {SHORTCUTS.map((s) => (
            <li key={s.id} className="shortcut" data-shortcut={s.id}>
              <span className="shortcut__keys">
                {s.keys.map((k) => (
                  <kbd key={k} className="key">
                    {t(k)}
                  </kbd>
                ))}
              </span>
              <span className="shortcut__text">
                <span className="shortcut__label">{t(s.label)}</span>
                <span className="shortcut__where">{t(s.where)}</span>
              </span>
            </li>
          ))}
        </ul>
      </HelpCard>

      <HelpCard id="troubleshooting" title={t("help.trouble.title")}>
        <ul className="trouble-list">
          {TROUBLE.map(({ key, tone, section }) => (
            <li key={key} className={`trouble trouble--${tone}`} data-trouble={key}>
              <span className="trouble__icon" aria-hidden="true" />
              <div className="trouble__text">
                <h3 className="trouble__title" id={`trouble-${key}-title`}>
                  {t(`help.trouble.${key}.title` as MessageKey)}
                </h3>
                <p className="trouble__body">{t(`help.trouble.${key}.body` as MessageKey)}</p>
                <button
                  type="button"
                  className="button button--outline trouble__action"
                  aria-describedby={`trouble-${key}-title`}
                  onClick={() => onOpenSettingsAt(section)}
                >
                  <GearIcon />
                  {t(`help.trouble.${key}.action` as MessageKey)}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </HelpCard>
    </>
  );
}
