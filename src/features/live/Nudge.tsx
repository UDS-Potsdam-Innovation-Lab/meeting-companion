import { forwardRef, useId } from "react";
import { useI18n, type I18n } from "../../i18n";
import { itemNumber } from "../agenda/model";
import { MINUTE, type CurrentItem } from "./run";

/** "3 minutes left for item 02", or that less than a minute / no time is left. */
export function nudgeTitle(i18n: Pick<I18n, "t" | "tp">, current: CurrentItem): string {
  const number = itemNumber(current.index);
  if (current.remainingMs <= 0) return i18n.t("nudge.titleTimeUp", { number });
  const minutes = Math.floor(current.remainingMs / MINUTE);
  return minutes === 0
    ? i18n.t("nudge.titleUnderMinute", { number })
    : i18n.tp("nudge.title", minutes, { number });
}

interface Props {
  current: CurrentItem;
  canExtend: boolean;
  onWrapUp: () => void;
  onExtend: () => void;
}

/**
 * Frame 02 "Time nudge": a toast over the empty area right of the agenda. It is not a dialog, takes no
 * focus and blocks nothing; the live view announces it once through its polite live region.
 */
export const Nudge = forwardRef<HTMLDivElement, Props>(function Nudge(
  { current, canExtend, onWrapUp, onExtend },
  ref,
) {
  const i18n = useI18n();
  const { t } = i18n;
  const titleId = useId();
  return (
    <div className="nudge" role="group" aria-labelledby={titleId} ref={ref}>
      <span className="nudge__icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="10" cy="11" r="6.5" />
          <path d="M10 7.5V11l2 1.5M8 2.5h4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="nudge__text">
        <p className="nudge__title" id={titleId}>
          {nudgeTitle(i18n, current)}
        </p>
        <p className="nudge__body">{t("nudge.body")}</p>
      </div>
      <button type="button" className="button button--dark-ghost button--small" onClick={onWrapUp}>
        {t("nudge.wrapUp")}
      </button>
      <button
        type="button"
        className="button button--primary button--small"
        onClick={onExtend}
        disabled={!canExtend}
      >
        {t("live.extend")}
      </button>
    </div>
  );
});
