import { useI18n, type MessageKey } from "../../i18n";
import { CheckIcon } from "../../ui/icons";
import { MODES, type MeetingMode } from "./model";

interface Props {
  mode: MeetingMode;
  onChange: (mode: MeetingMode) => void;
}

/**
 * Frame 01 / 16a: "With agenda / Agenda-free" next to "Step 1 of 2". Two toggle buttons in a group; the
 * pressed one has a tick and `aria-pressed`, so the state does not rely on colour.
 */
export function ModeSwitch({ mode, onChange }: Props) {
  const { t } = useI18n();
  return (
    <div className="mode-switch" role="group" aria-label={t("setup.mode.label")}>
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          className="mode-switch__option"
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
        >
          {mode === m ? <CheckIcon /> : null}
          {t(`setup.mode.${m}` as MessageKey)}
        </button>
      ))}
    </div>
  );
}
