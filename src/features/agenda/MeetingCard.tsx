import { useId, useState, type FormEvent } from "react";
import { useI18n } from "../../i18n";
import { Avatar } from "../../ui/Avatar";
import { Field, invalidProps } from "../../ui/Field";
import { CloseIcon } from "../../ui/icons";
import { errorText } from "./errors";
import {
  addParticipant,
  isValidDate,
  removeParticipant,
  validateParticipantName,
  validateTimeSlot,
  validateTitle,
  type ErrorCode,
  type Meeting,
  type TimeSlotError,
} from "./model";
import type { MeetingEdit } from "./useMeeting";

interface Props {
  meeting: Meeting;
  onChange: (edit: MeetingEdit) => boolean;
}

/**
 * Title, time slot and participants. Each field keeps what the person typed; only values that pass
 * validation reach the meeting (and so the store). Mount it with `key={meeting.id}`.
 */
export function MeetingCard({ meeting, onChange }: Props) {
  const { t, tp } = useI18n();
  const uid = useId();
  const ids = {
    title: `${uid}-title`,
    date: `${uid}-date`,
    start: `${uid}-start`,
    end: `${uid}-end`,
    participant: `${uid}-participant`,
  };

  const [title, setTitle] = useState(meeting.title);
  const [titleError, setTitleError] = useState<ErrorCode | null>(null);
  const [date, setDate] = useState(meeting.date);
  const [dateError, setDateError] = useState(false);
  const [start, setStart] = useState(meeting.start);
  const [end, setEnd] = useState(meeting.end);
  const [slotError, setSlotError] = useState<TimeSlotError | null>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<ErrorCode | null>(null);

  function changeTitle(value: string) {
    setTitle(value);
    const err = validateTitle(value);
    setTitleError(err);
    if (!err) onChange((m) => ({ ...m, title: value }));
  }

  function changeDate(value: string) {
    setDate(value);
    const ok = isValidDate(value);
    setDateError(!ok);
    if (ok) onChange((m) => ({ ...m, date: value }));
  }

  function changeSlot(nextStart: string, nextEnd: string) {
    setStart(nextStart);
    setEnd(nextEnd);
    const err = validateTimeSlot(nextStart, nextEnd);
    setSlotError(err);
    if (!err) onChange((m) => ({ ...m, start: nextStart, end: nextEnd }));
  }

  function submitParticipant(e: FormEvent) {
    e.preventDefault();
    const err = validateParticipantName(name, meeting.participants);
    setNameError(err);
    if (err) return;
    if (onChange((m) => addParticipant(m, name))) setName("");
  }

  const titleMsg = errorText(t, "title", titleError);
  const dateMsg = dateError ? errorText(t, "date", "invalid") : null;
  const startMsg = slotError?.field === "start" ? errorText(t, "time", slotError.code) : null;
  const endMsg =
    slotError?.field === "end"
      ? errorText(t, slotError.code === "notAfterStart" ? "end" : "time", slotError.code)
      : null;
  const nameMsg = errorText(t, "participant", nameError);

  return (
    <section className="card meeting-card" aria-labelledby={`${uid}-heading`}>
      <h2 className="meeting-card__heading" id={`${uid}-heading`}>
        {t("meeting.heading")}
      </h2>

      <Field id={ids.title} label={t("meeting.title")} error={titleMsg}>
        <input
          id={ids.title}
          className="input input--title"
          type="text"
          value={title}
          autoComplete="off"
          onChange={(e) => changeTitle(e.target.value)}
          {...invalidProps(ids.title, titleMsg)}
        />
      </Field>

      <div className="meeting-card__when">
        <Field id={ids.date} label={t("meeting.date")} error={dateMsg} className="field--date">
          <input
            id={ids.date}
            className="input"
            type="date"
            value={date}
            onChange={(e) => changeDate(e.target.value)}
            {...invalidProps(ids.date, dateMsg)}
          />
        </Field>
        <Field id={ids.start} label={t("meeting.start")} error={startMsg} className="field--time">
          <input
            id={ids.start}
            className="input"
            type="time"
            value={start}
            onChange={(e) => changeSlot(e.target.value, end)}
            {...invalidProps(ids.start, startMsg)}
          />
        </Field>
        <Field id={ids.end} label={t("meeting.end")} error={endMsg} className="field--time">
          <input
            id={ids.end}
            className="input"
            type="time"
            value={end}
            onChange={(e) => changeSlot(start, e.target.value)}
            {...invalidProps(ids.end, endMsg)}
          />
        </Field>
      </div>

      <div className="participants">
        <h3 className="participants__heading">
          {tp("meeting.participants.count", meeting.participants.length)}
        </h3>
        {meeting.participants.length > 0 ? (
          <ul className="participants__list">
            {meeting.participants.map((p) => (
              <li key={p.id} className="participant">
                <Avatar name={p.name} size={26} />
                <span className="participant__name">{p.name}</span>
                <button
                  type="button"
                  className="icon-button icon-button--small"
                  aria-label={t("meeting.participants.remove", { name: p.name })}
                  title={t("meeting.participants.remove", { name: p.name })}
                  onClick={() => onChange((m) => removeParticipant(m, p.id))}
                >
                  <CloseIcon />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="participants__empty">{t("meeting.participants.empty")}</p>
        )}
        <form className="participants__add" onSubmit={submitParticipant} noValidate>
          <Field id={ids.participant} label={t("meeting.participants.addLabel")} error={nameMsg}>
            <div className="participants__add-row">
              <input
                id={ids.participant}
                className="input"
                type="text"
                value={name}
                autoComplete="off"
                placeholder={t("meeting.participants.placeholder")}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(null);
                }}
                {...invalidProps(ids.participant, nameMsg)}
              />
              <button type="submit" className="button button--secondary">
                {t("meeting.participants.add")}
              </button>
            </div>
          </Field>
        </form>
      </div>
    </section>
  );
}
