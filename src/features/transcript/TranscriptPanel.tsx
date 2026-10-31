import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { useClock } from "../../lib/clock";
import type { RecordReason } from "../../lib/ipc";
import { GearIcon, MicIcon } from "../../ui/icons";
import { LineSpeaker } from "../speakers/LineSpeaker";
import { voiceCount } from "../speakers/model";
import type { Speakers } from "../speakers/useSpeakers";
import { useSettings } from "../settings/useSettings";
import { formatClock } from "./format";
import { LevelMeter } from "./LevelMeter";
import type { Recording } from "./useRecording";

/** New final lines are announced at most this often, as a count, never line by line. */
export const ANNOUNCE_EVERY_MS = 10_000;
/** Distance from the bottom (px) that still counts as "at the newest line". */
export const AT_BOTTOM = 24;

/** Where the line list was scrolled to, kept while the speakers view is open. */
export interface FeedScroll {
  top: number;
  pinned: boolean;
}

interface Props {
  recording: Recording;
  /** The stored meeting has the consent confirmation. */
  consented: boolean;
  speakers: Speakers;
  /** Opens the speakers view (frame 06) in place of the live view. */
  onOpenSpeakers: () => void;
  /** Where the list was when the speakers view opened: restored on return. */
  initialScroll: FeedScroll | null;
  /** Opens the settings view (in the same window; recording carries on). */
  onOpenSettings: () => void;
  /** The settings view covers the live view: the feed keeps its scroll position for the return. */
  hidden?: boolean;
}

/**
 * Frame 02 centre column, "Transcript" only: the consent prompt before anything is recorded (inline,
 * not modal), the final lines with their time, the live partial line, and the footer with the level
 * meter. Microphone and speech model are chosen in the settings. Transcript text is untrusted and rendered as plain text.
 */
export function TranscriptPanel({
  recording,
  consented,
  speakers,
  onOpenSpeakers,
  initialScroll,
  onOpenSettings,
  hidden = false,
}: Props) {
  const { t, tp } = useI18n();
  const { capture, lines, partial } = recording;
  const active = capture.state === "recording" || capture.state === "paused";
  const error = capture.state === "error" ? capture.reason : null;

  return (
    <section className="transcript-card" aria-labelledby="transcript-heading">
      <div className="transcript-card__header">
        <h2 className="transcript-card__tab" id="transcript-heading">
          {t("transcript.heading")}
        </h2>
      </div>
      <div className="transcript-card__body">
        {active ? null : !consented ? (
          <ConsentNotice recording={recording} reason={error} />
        ) : error === "chosenMicrophoneMissing" ? (
          <MissingMicNotice recording={recording} onOpenSettings={onOpenSettings} />
        ) : error ? (
          <ErrorNotice recording={recording} reason={error} />
        ) : (
          <OffNotice recording={recording} />
        )}
        {speakers.failed ? (
          <p className="banner banner--error" role="alert">
            {t("speakers.failed")}
          </p>
        ) : null}
        {active && recording.switched ? (
          <SwitchedNotice recording={recording} onOpenSettings={onOpenSettings} />
        ) : null}
        {recording.transcriptError ? (
          <p className="banner banner--error" role="alert">
            {t("transcript.loadFailed")}
          </p>
        ) : null}
        {lines.length > 0 || partial || active ? (
          <Feed
            recording={recording}
            active={active}
            speakers={speakers}
            initialScroll={initialScroll}
            hidden={hidden}
          />
        ) : null}
      </div>
      {active || lines.length > 0 ? (
        <div className="transcript-card__footer">
          <LevelMeter level={capture.level} active={capture.state === "recording"} />
          <button
            type="button"
            className="transcript-card__speakers"
            onClick={onOpenSpeakers}
            data-speakers-button=""
          >
            {tp(
              capture.state === "recording"
                ? "speakers.footer.listening"
                : capture.state === "paused"
                  ? "speakers.footer.paused"
                  : "speakers.footer.off",
              voiceCount(lines),
            )}
          </button>
        </div>
      ) : null}
      <Announcer received={recording.received} />
    </section>
  );
}

