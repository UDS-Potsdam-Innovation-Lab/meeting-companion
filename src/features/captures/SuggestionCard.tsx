import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n";
import type { CaptureSuggestion, CaptureType } from "../../lib/ipc";
import { Avatar } from "../../ui/Avatar";
import { errorId } from "../../ui/Field";
import { CheckIcon } from "../../ui/icons";
import type { Meeting } from "../agenda/model";
import { formatClock } from "../transcript/format";
import { DueChips, KindButtons, OwnerChips } from "./fields";
import { errorText, KIND_KEYS } from "./labels";
import type { Target } from "./model";
import { tabSuggestions } from "./suggestions";
import type { CaptureResult, Captures } from "./useCaptures";
import type { Suggestions } from "./useSuggestions";

/** Who said a transcript line and when, for "Aus dem Transkript: Mara Klein, 10:11 ›". */
export interface LineSource {
  name: string | null;
  at: number;
}

export interface SuggestionPinProps {
  meeting: Meeting;
  /** The open kind tab: one card of this kind is pinned. */
  kind: CaptureType;
  captures: Captures;
  suggestions: Suggestions;
  target: Target;
  /** The speaker and time of a transcript line, by its number. */
  sourceOf: (seq: number) => LineSource | null;
  /** "›": shows the source line in the transcript. */
  onShowLine: (seq: number) => void;
  /** Where focus goes when no card is left: the composer. */
  onEmpty: () => void;
}

/**
 * Frame 21g: the suggestions of the open tab, pinned above the list. One card at a time; the others
 * wait behind it ("1 weiterer Vorschlag"). Bestätigen, Bearbeiten (inline, not modal) and Verwerfen are
 * one tap each. Nothing here confirms on its own, and a new card never takes focus.
 */
export function SuggestionPin(props: SuggestionPinProps) {
  const { t, tp } = useI18n();
  const { kind, suggestions } = props;
  const headingId = useId();
  const list = tabSuggestions(suggestions.pending, kind, suggestions.front);
  const pinned = list[0];
  if (!pinned) return null;
  const rest = list.length - 1;
  return (
    <section className="suggest-pin" aria-labelledby={headingId} data-testid="suggestion-pin">
      <h3 className="suggest-pin__heading" id={headingId}>
        <span aria-hidden="true">{t("captures.suggest.glyph")} </span>
        {t("captures.suggest.heading", { count: list.length })}
      </h3>
      {suggestions.editing === pinned.id ? (
        <SuggestionEditor key={pinned.id} {...props} suggestion={pinned} />
      ) : (
        <SuggestionCard key={pinned.id} {...props} suggestion={pinned} />
      )}
      {rest > 0 ? (
        <p className="suggest-pin__waiting" data-testid="suggestion-waiting">
          <span className="suggest-pin__more">{tp("captures.suggest.waiting", rest)}</span>
          <span className="suggest-pin__hint">{t("captures.suggest.waitingHint")}</span>
        </p>
      ) : null}
    </section>
  );
}

interface CardProps extends SuggestionPinProps {
  suggestion: CaptureSuggestion;
}

/** "✦ Vorschlag · 10:11" and the kind chip: the card's and the editor's first line. */
function SuggestionMeta({ suggestion: s, editing }: { suggestion: CaptureSuggestion; editing?: boolean }) {
  const { t, locale } = useI18n();
  return (
    <div className="suggest-card__meta">
      <span className="suggest-badge">
        <span aria-hidden="true">{t("captures.suggest.glyph")}</span>
        {t("captures.suggest.badge", { time: formatClock(s.createdAt, locale) })}
      </span>
      {editing ? (
        <span className="suggest-card__editing">{t("captures.suggest.editing")}</span>
      ) : (
        <span className={`kind-chip kind-chip--${s.kind}`}>{t(KIND_KEYS[s.kind])}</span>
      )}
    </div>
  );
}

