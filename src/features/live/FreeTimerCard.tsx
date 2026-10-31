import { useI18n } from "../../i18n";
import { formatClock } from "../../lib/time";
import type { FreeSnapshot } from "./free";

/**
 * Frame 16 "whole-meeting timer": the dark card of an agenda-free meeting. The slot label shows the
 * scheduled length; the big number is whole minutes left, or, once the scheduled end has passed, the
 * minutes over, said in words as well as in the overrun colour.
 */
export function FreeTimerCard({ snapshot }: { snapshot: FreeSnapshot }) {
  const { t, locale } = useI18n();
  const time = formatClock(locale, snapshot.scheduledEnd);
  const percent = Math.round(snapshot.fraction * 100);
  const { over } = snapshot;
  return (
    <section
      className={`timer-card timer-card--free${over ? " timer-card--over" : ""}`}
      aria-label={t("free.timer.label")}
    >
      <p className="timer-card__eyebrow">{t("free.timer.eyebrow", { slot: snapshot.slotMinutes })}</p>
      <p className="timer-card__time" data-over={over}>
        <span className="timer-card__clock">{over ? snapshot.minutesOver : snapshot.minutesLeft}</span>
        <span className="timer-card__of">
          {over ? t("free.timer.over", { time }) : t("free.timer.left", { time })}
        </span>
      </p>
      <div
        className="timer-card__bar"
        role="progressbar"
        aria-label={t("live.timer.progress")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={t("free.timer.progressText", { percent })}
      >
        <span className="timer-card__fill" style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}
