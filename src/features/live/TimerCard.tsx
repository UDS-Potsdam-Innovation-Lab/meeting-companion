import { forwardRef } from "react";
import { useI18n } from "../../i18n";
import { itemNumber } from "../agenda/model";
import { WARN_AT, formatSeconds, timerText, type CurrentItem } from "./run";

interface Props {
  current: CurrentItem | null;
  canExtend: boolean;
  onExtend: () => void;
  onPark: () => void;
  onNext: () => void;
}

/**
 * Frame 02 "Current item timer": the dark card. Once every item has ended it says the agenda is done;
 * the ref points at that heading so focus can move there when the last item ends.
 */
export const TimerCard = forwardRef<HTMLHeadingElement, Props>(function TimerCard(
  { current, canExtend, onExtend, onPark, onNext },
  doneRef,
) {
  const { t } = useI18n();

  if (!current) {
    return (
      <section className="timer-card timer-card--done" aria-labelledby="timer-card-done">
        <h2 className="timer-card__title" id="timer-card-done" ref={doneRef} tabIndex={-1}>
          {t("live.done.title")}
        </h2>
        <p className="timer-card__body">{t("live.done.body")}</p>
      </section>
    );
  }

  const budget = formatSeconds(Math.round(current.budgetMs / 1000));
  const timer = timerText(current.remainingMs);
  const percent = Math.min(100, Math.round(current.fraction * 100));
  const tone = timer.over ? "over" : current.fraction >= WARN_AT ? "warn" : "early";

  return (
    <section className={`timer-card timer-card--${tone}`} aria-label={t("live.timer.label")}>
      <p className="timer-card__eyebrow">{t("live.timer.now", { number: itemNumber(current.index) })}</p>
      <h2 className="timer-card__title">{current.item.title}</h2>
      <p className="timer-card__time" data-over={timer.over}>
        <span className="timer-card__clock">{timer.text}</span>
        <span className="timer-card__of">
          {timer.over ? t("live.timer.over", { budget }) : t("live.timer.leftOf", { budget })}
        </span>
      </p>
      <div
        className="timer-card__bar"
        role="progressbar"
        aria-label={t("live.timer.progress")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={t("live.timer.progressText", { percent, budget })}
      >
        <span className="timer-card__fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="timer-card__actions">
        <button type="button" className="button button--dark-ghost" onClick={onExtend} disabled={!canExtend}>
          {t("live.extend")}
        </button>
        <button type="button" className="button button--dark-ghost" onClick={onPark}>
          {t("live.park")}
        </button>
        <button type="button" className="button button--primary" data-action="next" onClick={onNext}>
          {t("live.next")}
        </button>
      </div>
    </section>
  );
});
