import { useId } from "react";
import { useI18n, type MessageKey } from "../../i18n";

export type StartBlocker = "locked" | "invalid" | "noItems";

interface Props {
  /** Why the meeting cannot start yet, or null when it can. */
  blocker: StartBlocker | null;
  onStart: () => void;
}

/**
 * "Start meeting" at the bottom of frame 01's right column. While it cannot start, it stays focusable
 * (`aria-disabled`) and the reason is shown under it and tied to it, so keyboard and screen reader
 * users learn why.
 */
export function StartMeeting({ blocker, onStart }: Props) {
  const { t } = useI18n();
  const reasonId = useId();
  return (
    <div className="start-meeting">
      <button
        type="button"
        className="button button--primary button--start"
        aria-disabled={blocker !== null}
        aria-describedby={blocker ? reasonId : undefined}
        onClick={() => {
          if (!blocker) onStart();
        }}
      >
        <span className="button--start__dot" aria-hidden="true" />
        {t("start.button")}
      </button>
      {blocker ? (
        <p className="start-meeting__reason" id={reasonId}>
          {t(`start.reason.${blocker}` as MessageKey)}
        </p>
      ) : null}
    </div>
  );
}
