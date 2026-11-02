// Labels of the captures column: message keys per kind, targets, dates and error texts (job 018).
import { messages, type I18n, type MessageKey } from "../../i18n";
import type { Capture, CaptureError, CaptureType } from "../../lib/ipc";
import type { Meeting } from "../agenda/model";
import { charCount, dateOf, itemLabel, TEXT_MAX, topicTitle, type CaptureGroup, type Target } from "./model";

// ---- labels ----------------------------------------------------------------------------------------

export const TAB_KEYS: Record<CaptureType, MessageKey> = {
  decision: "captures.tab.decision",
  todo: "captures.tab.todo",
  question: "captures.tab.question",
};
export const KIND_KEYS: Record<CaptureType, MessageKey> = {
  decision: "captures.kind.decision",
  todo: "captures.kind.todo",
  question: "captures.kind.question",
};
export const BADGE_KEYS: Record<CaptureType, MessageKey> = {
  decision: "captures.badge.decision",
  todo: "captures.badge.todo",
  question: "captures.badge.question",
};
export const COMMAND_KEYS: Record<CaptureType, MessageKey> = {
  decision: "captures.command.decision",
  todo: "captures.command.todo",
  question: "captures.command.question",
};
export const PLACEHOLDER_KEYS: Record<CaptureType, MessageKey> = {
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
export function targetLong(i18n: I18n, meeting: Meeting, target: Target): string {
  if (target.itemId) {
    const item = itemLabel(meeting, target.itemId);
    if (item) return i18n.t("captures.target.itemTitle", { number: item.number, title: item.title });
  }
  return targetShort(i18n, meeting, target);
}

export function groupHeading(i18n: I18n, meeting: Meeting, g: CaptureGroup): string {
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
