import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { Field, invalidProps } from "../../ui/Field";
import { errorText } from "./errors";
import {
  GOALS,
  LIMITS,
  hasErrors,
  validateItem,
  type AgendaItem,
  type Goal,
  type ItemErrors,
  type Participant,
} from "./model";

interface Props {
  id: string;
  item: AgendaItem;
  participants: readonly Participant[];
  /** Called with every valid version of the item. */
  onCommit: (item: AgendaItem) => void;
  onDone: () => void;
}

/** Inline editor for one agenda item. Invalid input stays in the form with a message; nothing is saved. */
export function ItemEditor({ id, item, participants, onCommit, onDone }: Props) {
  const { t } = useI18n();
  const uid = useId();
  const ids = {
    title: `${uid}-title`,
    outcome: `${uid}-outcome`,
    lead: `${uid}-lead`,
    minutes: `${uid}-minutes`,
  };
  const [draft, setDraft] = useState(item);
  const [minutesText, setMinutesText] = useState(String(item.minutes));
  const [errors, setErrors] = useState<ItemErrors>({});
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // A lead who was removed from the meeting no longer counts.
  const lead = draft.lead && participants.some((p) => p.id === draft.lead) ? draft.lead : null;

  function change(patch: Partial<AgendaItem>) {
    const next = { ...draft, lead, ...patch };
    setDraft(next);
    const errs = validateItem(next);
    setErrors(errs);
    if (!hasErrors(errs)) onCommit(next);
  }

  function changeMinutes(text: string) {
    setMinutesText(text);
    change({ minutes: /^\d{1,4}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN });
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onDone();
    }
  }

  const titleMsg = errorText(t, "itemTitle", errors.title);
  const outcomeMsg = errorText(t, "outcome", errors.outcome);
  const minutesMsg = errorText(t, "minutes", errors.minutes);

  return (
    <div id={id} className="item-editor" role="group" aria-label={t("editor.label")} onKeyDown={onKeyDown}>
      <Field id={ids.title} label={t("editor.title")} error={titleMsg} className="item-editor__wide">
        <input
          ref={titleRef}
          id={ids.title}
          className="input"
          type="text"
          value={draft.title}
          autoComplete="off"
          placeholder={t("editor.titlePlaceholder")}
          onChange={(e) => change({ title: e.target.value })}
          {...invalidProps(ids.title, titleMsg)}
        />
      </Field>
      <Field id={ids.outcome} label={t("editor.outcome")} error={outcomeMsg} className="item-editor__wide">
        <input
          id={ids.outcome}
          className="input"
          type="text"
          value={draft.outcome}
          autoComplete="off"
          placeholder={t("editor.outcomePlaceholder")}
          onChange={(e) => change({ outcome: e.target.value })}
          {...invalidProps(ids.outcome, outcomeMsg)}
        />
      </Field>
      <Field id={ids.lead} label={t("editor.lead")}>
        <select
          id={ids.lead}
          className="input select"
          value={lead ?? ""}
          onChange={(e) => change({ lead: e.target.value || null })}
          aria-describedby={participants.length === 0 ? `${ids.lead}-hint` : undefined}
        >
          <option value="">{t("editor.leadNone")}</option>
          {participants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {participants.length === 0 ? (
          <p className="field__hint" id={`${ids.lead}-hint`}>
            {t("editor.leadHint")}
          </p>
        ) : null}
      </Field>
      <fieldset className="field goal-picker">
        <legend className="field__label">{t("editor.goal")}</legend>
        <div className="goal-picker__options">
          {GOALS.map((g: Goal) => (
            <label key={g} className={`goal-option goal-option--${g}`}>
              <input
                type="radio"
                name={`${uid}-goal`}
                value={g}
                checked={draft.goal === g}
                onChange={() => change({ goal: g })}
              />
              <span>{t(`goal.${g}` as MessageKey)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field id={ids.minutes} label={t("editor.minutes")} error={minutesMsg} className="field--minutes">
        <input
          id={ids.minutes}
          className="input"
          type="number"
          inputMode="numeric"
          min={LIMITS.minutesMin}
          max={LIMITS.minutesMax}
          step={1}
          value={minutesText}
          onChange={(e) => changeMinutes(e.target.value)}
          {...invalidProps(ids.minutes, minutesMsg)}
        />
      </Field>
      <div className="item-editor__actions">
        <button type="button" className="button button--primary" onClick={onDone}>
          {t("editor.done")}
        </button>
      </div>
    </div>
  );
}
