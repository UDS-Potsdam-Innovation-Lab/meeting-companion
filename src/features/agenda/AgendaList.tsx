import { useLayoutEffect, useRef, useState } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { Avatar } from "../../ui/Avatar";
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, PlusIcon, TrashIcon } from "../../ui/icons";
import { ItemEditor } from "./ItemEditor";
import { BudgetLine } from "./BudgetLine";
import {
  LIMITS,
  emptyItem,
  itemNumber,
  moveItem,
  removeItem,
  upsertItem,
  type AgendaItem,
  type Goal,
  type Meeting,
} from "./model";
import type { MeetingEdit } from "./useMeeting";

interface Props {
  meeting: Meeting;
  onChange: (edit: MeetingEdit) => boolean;
  /** Told whether an open topic editor holds invalid input. */
  onValidity?: (invalid: boolean) => void;
}

type FocusTarget = { id: string; control: "edit" | "up" | "down" } | { id: "add"; control: "add" };

export function AgendaList({ meeting, onChange, onValidity }: Props) {
  const { t } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);
  /** A topic being added that has not passed validation yet; it is not part of the meeting. */
  const [pending, setPending] = useState<AgendaItem | null>(null);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Keyboard focus follows the item after a move, and lands somewhere sensible after a removal.
  useLayoutEffect(() => {
    if (!focus || !listRef.current) return;
    const find = (control: string) =>
      listRef.current?.querySelector<HTMLButtonElement>(`[data-focus="${focus.id}:${control}"]`);
    let el = find(focus.control);
    if (el?.disabled) el = find(focus.control === "up" ? "down" : "up") ?? find("edit");
    el?.focus();
    setFocus(null);
  }, [focus, meeting]);

  const rows = pending ? [...meeting.items, pending] : meeting.items;
  const participants = meeting.participants;

  function open(id: string) {
    if (pending && pending.id !== id) setPending(null);
    setOpenId(openId === id ? null : id);
  }

  function addTopic() {
    if (pending) {
      setOpenId(pending.id);
      return;
    }
    const item = emptyItem();
    setPending(item);
    setOpenId(item.id);
  }

  function commit(item: AgendaItem) {
    if (onChange((m) => upsertItem(m, item)) && pending?.id === item.id) setPending(null);
  }

  function done(id: string) {
    setOpenId(null);
    if (pending?.id === id) {
      setPending(null);
      setFocus({ id: "add", control: "add" });
    } else {
      setFocus({ id, control: "edit" });
    }
  }

  function remove(id: string, index: number) {
    if (pending?.id === id) {
      setPending(null);
    } else {
      onChange((m) => removeItem(m, id));
    }
    if (openId === id) setOpenId(null);
    const next = rows[index + 1] ?? rows[index - 1];
    setFocus(
      next && next.id !== pending?.id ? { id: next.id, control: "edit" } : { id: "add", control: "add" },
    );
  }

  function move(id: string, delta: -1 | 1) {
    onChange((m) => moveItem(m, id, delta));
    setFocus({ id, control: delta < 0 ? "up" : "down" });
  }

  const leadName = (id: string | null) => participants.find((p) => p.id === id)?.name ?? null;

  return (
    <section className="card agenda-list" aria-labelledby="agenda-list-heading" ref={listRef}>
      <h2 id="agenda-list-heading" className="visually-hidden">
        {t("agenda.heading")}
      </h2>
      <div className="agenda-list__header" aria-hidden="true">
        <span className="col-num">{t("agenda.col.number")}</span>
        <span className="col-topic">{t("agenda.col.topic")}</span>
        <span className="col-lead">{t("agenda.col.lead")}</span>
        <span className="col-goal">{t("agenda.col.goal")}</span>
        <span className="col-time">{t("agenda.col.time")}</span>
        <span className="col-actions" />
      </div>

      {rows.length > 0 ? (
        <ol className="agenda-list__items">
          {rows.map((item, index) => {
            const isOpen = openId === item.id;
            const isPending = pending?.id === item.id;
            const editorId = `editor-${item.id}`;
            const lead = leadName(item.lead);
            const label = item.title || t("agenda.item.untitled");
            return (
              <li key={item.id} className={`agenda-row${isOpen ? " is-selected" : ""}`}>
                <div className="agenda-row__summary">
                  <span className="col-num agenda-row__num">{itemNumber(index)}</span>
                  <button
                    type="button"
                    className="col-topic agenda-row__topic"
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? editorId : undefined}
                    data-focus={`${item.id}:edit`}
                    onClick={() => open(item.id)}
                  >
                    <span className="agenda-row__title">{label}</span>
                    {item.outcome ? (
                      <span className="agenda-row__outcome">
                        {t("agenda.item.outcome", { outcome: item.outcome })}
                      </span>
                    ) : null}
                    <span className="agenda-row__edit-hint">
                      <PencilIcon />
                      <span className="visually-hidden">{t("agenda.item.edit")}</span>
                    </span>
                  </button>
                  <span className="agenda-row__meta">
                    <span className="col-lead">
                      {lead ? (
                        <Avatar name={lead} size={26} label={t("agenda.item.lead", { name: lead })} />
                      ) : (
                        <span
                          className="avatar avatar--empty"
                          role="img"
                          aria-label={t("agenda.item.noLead")}
                        />
                      )}
                    </span>
                    <span className="col-goal">
                      <GoalChip goal={item.goal} />
                    </span>
                    <span className="col-time">
                      <span className="time-box">{t("agenda.item.minutes", { minutes: item.minutes })}</span>
                    </span>
                  </span>
                  <span className="col-actions agenda-row__actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t("agenda.item.moveUp", { title: label })}
                      title={t("agenda.item.moveUp", { title: label })}
                      data-focus={`${item.id}:up`}
                      disabled={isPending || index === 0}
                      onClick={() => move(item.id, -1)}
                    >
                      <ArrowUpIcon />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t("agenda.item.moveDown", { title: label })}
                      title={t("agenda.item.moveDown", { title: label })}
                      data-focus={`${item.id}:down`}
                      disabled={isPending || index >= meeting.items.length - 1}
                      onClick={() => move(item.id, 1)}
                    >
                      <ArrowDownIcon />
                    </button>
                    <button
                      type="button"
                      className="icon-button icon-button--danger"
                      aria-label={t("agenda.item.remove", { title: label })}
                      title={t("agenda.item.remove", { title: label })}
                      onClick={() => remove(item.id, index)}
                    >
                      <TrashIcon />
                    </button>
                  </span>
                </div>
                {isOpen ? (
                  <ItemEditor
                    id={editorId}
                    item={item}
                    participants={participants}
                    onCommit={commit}
                    onDone={() => done(item.id)}
                    onValidity={onValidity}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="agenda-list__empty">{t("agenda.empty")}</p>
      )}

      <div className="agenda-list__footer">
        <button
          type="button"
          className="button button--link"
          data-focus="add:add"
          onClick={addTopic}
          disabled={meeting.items.length >= LIMITS.items}
        >
          <PlusIcon />
          {t("agenda.add")}
        </button>
        <BudgetLine meeting={meeting} />
      </div>
    </section>
  );
}

export function GoalChip({ goal }: { goal: Goal }) {
  const { t } = useI18n();
  return <span className={`goal-chip goal-chip--${goal}`}>{t(`goal.${goal}` as MessageKey)}</span>;
}
