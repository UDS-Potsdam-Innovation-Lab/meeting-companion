import { forwardRef, useId } from "react";
import { useI18n, type I18n } from "../../i18n";
import { formatClock } from "../../lib/time";
import type { FreeSnapshot } from "./free";

/** "Half the time is gone", "N min left, ends HH:MM", and both as sentences for the live region. */
export function halfTimeText(i18n: Pick<I18n, "t" | "locale">, snapshot: FreeSnapshot) {
  const params = { minutes: snapshot.minutesLeft, time: formatClock(i18n.locale, snapshot.scheduledEnd) };
  return {
    title: i18n.t("half.title"),
    body: i18n.t("half.body", params),
    announcement: i18n.t("half.announcement", params),
  };
}

interface Props {
  snapshot: FreeSnapshot;
  onDismiss: () => void;
}

/**
 * The half-time nudge of an agenda-free meeting, in frame 02's toast pattern: not a dialog, takes no
 * focus, blocks nothing; the live view announces it once through its polite live region. Timer logic,
 * not AI output.
 */
export const HalfTimeNudge = forwardRef<HTMLDivElement, Props>(function HalfTimeNudge(
  { snapshot, onDismiss },
  ref,
) {
  const i18n = useI18n();
  const titleId = useId();
  const { title, body } = halfTimeText(i18n, snapshot);
  return (
    <div className="nudge" role="group" aria-labelledby={titleId} ref={ref} data-testid="half-time-nudge">
      <span className="nudge__icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="10" cy="11" r="6.5" />
          <path d="M10 7.5V11l2 1.5M8 2.5h4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="nudge__text">
        <p className="nudge__title" id={titleId}>
          {title}
        </p>
        <p className="nudge__body">{body}</p>
      </div>
      <button type="button" className="button button--dark-ghost button--small" onClick={onDismiss}>
        {i18n.t("half.dismiss")}
      </button>
    </div>
  );
});
