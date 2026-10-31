import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import type { GuestNameCode, SpeakerError } from "../../lib/ipc";
import { matches } from "../../app/shortcuts";

/** Longest guest name (as in the core). */
export const GUEST_NAME_MAX = 80;

interface Props {
  /** Adds the guest and uses them; rejects with the core's {@link SpeakerError}. */
  onAdd: (name: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * The inline guest name input of "Add guest…": 1–80 characters, trimmed. The name is rendered as text
 * wherever it shows. Focus starts in the input; Escape cancels.
 */
export function GuestForm({ onAdd, onCancel }: Props) {
  const { t } = useI18n();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<GuestNameCode | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => input.current?.focus(), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") return setError("empty");
    if (Array.from(trimmed).length > GUEST_NAME_MAX) return setError("tooLong");
    setBusy(true);
    try {
      await onAdd(trimmed);
    } catch (err) {
      const e2 = err as SpeakerError;
      setError(e2.kind === "invalidName" ? e2.code : null);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (matches("back", e)) {
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <form className="guest-form" onSubmit={(e) => void submit(e)} onKeyDown={onKeyDown}>
      <label className="guest-form__label" htmlFor={`${id}-name`}>
        {t("speakers.guest.label")}
      </label>
      <div className="guest-form__row">
        <input
          ref={input}
          id={`${id}-name`}
          className="guest-form__input"
          value={name}
          maxLength={GUEST_NAME_MAX + 20}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
        <button type="submit" className="button button--primary button--small" disabled={busy}>
          {t("speakers.guest.add")}
        </button>
        <button type="button" className="button button--outline button--small" onClick={onCancel}>
          {t("speakers.guest.cancel")}
        </button>
      </div>
      {error ? (
        <p className="guest-form__error" id={`${id}-error`} role="alert">
          {t(`speakers.guest.error.${error}` as MessageKey)}
        </p>
      ) : null}
    </form>
  );
}
