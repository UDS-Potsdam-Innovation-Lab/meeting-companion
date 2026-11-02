import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../../i18n";
import { invalidProps, errorId } from "../../ui/Field";
import { PlusIcon } from "../../ui/icons";
import { LIMITS, validateTitle, type ErrorCode } from "../agenda/model";
import type { TopicRow } from "./free";
import type { KindCounts } from "../captures/model";
import { captureSummary } from "./LiveAgenda";

interface Props {
  topics: TopicRow[];
  /** Another topic can be added (fewer than the limit). */
  canAdd: boolean;
  /** Adds a topic with a valid title; it becomes "talking now". */
  onAdd: (title: string) => void;
  /** A tap on a row: makes it "talking now", or stops it when it already is. */
  onTap: (id: string) => void;
  /** What was captured per topic id (job 018). */
  counts?: ReadonlyMap<string, KindCounts>;
}

/**
 * Frame 16 "Topics so far": the topics added by hand, the one "talking now" tinted and labelled in
 * text, the whole minutes of each, and "Add topic" pinned at the bottom with an inline field. Every
 * action is one tap with no confirmation. Titles are rendered as text only.
 */
export function TopicsCard({ topics, canAdd, onAdd, onTap, counts }: Props) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const headingId = useId();
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const returnFocus = useRef(false);
  const lastId = topics.at(-1)?.topic.id;
  const count = useRef(topics.length);

  // Focus goes back to "Add topic" when the field closes; a new topic scrolls into view.
  useEffect(() => {
    if (!adding && returnFocus.current) {
      returnFocus.current = false;
      addRef.current?.focus();
    }
  }, [adding]);
  useEffect(() => {
    if (topics.length > count.current) {
      listRef.current?.lastElementChild?.scrollIntoView?.({ block: "nearest" });
    }
    count.current = topics.length;
  }, [topics.length, lastId]);

  const close = () => {
    returnFocus.current = true;
    setAdding(false);
  };
  const current = topics.some((row) => row.current);

  return (
    <section className="card topics-card" aria-labelledby={headingId}>
      <div className="topics-card__header">
        <h2 className="topics-card__heading" id={headingId}>
          {t("free.topics.heading")}
        </h2>
        {topics.length > 0 ? (
          <span className="topics-card__count">{tp("free.topics.count", topics.length)}</span>
        ) : null}
      </div>

      {topics.length === 0 ? (
        <div className="topics-card__empty">
          <p className="topics-card__empty-title">{t("free.topics.empty.title")}</p>
          <p className="topics-card__empty-body">{t("free.topics.empty.body")}</p>
        </div>
      ) : (
        <ul className="topics-card__list" ref={listRef}>
          {topics.map(({ topic, minutes, current: now }) => (
            <li key={topic.id}>
              <button
                type="button"
                className={`topic-row${now ? " topic-row--now" : ""}`}
                aria-pressed={now}
                onClick={() => onTap(topic.id)}
              >
                <span className="topic-row__icon" aria-hidden="true">
                  {now ? <span className="topic-row__dot" /> : null}
                </span>
                <span className="topic-row__text">
                  <span className="topic-row__title">{topic.title}</span>
                  {now ? (
                    <span className="topic-row__now">
                      <span className="topic-row__now-dot" aria-hidden="true" />
                      {t("free.topics.now")}
                    </span>
                  ) : null}
                  {counts?.get(topic.id) ? (
                    <span className="topic-row__captured">{captureSummary(i18n, counts.get(topic.id))}</span>
                  ) : null}
                </span>
                <span className="topic-row__minutes">{t("free.topics.minutes", { minutes })}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {topics.length > 0 && !current ? (
        <p className="topics-card__hint">{t("free.topics.noneCurrent")}</p>
      ) : null}

      <div className="topics-card__footer">
        {adding && canAdd ? (
          <AddTopicForm
            onAdd={(title) => {
              onAdd(title);
              close();
            }}
            onCancel={close}
          />
        ) : (
          <>
            <button
              ref={addRef}
              type="button"
              className="button button--link topics-card__add"
              data-action="add-topic"
              onClick={() => setAdding(true)}
              disabled={!canAdd}
            >
              <PlusIcon />
              {t("free.topics.add")}
            </button>
            {!canAdd ? (
              <p className="topics-card__limit">{t("free.topics.limit", { max: LIMITS.topics })}</p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function AddTopicForm({ onAdd, onCancel }: { onAdd: (title: string) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const id = useId();
  const hintId = useId();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<ErrorCode | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The field is opened on purpose ("Add topic"), so it takes focus.
  useEffect(() => inputRef.current?.focus(), []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = validateTitle(title);
    if (code) {
      setError(code);
      inputRef.current?.focus();
      return;
    }
    onAdd(title);
  };

  const message =
    error === "empty"
      ? t("error.topicTitle.empty")
      : error === "tooLong"
        ? t("error.topicTitle.tooLong", { max: LIMITS.title, count: Array.from(title).length })
        : null;
  const describedBy = [message ? errorId(id) : null, hintId].filter(Boolean).join(" ");

  return (
    <form
      className="add-topic"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      noValidate
    >
      <label className="field__label" htmlFor={id}>
        {t("free.topics.new")}
      </label>
      <input
        ref={inputRef}
        id={id}
        className="input"
        type="text"
        autoComplete="off"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          if (error) setError(null);
        }}
        {...invalidProps(id, message)}
        aria-describedby={describedBy}
      />
      {message ? (
        <p className="field__error" id={errorId(id)}>
          {message}
        </p>
      ) : null}
      <div className="add-topic__actions">
        <button type="submit" className="button button--primary button--small">
          {t("free.topics.confirm")}
        </button>
        <button type="button" className="button button--outline button--small" onClick={onCancel}>
          {t("free.topics.cancel")}
        </button>
        <span className="add-topic__hint" id={hintId}>
          {t("free.topics.hint")}
        </span>
      </div>
    </form>
  );
}
