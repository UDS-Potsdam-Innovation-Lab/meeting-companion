import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { messages, useI18n, type I18n, type MessageKey } from "../../i18n";
import { useClock } from "../../lib/clock";
import type { Capture, CaptureError, CaptureType } from "../../lib/ipc";
import { CAPTURE_KINDS } from "../../lib/ipc";
import { Avatar } from "../../ui/Avatar";
import { errorId } from "../../ui/Field";
import { ArrowRightIcon, CheckIcon, PencilIcon } from "../../ui/icons";
import type { Meeting, Participant } from "../agenda/model";
import { formatClock } from "../transcript/format";
import {
  charCount,
  chipNames,
  COUNTER_FROM,
  countByKind,
  dateOf,
  dueDates,
  groupCaptures,
  itemLabel,
  OWNER_CHIPS,
  readCommand,
  TEXT_MAX,
  topicTitle,
  type CaptureGroup,
  type DueChoice,
  type KindCounts,
  type Target,
} from "./model";
import type { Captures, CaptureResult } from "./useCaptures";

// ---- labels ----------------------------------------------------------------------------------------

const TAB_KEYS: Record<CaptureType, MessageKey> = {
  decision: "captures.tab.decision",
  todo: "captures.tab.todo",
  question: "captures.tab.question",
};
const KIND_KEYS: Record<CaptureType, MessageKey> = {
  decision: "captures.kind.decision",
  todo: "captures.kind.todo",
  question: "captures.kind.question",
};
const BADGE_KEYS: Record<CaptureType, MessageKey> = {
  decision: "captures.badge.decision",
  todo: "captures.badge.todo",
  question: "captures.badge.question",
};
const COMMAND_KEYS: Record<CaptureType, MessageKey> = {
  decision: "captures.command.decision",
  todo: "captures.command.todo",
  question: "captures.command.question",
};
const PLACEHOLDER_KEYS: Record<CaptureType, MessageKey> = {
  decision: "captures.placeholder.decision",
  todo: "captures.placeholder.todo",
  question: "captures.placeholder.question",
};

/** "Item 02" / the topic title / "No topic": where a capture belongs, short. */
export function targetShort(i18n: I18n, meeting: Meeting, target: Target): string {
  const { t } = i18n;
  if (target.itemId) {
    const item = itemLabel(meeting, target.itemId);
    return item ? t("captures.target.item", { number: item.number }) : t("captures.target.noItem");
  }
  if (target.topicId) return topicTitle(meeting, target.topicId) ?? t("captures.target.noTopic");
  return meeting.mode === "free" ? t("captures.target.noTopic") : t("captures.target.noItem");
}

/** "Item 02 · Beta launch" / the topic title / "No topic". */
function targetLong(i18n: I18n, meeting: Meeting, target: Target): string {
  if (target.itemId) {
    const item = itemLabel(meeting, target.itemId);
    if (item) return i18n.t("captures.target.itemTitle", { number: item.number, title: item.title });
  }
  return targetShort(i18n, meeting, target);
}

function groupHeading(i18n: I18n, meeting: Meeting, g: CaptureGroup): string {
  const label = targetLong(i18n, meeting, g.target);
  if (!g.current) return label;
  return meeting.mode === "free"
    ? i18n.t("captures.group.nowTopic", { label })
    : i18n.t("captures.group.nowItem", { label });
}

export function formatDue(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(
    dateOf(iso),
  );
}

/** The message for a refused command, by key; never the core's text. */
export function errorText(i18n: I18n, error: CaptureError, text: string): string {
  const { t } = i18n;
  if (error.kind === "invalid") {
    const f = error.fields[0];
    if (!f) return t("captures.error.invalid");
    if (f.field === "text" && f.code === "tooLong") {
      return t("captures.error.text.tooLong", { max: TEXT_MAX, count: charCount(text) });
    }
    const key = `captures.error.${f.field}.${f.code}`;
    return key in messages.de ? t(key as MessageKey) : t("captures.error.invalid");
  }
  return t(`captures.error.${error.kind}` as MessageKey);
}

/** The announcement after the core wrote a new capture. */
export function savedAnnouncement(i18n: I18n, meeting: Meeting, c: Capture): string {
  return i18n.t("captures.notice.saved", {
    kind: i18n.t(KIND_KEYS[c.kind]),
    target: targetShort(i18n, meeting, { itemId: c.itemId, topicId: c.topicId }),
  });
}

// ---- kind tabs ---------------------------------------------------------------------------------------

/** "Decisions 1 / To-dos 2 / Questions 0": the open tab is also the composer's kind. */
export function CaptureTabs({
  counts,
  kind,
  onKind,
}: {
  counts: KindCounts;
  kind: CaptureType;
  onKind: (k: CaptureType) => void;
}) {
  const { t, tp } = useI18n();
  return (
    <div className="capture-tabs" role="group" aria-label={t("captures.tabs.label")}>
      {CAPTURE_KINDS.map((k) => (
        <button
          key={k}
          type="button"
          className="capture-tabs__tab"
          aria-pressed={k === kind}
          data-kind={k}
          onClick={() => onKind(k)}
        >
          <span className="capture-tabs__name">{t(TAB_KEYS[k])}</span>
          <span className="capture-tabs__count" aria-hidden="true">
            {counts[k]}
          </span>
          <span className="visually-hidden">{tp("captures.tab.count", counts[k])}</span>
        </button>
      ))}
    </div>
  );
}