function Feed({
  recording,
  active,
  speakers,
  initialScroll,
  hidden,
}: {
  recording: Recording;
  active: boolean;
  speakers: Speakers;
  initialScroll: FeedScroll | null;
  hidden: boolean;
}) {
  const { t } = useI18n();
  const { lines, partial } = recording;
  const feedRef = useRef<HTMLOListElement>(null);
  const [pinned, setPinned] = useState(() => initialScroll?.pinned ?? true);
  const [picking, setPicking] = useState<number | null>(null);
  const scrollTop = useRef(initialScroll?.top ?? 0);

  // Back from the settings view: the reader is where they left, even if a hidden feed lost its offset.
  useLayoutEffect(() => {
    const el = feedRef.current;
    if (hidden || !el) return;
    el.scrollTop = pinned ? el.scrollHeight : scrollTop.current;
    // Only on the change of `hidden`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden]);

  // Back from the speakers view: the list is where the reader left it.
  const [restore] = useState(initialScroll);
  useLayoutEffect(() => {
    const el = feedRef.current;
    if (el && restore && !restore.pinned) el.scrollTop = restore.top;
  }, [restore]);

  // Follow the newest line unless the reader scrolled up, or is picking who said a line (the line
  // would move away under the picker).
  useLayoutEffect(() => {
    const el = feedRef.current;
    if (pinned && picking === null && el) el.scrollTop = el.scrollHeight;
  }, [pinned, picking, lines.length, partial?.text]);

  const onScroll = () => {
    const el = feedRef.current;
    if (!el || hidden) return;
    scrollTop.current = el.scrollTop;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM);
  };

  const jump = () => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setPinned(true);
    el.focus();
  };

  const empty = lines.length === 0 && !partial;
  return (
    <div className="transcript-feed-wrap">
      {empty && active ? <p className="transcript-feed__empty">{t("transcript.empty")}</p> : null}
      {/* Before the list in the focus order: the list now holds a button per line. */}
      {!pinned && !empty ? (
        <button
          type="button"
          className="button button--secondary button--small transcript-jump"
          onClick={jump}
        >
          {t("transcript.jump")}
        </button>
      ) : null}
      {!empty ? (
        <ol
          className="transcript-feed"
          ref={feedRef}
          onScroll={onScroll}
          tabIndex={0}
          aria-label={t("transcript.heading")}
        >
          {lines.map((line, i) => (
            <li className="transcript-line" key={`${line.seq ?? "x"}-${line.startMs}-${i}`} lang={line.lang}>
              <LineSpeaker
                line={line}
                speakers={speakers}
                open={picking !== null && picking === line.seq}
                onToggle={(open) => setPicking(open && line.seq !== undefined ? line.seq : null)}
              />
              <p className="transcript-line__text">{line.text}</p>
            </li>
          ))}
          {partial ? (
            <li
              className="transcript-line transcript-line--partial"
              lang={partial.lang}
              data-testid="partial-line"
            >
              <span className="transcript-line__meta">{t("transcript.speaking")}</span>
              <p className="transcript-line__text">{partial.text}</p>
            </li>
          ) : null}
        </ol>
      ) : null}
    </div>
  );
}

/** A polite live region that says how many lines were added, at most once every 10 s. */
function Announcer({ received }: { received: number }) {
  const { tp } = useI18n();
  const clock = useClock();
  const [text, setText] = useState("");
  const announced = useRef(0);
  const lastAt = useRef(Number.NEGATIVE_INFINITY);

  // Runs again on every new line and every second, so a count held back by the 10 s limit follows.
  useEffect(() => {
    const check = () => {
      const pending = received - announced.current;
      const now = clock.now();
      if (pending > 0 && now - lastAt.current >= ANNOUNCE_EVERY_MS) {
        setText(tp("transcript.announce", pending));
        announced.current = received;
        lastAt.current = now;
      }
    };
    check();
    return clock.every(1000, check);
  }, [clock, tp, received]);

  return (
    <div className="visually-hidden" aria-live="polite" data-testid="transcript-announcement">
      {text}
    </div>
  );
}

function ConsentNotice({ recording, reason }: { recording: Recording; reason: RecordReason | null }) {
  const { t } = useI18n();
  const [informed, setInformed] = useState(false);
  return (
    <div className="rec-notice">
      {reason ? (
        <p className="banner banner--error" role="alert">
          {t(REASON_KEYS[reason])}
        </p>
      ) : null}
      <h3 className="rec-notice__title">{t("consent.title")}</h3>
      <label className="consent-check">
        <input type="checkbox" checked={informed} onChange={(e) => setInformed(e.target.checked)} />
        <span>{t("consent.check")}</span>
      </label>
      <div className="rec-notice__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={!informed || recording.busy}
          onClick={() => void recording.confirmAndStart()}
        >
          <MicIcon />
          {t("consent.start")}
        </button>
        {!informed ? <span className="rec-notice__hint">{t("consent.hint")}</span> : null}
      </div>
      <p className="rec-notice__local">{t("consent.local")}</p>
    </div>
  );
}

