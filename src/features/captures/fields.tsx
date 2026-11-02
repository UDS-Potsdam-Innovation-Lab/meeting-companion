// The kind buttons, owner chips and date chips of the composer and the inline editors (job 018).
import { useId, useState } from "react";
import { useI18n } from "../../i18n";
import { useClock } from "../../lib/clock";
import type { CaptureType } from "../../lib/ipc";
import { CAPTURE_KINDS } from "../../lib/ipc";
import { Avatar } from "../../ui/Avatar";
import { CheckIcon } from "../../ui/icons";
import type { Participant } from "../agenda/model";
import { formatDue, KIND_KEYS } from "./labels";
import { chipNames, dueDates, OWNER_CHIPS, type DueChoice } from "./model";

// ---- kind buttons, owners and dates (composer and editor) ----------------------------------------------

export function KindButtons({
  kind,
  onKind,
  label,
}: {
  kind: CaptureType;
  onKind: (k: CaptureType) => void;
  label: string;
}) {
  const { t } = useI18n();
  return (
    <div className="kind-buttons" role="group" aria-label={label}>
      {CAPTURE_KINDS.map((k) => (
        <button
          key={k}
          type="button"
          className={`kind-button kind-button--${k}`}
          aria-pressed={k === kind}
          onClick={() => onKind(k)}
        >
          <span className="kind-button__dot" aria-hidden="true" />
          {t(KIND_KEYS[k])}
        </button>
      ))}
    </div>
  );
}

export function OwnerChips({
  people,
  owner,
  onOwner,
}: {
  people: readonly Participant[];
  owner: string | null;
  onOwner: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const labelId = useId();
  const [more, setMore] = useState(false);
  const names = chipNames(people);
  // The chosen person stays visible even when they are past the first six.
  const shown = more ? people : people.filter((p, i) => i < OWNER_CHIPS || p.id === owner);
  const hidden = people.length - shown.length;
  return (
    <div className="chip-row">
      <span className="chip-row__label" id={labelId}>
        {t("captures.owner")}
      </span>
      <div className="chip-row__chips" role="group" aria-labelledby={labelId}>
        {shown.map((p) => (
          <button
            key={p.id}
            type="button"
            className="chip chip--person"
            aria-pressed={owner === p.id}
            onClick={() => onOwner(owner === p.id ? null : p.id)}
          >
            <Avatar name={p.name} size={20} />
            {/* The first name, or the full name where first names repeat (chipNames). */}
            <span>{names.get(p.id)}</span>
          </button>
        ))}
        {hidden > 0 ? (
          <button type="button" className="chip" onClick={() => setMore(true)}>
            {t("captures.owner.more", { count: hidden })}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function DueChips({ due, onDue }: { due: string | null; onDue: (d: string | null) => void }) {
  const { t, locale } = useI18n();
  const clock = useClock();
  const labelId = useId();
  const dateId = useId();
  const dates = dueDates(clock.now());
  const [picking, setPicking] = useState(false);
  const choices: [DueChoice, string][] = [
    ["today", t("captures.due.today")],
    ["tomorrow", t("captures.due.tomorrow")],
    ["friday", formatDue(dates.friday, locale)],
  ];
  const other = due !== null && !Object.values(dates).includes(due);
  return (
    <div className="chip-row">
      <span className="chip-row__label" id={labelId}>
        {t("captures.due")}
      </span>
      <div className="chip-row__chips" role="group" aria-labelledby={labelId}>
        {choices.map(([choice, label]) => {
          const on = due === dates[choice];
          return (
            <button
              key={choice}
              type="button"
              className="chip"
              aria-pressed={on}
              onClick={() => onDue(on ? null : dates[choice])}
            >
              {on ? <CheckIcon /> : null}
              {label}
            </button>
          );
        })}
        {other ? (
          <button type="button" className="chip" aria-pressed="true" onClick={() => onDue(null)}>
            <CheckIcon />
            {formatDue(due, locale)}
          </button>
        ) : null}
        {picking ? (
          <span className="chip-date">
            <label className="visually-hidden" htmlFor={dateId}>
              {t("captures.due.pick")}
            </label>
            <input
              id={dateId}
              className="input chip-date__input"
              type="date"
              value={due ?? ""}
              onChange={(e) => onDue(e.target.value || null)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setPicking(false);
                }
              }}
            />
          </span>
        ) : (
          <button type="button" className="chip" onClick={() => setPicking(true)}>
            {t("captures.due.other")}
          </button>
        )}
      </div>
    </div>
  );
}
