import { useId, type ReactNode } from "react";

// Shared building blocks of the settings sections (frame 14).

export function Card({
  title,
  hint,
  aside,
  children,
}: {
  title: string;
  hint?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="settings-card" aria-labelledby={id}>
      <div className="settings-card__head">
        <div className="settings-card__heading">
          <h2 className="settings-card__title" id={id}>
            {title}
          </h2>
          {hint ? <p className="settings-card__hint">{hint}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Label left, control right (wide); stacked (narrow). */
export function Row({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row__label">
        {htmlFor ? (
          <label className="settings-row__name" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <p className="settings-row__name">{label}</p>
        )}
        {hint ? <p className="settings-row__hint">{hint}</p> : null}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  lang?: string;
  extra?: ReactNode;
  preview?: ReactNode;
  /** Cannot be chosen (the hint says why). */
  disabled?: boolean;
  /** Chosen by the person but not in effect yet (waits for a confirmation below). */
  pending?: boolean;
}

/** A labelled radio group of cards. */
export function Choices<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  layout = "row",
  visibleLegend = false,
}: {
  legend: string;
  name: string;
  value: T | null;
  options: ChoiceOption<T>[];
  onChange: (v: T) => void;
  layout?: "row" | "column";
  visibleLegend?: boolean;
}) {
  const id = useId();
  return (
    <fieldset className={`choices choices--${layout}`}>
      <legend className={visibleLegend ? "choices__legend" : "visually-hidden"}>{legend}</legend>
      {options.map((o, i) => (
        <label
          key={o.value}
          className={`choice${o.value === value ? " choice--on" : ""}${o.pending ? " choice--pending" : ""}${
            o.disabled ? " choice--disabled" : ""
          }`}
          lang={o.lang}
        >
          {o.preview}
          <span className="choice__main">
            <input
              type="radio"
              className="choice__radio"
              name={name}
              value={o.value}
              checked={o.value === value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
              aria-labelledby={`${id}-${i}-label`}
              aria-describedby={`${id}-${i}-hint`}
            />
            <span className="choice__text">
              <span className="choice__label" id={`${id}-${i}-label`}>
                {o.label}
              </span>
              <span className="choice__details" id={`${id}-${i}-hint`}>
                {o.hint ? <span className="choice__hint">{o.hint}</span> : null}
                {o.extra}
              </span>
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function Notice({
  tone,
  title,
  children,
}: {
  tone: "info" | "error" | "warn";
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={`settings-notice settings-notice--${tone}`} role={tone === "info" ? undefined : "status"}>
      {/* The glyph comes from CSS; the title carries the meaning. */}
      <span className="settings-notice__icon" aria-hidden="true" />
      <div className="settings-notice__text">
        <p className="settings-notice__title">{title}</p>
        {children ? <p className="settings-notice__body">{children}</p> : null}
      </div>
    </div>
  );
}