function OffNotice({ recording }: { recording: Recording }) {
  const { t } = useI18n();
  return (
    <div className="rec-notice">
      <h3 className="rec-notice__title">{t("recording.off.title")}</h3>
      <p className="rec-notice__body">{t("recording.off.body")}</p>
      <ResumeButton recording={recording} />
    </div>
  );
}

const REASON_KEYS: Record<RecordReason, MessageKey> = {
  noMicrophone: "recording.error.noMicrophone",
  chosenMicrophoneMissing: "recording.error.chosenMicrophoneMissing",
  microphoneBlocked: "recording.error.microphoneBlocked",
  microphoneLost: "recording.error.microphoneLost",
  noModel: "recording.error.noModel",
  engineFailed: "recording.error.engineFailed",
  storageFailed: "recording.error.storageFailed",
  transcriptUnreadable: "recording.error.transcriptUnreadable",
  locked: "recording.error.locked",
};

function ErrorNotice({ recording, reason }: { recording: Recording; reason: RecordReason }) {
  const { t } = useI18n();
  return (
    <div className="rec-notice rec-notice--error">
      <div role="alert">
        <h3 className="rec-notice__title">{t(REASON_KEYS[reason])}</h3>
        <p className="rec-notice__body">{t("recording.error.off")}</p>
      </div>
      <ResumeButton recording={recording} />
    </div>
  );
}

function ResumeButton({ recording }: { recording: Recording }) {
  const { t } = useI18n();
  return (
    <div className="rec-notice__actions">
      <button
        type="button"
        className="button button--primary"
        disabled={recording.busy}
        onClick={() => void recording.start()}
        data-rec-action=""
      >
        <MicIcon />
        {t("recording.resumeRecording")}
      </button>
    </div>
  );
}

/**
 * Frame 02 addition: the microphone chosen in the settings is not connected, so recording did not
 * start and no other microphone was opened. One tap on "Use system default" switches the setting and
 * starts recording; "Settings" opens the Audio section.
 */
function MissingMicNotice({
  recording,
  onOpenSettings,
}: {
  recording: Recording;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const name = settings.inputDevice;
  const switchToDefault = async () => {
    await update({ key: "inputDevice", value: null });
    await recording.start();
  };
  return (
    <div className="rec-notice rec-notice--error rec-notice--centred" data-testid="mic-missing">
      <div role="alert">
        <h3 className="rec-notice__title">
          {name ? t("recording.missing.title", { name }) : t("recording.error.chosenMicrophoneMissing")}
        </h3>
        <p className="rec-notice__body">{t("recording.missing.body")}</p>
      </div>
      <div className="rec-notice__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={recording.busy}
          onClick={() => void switchToDefault()}
          data-rec-action=""
        >
          <MicIcon />
          {t("recording.missing.useDefault")}
        </button>
        <button type="button" className="button button--outline" onClick={onOpenSettings}>
          <GearIcon />
          {t("settings.open")}
        </button>
      </div>
      <p className="rec-notice__local">{t("recording.missing.hint")}</p>
    </div>
  );
}

/**
 * Frame 02 addition: the chosen microphone was lost and recording carries on with the system default.
 * Non-blocking: a status with an icon and text (not colour alone), "Settings" and "Dismiss".
 */
function SwitchedNotice({ recording, onOpenSettings }: { recording: Recording; onOpenSettings: () => void }) {
  const { t, locale } = useI18n();
  const { settings } = useSettings();
  const event = recording.switched!;
  const time = formatClock(event.at, locale);
  return (
    <div className="switched-notice" role="status" data-testid="mic-switched">
      <span className="switched-notice__icon" aria-hidden="true">
        <MicIcon />
      </span>
      <div className="switched-notice__text">
        <p className="switched-notice__title">{t("recording.switched.title")}</p>
        <p className="switched-notice__body">
          {settings.inputDevice
            ? t("recording.switched.body", { name: settings.inputDevice, time })
            : t("recording.switched.bodyNoName", { time })}
        </p>
      </div>
      <div className="switched-notice__actions">
        <button type="button" className="button button--outline button--small" onClick={onOpenSettings}>
          {t("settings.open")}
        </button>
        <button
          type="button"
          className="button button--outline button--small"
          onClick={recording.dismissSwitched}
        >
          {t("recording.switched.dismiss")}
        </button>
      </div>
    </div>
  );
}