function SuggestionCard({
  meeting,
  captures,
  suggestions,
  target,
  sourceOf,
  onShowLine,
  onEmpty,
  suggestion: s,
}: CardProps) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const textId = useId();
  const ref = useRef<HTMLElement>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const owner = s.owner ? meeting.participants.find((p) => p.id === s.owner) : undefined;
  const seq = s.segments[0];
  const source = seq === undefined ? null : sourceOf(seq);

  // A tap on the transcript chip brings this card forward and moves focus here; nothing else does.
  const { front, focusRequest } = suggestions;
  useEffect(() => {
    if (focusRequest > 0 && front === s.id) ref.current?.focus();
  }, [focusRequest, front, s.id]);

  // After Bestätigen or Verwerfen the card goes: focus moves to the next card's Bestätigen, or the
  // composer when none is left (it is never lost).
  const handOn = () => {
    const pin = ref.current?.closest(".suggest-pin");
    const column = pin?.parentElement;
    setTimeout(() => {
      const next = column?.querySelector<HTMLButtonElement>(".suggest-pin [data-suggest-confirm]");
      if (next) next.focus();
      else onEmpty();
    }, 0);
  };
  const hadFocus = () => !!ref.current?.contains(document.activeElement);

  const confirm = async () => {
    if (busy.current) return;
    busy.current = true;
    const focused = hadFocus();
    const r = await captures.confirm({ suggestionId: s.id, itemId: target.itemId, topicId: target.topicId });
    busy.current = false;
    if (r.ok) {
      suggestions.drop(s.id);
      if (focused) handOn();
    } else setError(errorText(i18n, r.error, s.text));
  };
  const dismiss = async () => {
    if (busy.current) return;
    busy.current = true;
    const focused = hadFocus();
    const e = await suggestions.dismiss(s.id);
    busy.current = false;
    if (!e) {
      if (focused) handOn();
    } else setError(errorText(i18n, e, s.text));
  };

  return (
    <article
      ref={ref}
      className={`suggest-card suggest-card--${s.kind}`}
      tabIndex={-1}
      aria-labelledby={textId}
      aria-describedby={`${textId}-kind`}
      data-suggestion={s.id}
    >
      <span className="visually-hidden" id={`${textId}-kind`}>
        {t("captures.suggest.label", { kind: t(KIND_KEYS[s.kind]) })}
      </span>
      <SuggestionMeta suggestion={s} />
      {/* Model output: shown as the text it is, never as markup. */}
      <p className="suggest-card__text" id={textId}>
        {s.text}
      </p>
      {owner ? (
        <p className="suggest-card__owner">
          <span className="suggest-card__label">{t("captures.suggest.owner")}</span>
          <span className="capture-card__owner">
            <Avatar name={owner.name} size={20} />
            {owner.name}
          </span>
        </p>
      ) : null}
      {seq !== undefined && source ? (
        <p className="suggest-card__source">
          <span className="suggest-card__label">{t("captures.suggest.source")}</span>
          <button
            type="button"
            className="suggest-card__link"
            onClick={() => onShowLine(seq)}
            aria-label={t("captures.suggest.sourceShow", {
              name: source.name ?? "",
              time: formatClock(source.at, locale),
            })}
          >
            {source.name
              ? t("captures.suggest.sourceLine", { name: source.name, time: formatClock(source.at, locale) })
              : t("captures.suggest.sourceTime", { time: formatClock(source.at, locale) })}
          </button>
        </p>
      ) : null}
      {error ? (
        <p className="field__error capture-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="suggest-card__actions">
        <button
          type="button"
          className="button button--primary button--small suggest-card__confirm"
          onClick={() => void confirm()}
          data-suggest-confirm=""
        >
          <CheckIcon />
          {t("captures.suggest.confirm")}
        </button>
        <button
          type="button"
          className="button button--outline button--small"
          onClick={() => suggestions.setEditing(s.id)}
          data-suggest-edit={s.id}
        >
          {t("captures.suggest.edit")}
        </button>
        <button type="button" className="button button--outline button--small" onClick={() => void dismiss()}>
          {t("captures.suggest.dismiss")}
        </button>
      </div>
    </article>
  );
}

/** Frame 21h: Bearbeiten opens the fields in place. Bestätigen stores the edited version; Esc goes back. */
function SuggestionEditor({ meeting, captures, suggestions, target, onEmpty, suggestion: s }: CardProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const id = useId();
  const [kind, setKind] = useState<CaptureType>(s.kind);
  const [text, setText] = useState(s.text);
  const [owner, setOwner] = useState<string | null>(s.owner);
  const [due, setDue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Opened on purpose (Bearbeiten), so the text takes focus.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    boxRef.current?.scrollIntoView?.({ block: "nearest" });
  }, []);

  const back = () => {
    suggestions.setEditing(null);
    setTimeout(() => {
      document.querySelector<HTMLButtonElement>(`[data-suggest-edit="${CSS.escape(s.id)}"]`)?.focus();
    }, 0);
  };
  const changeKind = (k: CaptureType) => {
    setKind(k);
    if (k !== "todo") {
      setOwner(null);
      setDue(null);
    }
  };
  const settle = (r: CaptureResult) => {
    busy.current = false;
    if (r.ok) {
      suggestions.drop(s.id);
      setTimeout(() => {
        const next = document.querySelector<HTMLButtonElement>(".suggest-pin [data-suggest-confirm]");
        if (next) next.focus();
        else onEmpty();
      }, 0);
    } else {
      setError(errorText(i18n, r.error, text));
      ref.current?.focus();
    }
  };
  const confirm = async () => {
    if (busy.current) return;
    busy.current = true;
    settle(
      await captures.confirm({
        suggestionId: s.id,
        itemId: target.itemId,
        topicId: target.topicId,
        edit: { kind, text, owner, due },
      }),
    );
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      back();
    }
  };
  return (
    <div
      ref={boxRef}
      className="suggest-card suggest-card--editing capture-editor"
      role="group"
      aria-labelledby={`${id}-title`}
      onKeyDown={onKeyDown}
      data-suggestion={s.id}
    >
      <span className="visually-hidden" id={`${id}-title`}>
        {t("captures.suggest.label", { kind: t(KIND_KEYS[kind]) })}
      </span>
      <SuggestionMeta suggestion={s} editing />
      <KindButtons kind={kind} onKind={changeKind} label={t("captures.kind.label")} />
      <label className="visually-hidden" htmlFor={id}>
        {t("captures.edit.text")}
      </label>
      <textarea
        ref={ref}
        id={id}
        className="input capture-field"
        rows={2}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void confirm();
          }
        }}
        {...(error ? { "aria-invalid": true, "aria-describedby": errorId(id) } : {})}
      />
      {error ? (
        <p className="field__error capture-error" id={errorId(id)}>
          {error}
        </p>
      ) : null}
      {kind === "todo" ? (
        <>
          <OwnerChips people={meeting.participants} owner={owner} onOwner={setOwner} />
          <DueChips due={due} onDue={setDue} />
        </>
      ) : null}
      <div className="capture-editor__actions">
        <span className="suggest-card__esc" aria-hidden="true">
          {t("captures.suggest.escHint")}
        </span>
        <span className="capture-editor__spacer" />
        <button type="button" className="button button--outline button--small" onClick={back}>
          {t("captures.suggest.cancel")}
        </button>
        <button
          type="button"
          className="button button--primary button--small"
          onClick={() => void confirm()}
          data-suggest-confirm=""
        >
          <CheckIcon />
          {t("captures.suggest.confirm")}
        </button>
      </div>
    </div>
  );
}
