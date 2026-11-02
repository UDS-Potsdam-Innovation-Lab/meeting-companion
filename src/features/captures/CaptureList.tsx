import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import type { Capture, CaptureType } from "../../lib/ipc";
import { Avatar } from "../../ui/Avatar";
import { errorId } from "../../ui/Field";
import { PencilIcon } from "../../ui/icons";
import type { Meeting } from "../agenda/model";
import { formatClock } from "../transcript/format";
import { DueChips, KindButtons, OwnerChips } from "./fields";
import { BADGE_KEYS, errorText, formatDue, groupHeading, KIND_KEYS, targetShort } from "./labels";
import { groupCaptures, type Target } from "./model";
import type { Captures, CaptureResult } from "./useCaptures";

// ---- the list -----------------------------------------------------------------------------------------

interface ListProps {
  meeting: Meeting;
  captures: Captures;
  kind: CaptureType;
  target: Target;
  /** Called after a delete, so focus can go somewhere that still exists. */
  onDeleted: () => void;
}

/** Cards of the open kind, grouped by item or topic (running first, newest first); one inline editor. */
export function CaptureList({ meeting, captures, kind, target, onDeleted }: ListProps) {
  const { t } = useI18n();
  const { editing, setEditing } = captures;
  const free = meeting.mode === "free";
  const groups = groupCaptures(captures.captures, kind, target, free);
  const total = captures.captures.length;
  const i18n = useI18n();
  const returnTo = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus goes back to the card's edit button when the editor closes.
  useEffect(() => {
    if (editing !== null || !returnTo.current) return;
    const id = returnTo.current;
    returnTo.current = null;
    listRef.current?.querySelector<HTMLButtonElement>(`[data-edit="${CSS.escape(id)}"]`)?.focus();
  }, [editing]);

  const close = (id: string) => {
    returnTo.current = id;
    setEditing(null);
  };

  if (total === 0) {
    return (
      <div className="capture-list capture-list--empty">
        <div className="capture-empty">
          <p className="capture-empty__title">{t("captures.empty.title")}</p>
          <p className="capture-empty__body">{t("captures.empty.body")}</p>
        </div>
      </div>
    );
  }
  const none = groups.every((g) => g.captures.length === 0);
  return (
    <div className="capture-list" ref={listRef} tabIndex={-1} data-testid="capture-list">
      {groups.map((g) => {
        const headingId = `capture-group-${g.key.replace(/[^A-Za-z0-9-]/g, "-")}`;
        return (
          <section key={g.key} className="capture-group" aria-labelledby={headingId}>
            <h3
              id={headingId}
              className={`capture-group__heading${g.current ? " capture-group__heading--now" : ""}`}
            >
              {groupHeading(i18n, meeting, g)}
            </h3>
            {g.captures.length === 0 ? (
              <p className="capture-group__empty">
                {free ? t("captures.group.emptyTopic") : t("captures.group.emptyItem")}
              </p>
            ) : (
              <ul className="capture-group__cards">
                {g.captures.map((c) => (
                  <li key={c.id}>
                    {editing === c.id ? (
                      <CaptureEditor
                        meeting={meeting}
                        capture={c}
                        captures={captures}
                        onClose={() => close(c.id)}
                        onDeleted={() => {
                          setEditing(null);
                          onDeleted();
                        }}
                      />
                    ) : (
                      <CaptureCard
                        meeting={meeting}
                        capture={c}
                        justSaved={captures.justSaved === c.id}
                        onEdit={() => setEditing(c.id)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {none ? (
        <div className="capture-empty">
          <p className="capture-empty__title">{t(`captures.emptyTab.${kind}.title` as MessageKey)}</p>
          <p className="capture-empty__body">{t(`captures.emptyTab.${kind}.body` as MessageKey)}</p>
        </div>
      ) : null}
    </div>
  );
}

function CaptureCard({
  meeting,
  capture: c,
  justSaved,
  onEdit,
}: {
  meeting: Meeting;
  capture: Capture;
  justSaved: boolean;
  onEdit: () => void;
}) {
  const { t, locale } = useI18n();
  const owner = c.owner ? meeting.participants.find((p) => p.id === c.owner) : undefined;
  return (
    // A tap anywhere on the card opens the editor too (touch); the ✎ button is the keyboard way.
    <article
      className={`capture-card capture-card--${c.kind}${justSaved ? " capture-card--saved" : ""}`}
      onClick={(e) => {
        if (!(e.target as Element).closest("button")) onEdit();
      }}
    >
      <div className="capture-card__meta">
        <span className={`kind-badge kind-badge--${c.kind}`}>{t(BADGE_KEYS[c.kind])}</span>
        <time className="capture-card__time" dateTime={new Date(c.createdAt).toISOString()}>
          {formatClock(c.createdAt, locale)}
        </time>
        {c.editedAt ? <span className="capture-card__edited">{t("captures.edited")}</span> : null}
        {justSaved ? (
          <span className="capture-card__saved" data-testid="just-saved">
            {t("captures.justSaved")}
          </span>
        ) : null}
        <button
          type="button"
          className="capture-card__edit"
          onClick={onEdit}
          data-edit={c.id}
          aria-label={t("captures.edit.open", { kind: t(KIND_KEYS[c.kind]), text: c.text })}
        >
          <PencilIcon />
        </button>
      </div>
      <p className="capture-card__text">{c.text}</p>
      {owner || c.due ? (
        <p className="capture-card__todo">
          {owner ? (
            <span className="capture-card__owner">
              <Avatar name={owner.name} size={20} />
              {owner.name}
            </span>
          ) : null}
          {c.due ? (
            <span className="capture-card__due">
              {t("captures.dueOn", { date: formatDue(c.due, locale) })}
            </span>
          ) : null}
        </p>
      ) : null}
    </article>
  );
}

function CaptureEditor({
  meeting,
  capture,
  captures,
  onClose,
  onDeleted,
}: {
  meeting: Meeting;
  capture: Capture;
  captures: Captures;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const id = useId();
  const [kind, setKind] = useState<CaptureType>(capture.kind);
  const [text, setText] = useState(capture.text);
  const [owner, setOwner] = useState<string | null>(capture.owner);
  const [due, setDue] = useState<string | null>(capture.due);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Opened on purpose (✎ or a tap on the card), so the text takes focus, and the whole editor down
  // to Delete / Cancel / Save scrolls into the list's view.
  const actionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    actionsRef.current?.scrollIntoView?.({ block: "nearest" });
  }, []);

  const changeKind = (k: CaptureType) => {
    setKind(k);
    if (k !== "todo") {
      setOwner(null);
      setDue(null);
    }
  };
  const settle = (r: CaptureResult, done: () => void) => {
    setBusy(false);
    if (r.ok) done();
    else {
      setError(errorText(i18n, r.error, text));
      ref.current?.focus();
    }
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    settle(await captures.update(capture.id, { kind, text, owner, due }), onClose);
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    settle(await captures.remove(capture.id), onDeleted);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };
  const where = targetShort(i18n, meeting, { itemId: capture.itemId, topicId: capture.topicId });
  return (
    <div className="capture-editor" role="group" aria-labelledby={`${id}-title`} onKeyDown={onKeyDown}>
      <p className="capture-editor__title" id={`${id}-title`}>
        {t("captures.edit.title")}
        <span className="capture-editor__where">{t("captures.edit.where", { target: where })}</span>
      </p>
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
            void save();
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
      <div className="capture-editor__actions" ref={actionsRef}>
        <button
          type="button"
          className="button button--danger-soft button--small"
          onClick={() => void remove()}
        >
          {t("captures.edit.delete")}
        </button>
        <span className="capture-editor__spacer" />
        <button type="button" className="button button--outline button--small" onClick={onClose}>
          {t("captures.edit.cancel")}
        </button>
        <button type="button" className="button button--primary button--small" onClick={() => void save()}>
          {t("captures.edit.save")}
        </button>
      </div>
    </div>
  );
}
