import { useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "../../i18n";
import type { Meeting } from "../agenda/model";
import { formatDue, KIND_KEYS, savedAnnouncement } from "./labels";
import type { Captures } from "./useCaptures";

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
    const parts = [
      c.source === "suggested" ? t("captures.notice.fromSuggestion") : undefined,
      owner,
      c.due ? t("captures.dueOn", { date: formatDue(c.due, locale) }) : undefined,
    ].filter(Boolean);
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
