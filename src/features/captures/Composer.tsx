import { forwardRef, useEffect, useId, useRef, useState, type RefObject } from "react";
import { useI18n } from "../../i18n";
import type { CaptureType } from "../../lib/ipc";
import { errorId } from "../../ui/Field";
import { ArrowRightIcon } from "../../ui/icons";
import type { Meeting } from "../agenda/model";
import { DueChips, KindButtons, OwnerChips } from "./fields";
import { COMMAND_KEYS, errorText, PLACEHOLDER_KEYS, targetLong } from "./labels";
import { charCount, COUNTER_FROM, readCommand, TEXT_MAX, type Target } from "./model";
import type { Captures } from "./useCaptures";

// ---- composer ------------------------------------------------------------------------------------------

export interface ComposerProps {
  meeting: Meeting;
  captures: Captures;
  kind: CaptureType;
  onKind: (k: CaptureType) => void;
  target: Target;
}

/**
 * Quick capture, pinned at the bottom: kind buttons (or `/d` `/t` `/q`), the field, owner and date for
 * to-dos, and where it goes. Enter saves; the field clears and keeps focus only after the core wrote
 * the file. A refused capture keeps the text and shows why next to the field.
 */
export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer(
  { meeting, captures, kind, onKind, target },
  ref,
) {
  const i18n = useI18n();
  const { t } = i18n;
  const id = useId();
  const counterId = useId();
  const [text, setText] = useState("");
  const [owner, setOwner] = useState<string | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // At rest (frame 21s "Rest", and 21c while a card is edited) the composer is the kind buttons and a
  // one-line field. It opens with focus, a tap inside it, or while it holds a draft; it closes when
  // focus or a tap goes elsewhere. A tap counts as well as focus: WebKit does not focus buttons on click.
  // During a tap the change waits until the click is done: the composer is pinned to the bottom, so
  // growing or shrinking it moves the controls around it, and the click would land somewhere else.
  const [inside, setInside] = useState(false);
  useEffect(() => {
    let pointerDown = false;
    let pending: boolean | null = null;
    const isInside = (e: Event) => !!formRef.current?.contains(e.target as Node);
    const onFocus = (e: Event) => {
      if (pointerDown) pending = isInside(e);
      else setInside(isInside(e));
    };
    const onDown = (e: Event) => {
      pointerDown = true;
      pending = isInside(e);
    };
    const onUp = () => {
      pointerDown = false;
      const next = pending;
      pending = null;
      if (next !== null) setTimeout(() => setInside(next), 0);
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
    };
  }, []);
  const draft = text !== "" || owner !== null || due !== null || error !== null;
  const open = inside || (draft && captures.editing === null);

  const changeKind = (k: CaptureType) => {
    onKind(k);
    if (k !== "todo") {
      setOwner(null);
      setDue(null);
    }
  };

  const save = async () => {
    if (busy.current) return;
    busy.current = true;
    const result = await captures.add({
      kind,
      text,
      owner,
      due,
      itemId: target.itemId,
      topicId: target.topicId,
    });
    busy.current = false;
    if (result.ok) {
      setText("");
      setOwner(null);
      setDue(null);
      setError(null);
    } else {
      setError(errorText(i18n, result.error, text));
    }
    inner.current?.focus();
  };

  const count = charCount(text);
  const describedBy = [error ? errorId(id) : null, count >= COUNTER_FROM ? counterId : null]
    .filter(Boolean)
    .join(" ");
  return (
    <form
      ref={formRef}
      className={`composer${open ? "" : " composer--rest"}`}
      data-open={open}
      aria-label={t("captures.composer.label")}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      noValidate
    >
      <KindButtons kind={kind} onKind={changeKind} label={t("captures.kind.label")} />
      <div className="composer__field">
        <label className="visually-hidden" htmlFor={id}>
          {t(PLACEHOLDER_KEYS[kind])}
        </label>
        <textarea
          ref={(el) => {
            inner.current = el;
            if (typeof ref === "function") ref(el);
            else if (ref) (ref as RefObject<HTMLTextAreaElement | null>).current = el;
          }}
          id={id}
          className="input capture-field"
          rows={open ? 2 : 1}
          value={text}
          placeholder={t(PLACEHOLDER_KEYS[kind])}
          autoComplete="off"
          onChange={(e) => {
            const command = readCommand(e.target.value);
            if (command) {
              changeKind(command.kind);
              setText(command.text);
            } else setText(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape" && text) {
              e.preventDefault();
              setText("");
              setError(null);
            }
          }}
          {...(error ? { "aria-invalid": true } : {})}
          aria-describedby={describedBy || undefined}
        />
        {text === "" ? (
          <span className="composer__command" aria-hidden="true">
            {t(COMMAND_KEYS[kind])}
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="field__error capture-error" id={errorId(id)}>
          {error}
        </p>
      ) : null}
      {open && kind === "todo" ? (
        <>
          <OwnerChips people={meeting.participants} owner={owner} onOwner={setOwner} />
          <DueChips due={due} onDue={setDue} />
        </>
      ) : null}
      <div className="composer__footer" hidden={!open}>
        <span className="composer__target">
          <ArrowRightIcon />
          <span className="visually-hidden">{t("captures.composer.goesTo")} </span>
          {targetLong(i18n, meeting, target)}
          {meeting.mode === "free" && !target.topicId ? (
            <span className="composer__target-hint">{t("captures.composer.pickTopic")}</span>
          ) : null}
        </span>
        {count >= COUNTER_FROM ? (
          <span
            className={`composer__counter${count > TEXT_MAX ? " composer__counter--over" : ""}`}
            id={counterId}
          >
            {t("captures.composer.counter", { count, max: TEXT_MAX })}
          </span>
        ) : null}
        <span className="composer__hint" aria-hidden="true">
          {t("captures.composer.enter")}
        </span>
        <button type="submit" className="button button--primary button--small composer__save">
          {t("captures.composer.save")}
        </button>
      </div>
    </form>
  );
});