// ---- kind buttons, owners and dates (composer and editor) ----------------------------------------------

function KindButtons({
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

function OwnerChips({
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

function DueChips({ due, onDue }: { due: string | null; onDue: (d: string | null) => void }) {
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

// ---- composer ------------------------------------------------------------------------------------------

interface ComposerProps {
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

// ---- the Undo notice -----------------------------------------------------------------------------------

/**
 * Above the composer: "To-do saved · Item 02" or "To-do deleted" with Undo for 8 s, its bar running
 * down. Not modal; nothing takes focus. If it goes while it has focus, focus moves to the composer.
 */
export function UndoNotice({
  meeting,
  captures,
  onGone,
}: {
  meeting: Meeting;
  captures: Captures;
  onGone: () => void;
}) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const ref = useRef<HTMLDivElement>(null);
  const hadFocus = useRef(false);
  const notice = captures.notice;
  const seq = notice?.seq ?? null;

  useEffect(() => {
    const el = ref.current;
    if (seq === null && hadFocus.current) {
      hadFocus.current = false;
      onGone();
    }
    if (!el) return;
    const track = () => {
      hadFocus.current = el.contains(document.activeElement);
    };
    el.addEventListener("focusin", track);
    el.addEventListener("focusout", track);
    return () => {
      el.removeEventListener("focusin", track);
      el.removeEventListener("focusout", track);
    };
  }, [seq, onGone]);

  if (!notice) return null;
  const c = notice.capture;
  const kind = t(KIND_KEYS[c.kind]);
  let title: string;
  let sub: ReactNode = null;
  if (notice.type === "saved") {
    title = savedAnnouncement(i18n, meeting, c);
    const owner = c.owner ? meeting.participants.find((p) => p.id === c.owner)?.name : undefined;
    const parts = [owner, c.due ? t("captures.dueOn", { date: formatDue(c.due, locale) }) : undefined].filter(
      Boolean,
    );
    if (parts.length) sub = parts.join(" · ");
  } else if (notice.type === "deleted") {
    title = t("captures.notice.deleted", { kind });
    sub = t("captures.notice.quote", { text: c.text });
  } else if (notice.type === "restored") {
    title = t("captures.notice.restored");
  } else {
    title = t("captures.notice.removed");
  }
  const undoable = notice.type === "saved" || notice.type === "deleted";
  return (
    <div className="undo-notice" ref={ref} data-testid="undo-notice" data-type={notice.type}>
      <div className="undo-notice__text">
        <p className="undo-notice__title">{title}</p>
        {sub ? <p className="undo-notice__sub">{sub}</p> : null}
        {captures.undoFailed ? (
          <p className="undo-notice__error" role="alert">
            {t("captures.notice.undoFailed")}
          </p>
        ) : null}
      </div>
      {undoable ? (
        <button
          type="button"
          className="button button--dark-ghost button--small"
          onClick={() => void captures.undo()}
        >
          {t("captures.notice.undo")}
        </button>
      ) : null}
      {undoable ? <span key={notice.seq} className="undo-notice__bar" aria-hidden="true" /> : null}
    </div>
  );
}

// ---- the column -------------------------------------------------------------------------------------------

export interface CapturesColumnProps extends ComposerProps {
  /** Focus target after a delete or when the notice goes: the composer field. */
  composerRef: RefObject<HTMLTextAreaElement | null>;
}

/** Frame 02/16 right column: tabs with counts, the cards, the Undo notice and the composer, pinned. */
export function CapturesColumn(props: CapturesColumnProps) {
  const { t } = useI18n();
  const { meeting, captures, kind, onKind, target, composerRef } = props;
  const focusComposer = () => composerRef.current?.focus();
  return (
    <section className="captures-column" aria-labelledby="captures-heading" data-testid="captures-column">
      <h2 id="captures-heading" className="visually-hidden">
        {t("captures.heading")}
      </h2>
      <CaptureTabs counts={countByKind(captures.captures)} kind={kind} onKind={onKind} />
      {captures.loadFailed ? (
        <p className="banner banner--error" role="alert">
          {t("captures.loadFailed")}
        </p>
      ) : null}
      <CaptureList
        meeting={meeting}
        captures={captures}
        kind={kind}
        target={target}
        onDeleted={focusComposer}
      />
      <div className="captures-column__bottom">
        <UndoNotice meeting={meeting} captures={captures} onGone={focusComposer} />
        <Composer
          ref={composerRef}
          meeting={meeting}
          captures={captures}
          kind={kind}
          onKind={onKind}
          target={target}
        />
      </div>
    </section>
  );
}
