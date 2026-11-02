import { useId, useState } from "react";
import { useI18n, type I18n, type MessageKey } from "../../i18n";
import { CAPTURE_KINDS } from "../../lib/ipc";
import type { KindCounts } from "../captures/model";
import type { LiveRow, LiveSnapshot } from "./run";

/** "1 decision · 2 to-dos": the captures of an item or topic, kinds with none left out. */
export function captureSummary(i18n: I18n, counts: KindCounts | undefined): string {
  if (!counts) return "";
  return CAPTURE_KINDS.filter((k) => counts[k] > 0)
    .map((k) => i18n.tp(`captures.count.${k}`, counts[k]))
    .join(" · ");
}

/**
 * Frame 02 "Agenda list" with the "Parking lot" row. State is shown by an icon and by text; each row
 * also says what was captured for it (job 018).
 */
export function LiveAgenda({
  snapshot,
  counts,
}: {
  snapshot: LiveSnapshot;
  counts?: ReadonlyMap<string, KindCounts>;
}) {
  const { t } = useI18n();
  return (
    <section className="card live-agenda" aria-labelledby="live-agenda-heading">
      <h2 id="live-agenda-heading" className="visually-hidden">
        {t("live.agenda.heading")}
      </h2>
      <ol className="live-agenda__items">
        {snapshot.rows.map((row) => (
          <Row key={row.item.id} row={row} counts={counts?.get(row.item.id)} />
        ))}
      </ol>
      <ParkingLot parked={snapshot.parked} />
    </section>
  );
}

function Row({ row, counts }: { row: LiveRow; counts?: KindCounts }) {
  const i18n = useI18n();
  const { t } = i18n;
  const summary = captureSummary(i18n, counts);
  const captured = summary ? ` · ${summary}` : "";
  let meta: string;
  if (row.state === "upcoming") meta = t("live.row.minutes", { minutes: row.plannedMinutes });
  else if (row.state === "parked") meta = t("live.row.parkedAfter", { minutes: row.actualMinutes ?? 0 });
  else meta = t("live.row.ofMinutes", { actual: row.actualMinutes ?? 0, planned: row.plannedMinutes });
  const over = row.state === "done" && row.over;
  return (
    <li
      className={`live-row live-row--${row.state}`}
      aria-current={row.state === "now" ? "step" : undefined}
      data-state={row.state}
    >
      <StateIcon row={row} />
      <span className="live-row__text">
        <span className="visually-hidden">{t(`live.row.${row.state}` as MessageKey)} </span>
        <span className="live-row__title">{row.item.title}</span>
        <span className={`live-row__meta${over ? " live-row__meta--over" : ""}`} data-over={over}>
          {meta}
          {captured ? <span className="live-row__captured">{captured}</span> : null}
        </span>
      </span>
    </li>
  );
}

function StateIcon({ row }: { row: LiveRow }) {
  switch (row.state) {
    case "done":
      return (
        <span className="live-row__icon" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2.5 6.5l2.2 2.2L9.5 3.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      );
    case "now":
      return (
        <span className="live-row__icon" aria-hidden="true">
          <span className="live-row__dot" />
        </span>
      );
    case "parked":
      return <ParkingGlyph className="live-row__icon" />;
    default:
      return (
        <span className="live-row__icon" aria-hidden="true">
          {row.index + 1}
        </span>
      );
  }
}

function ParkingGlyph({ className }: { className: string }) {
  return (
    <span className={`${className} parking-glyph`} aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
        <path d="M3 1.5h3.4a2.6 2.6 0 0 1 0 5.2H4.6v3.8H3zm1.6 1.5v2.2h1.8a1.1 1.1 0 0 0 0-2.2z" />
      </svg>
    </span>
  );
}

function ParkingLot({ parked }: { parked: LiveRow[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="parking-lot">
      <button
        type="button"
        className="parking-lot__toggle"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen(!open)}
      >
        <ParkingGlyph className="parking-lot__glyph" />
        <span className="parking-lot__title">{t("live.parking.title")}</span>
        <span className="parking-lot__count">{parked.length}</span>
      </button>
      {open ? (
        parked.length > 0 ? (
          <ul className="parking-lot__list" id={listId} aria-label={t("live.parking.title")}>
            {parked.map((row) => (
              <li key={row.item.id} className="parking-lot__item">
                <span className="parking-lot__item-title">{row.item.title}</span>
                <span className="parking-lot__item-minutes">
                  {t("live.parking.minutes", { minutes: row.actualMinutes ?? 0 })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="parking-lot__empty" id={listId}>
            {t("live.parking.empty")}
          </p>
        )
      ) : null}
    </div>
  );
}

/**
 * Frame 02 "Overall": "Meeting ends HH:MM" and the projection. While on track it says how much of the
 * buffer is used, so it agrees with an item timer that runs over; otherwise how far behind it is.
 */
export function OverallLine({ snapshot }: { snapshot: LiveSnapshot }) {
  const { t, locale } = useI18n();
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(snapshot.scheduledEnd),
  );
  const { onTrack, minutes } = snapshot.schedule;
  const used = snapshot.bufferUsedMinutes ?? 0;
  let status: string;
  if (!onTrack) status = t("live.overall.behind", { minutes });
  else if (used > 0) status = t("live.overall.bufferUsed", { minutes: used });
  else status = t("live.overall.bufferLeft", { minutes });
  return (
    <p className="overall" data-on-track={onTrack}>
      <span className="overall__ends">{t("live.overall.ends", { time })}</span>
      <span className={`overall__status overall__status--${onTrack ? "ok" : "behind"}`}>{status}</span>
    </p>
  );
}
