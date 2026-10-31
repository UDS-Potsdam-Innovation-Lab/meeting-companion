import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { useI18n } from "../../i18n";
import type { LineTarget, TranscriptSegment } from "../../lib/ipc";
import { Avatar, avatarColor } from "../../ui/Avatar";
import { formatClock } from "../transcript/format";
import { GuestForm } from "./GuestForm";
import { lineSpeaker } from "./model";
import type { Speakers } from "./useSpeakers";

interface Props {
  line: TranscriptSegment;
  speakers: Speakers;
  open: boolean;
  onToggle: (open: boolean) => void;
}

/**
 * The speaker area of a final transcript line (frame 02): the person in their colour, the voice
 * ("Voice B", muted) while nobody is confirmed, or an empty circle. It is a button that opens the
 * non-modal "Who said this?" picker for this line only, closed by Escape or a click outside.
 */
export function LineSpeaker({ line, speakers, open, onToggle }: Props) {
  const { t, locale } = useI18n();
  const trigger = useRef<HTMLButtonElement>(null);
  const time = formatClock(line.at, locale);
  const who = lineSpeaker(speakers.state, line);
  const name =
    who.kind === "person"
      ? who.person.name
      : who.kind === "voice"
        ? t("speakers.voice", { voice: who.voice })
        : null;
  const close = (refocus: boolean) => {
    onToggle(false);
    if (refocus) trigger.current?.focus();
  };

  return (
    <>
      <div className="transcript-line__head">
        <button
          ref={trigger}
          type="button"
          className={`line-speaker line-speaker--${who.kind}`}
          aria-expanded={open}
          onClick={() => onToggle(!open)}
          disabled={line.seq === undefined}
        >
          {who.kind === "person" ? (
            <>
              <Avatar name={who.person.name} size={28} />
              <span className="line-speaker__name" style={{ color: avatarColor(who.person.name) }}>
                {who.person.name}
              </span>
            </>
          ) : who.kind === "voice" ? (
            <>
              <span className="avatar avatar--voice" aria-hidden="true">
                {who.voice}
              </span>
              <span className="line-speaker__voice">{name}</span>
            </>
          ) : (
            <span className="avatar avatar--empty line-speaker__empty" aria-hidden="true" />
          )}
          {/* The accessible name starts with what is visible: "Mara Klein, speaker of the line at 10:11". */}
          <span className="visually-hidden">
            {name ? t("speakers.line.suffix", { time }) : t("speakers.line.buttonNone", { time })}
          </span>
        </button>
        <time className="transcript-line__meta" dateTime={new Date(line.at).toISOString()}>
          {time}
        </time>
      </div>
      {open && line.seq !== undefined ? (
        <LinePicker
          line={line}
          seq={line.seq}
          time={time}
          speakers={speakers}
          trigger={trigger}
          onClose={close}
        />
      ) : null}
    </>
  );
}

/** Gap between the picker, its line and the window edge. */
const MARGIN = 8;
const PICKER_WIDTH = 300;

export interface Placement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  /** Opens above the line (not enough room below). */
  above: boolean;
}

/**
 * Where the "Who said this?" picker goes, in window coordinates: below its line if it fits, else on
 * the side with more room, never past the window edges (it scrolls inside if even that is too
 * small). It is placed with `position: fixed`, so the scrolling transcript cannot cut it off.
 */
export function placePicker(
  anchor: DOMRect,
  natural: number,
  viewport: { width: number; height: number },
): Placement {
  const width = Math.min(PICKER_WIDTH, viewport.width - 2 * MARGIN);
  const left = Math.min(Math.max(MARGIN, anchor.left), viewport.width - width - MARGIN);
  const below = viewport.height - anchor.bottom - 2 * MARGIN;
  const above = anchor.top - 2 * MARGIN;
  if (natural <= below || below >= above) {
    return { top: anchor.bottom + MARGIN, left, width, maxHeight: Math.max(below, 0), above: false };
  }
  const height = Math.min(natural, above);
  return { top: anchor.top - MARGIN - height, left, width, maxHeight: above, above: true };
}

function LinePicker({
  line,
  seq,
  time,
  speakers,
  trigger,
  onClose,
}: {
  line: TranscriptSegment;
  seq: number;
  time: string;
  speakers: Speakers;
  trigger: RefObject<HTMLButtonElement | null>;
  onClose: (refocus: boolean) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [guest, setGuest] = useState(false);
  const { state } = speakers;
  const override = state.lines.find((l) => l.seq === seq);
  const current = override ? (override.participantId ?? "nobody") : "voice";

  // Place it next to its line, inside the window; again when the line moves (the transcript scrolls
  // or follows new lines), the window changes, or the guest form opens.
  const [place, setPlace] = useState<Placement | null>(null);
  useLayoutEffect(() => {
    const update = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const el = box.current;
      if (!anchor || !el) return;
      const next = placePicker(anchor, el.scrollHeight, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      setPlace((p) =>
        p &&
        p.top === next.top &&
        p.left === next.left &&
        p.maxHeight === next.maxHeight &&
        p.width === next.width
          ? p
          : next,
      );
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [trigger, guest, state.participants.length]);
  const style: CSSProperties | undefined = place
    ? { top: place.top, left: place.left, width: place.width, maxHeight: place.maxHeight }
    : { visibility: "hidden" };

  // Focus the current choice when the picker opens.
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  }, []);

  // A click or tap outside closes it, without moving focus.
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!box.current?.contains(target) && !trigger.current?.contains(target)) onClose(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [onClose, trigger]);

  const choose = (target: LineTarget) => {
    void speakers.chooseLine(seq, target);
    onClose(true);
  };

  return (
    <div
      ref={box}
      className={`line-picker${place?.above ? " line-picker--above" : ""}`}
      style={style}
      role="dialog"
      aria-label={t("speakers.line.picker", { time })}
      aria-describedby={`${id}-title`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose(true);
        }
      }}
    >
      <p className="line-picker__title" id={`${id}-title`}>
        {t("speakers.line.title")}
      </p>
      <ul className="line-picker__options">
        <li>
          <button
            type="button"
            className="line-picker__option"
            aria-pressed={current === "voice"}
            onClick={() => choose({ kind: "voice" })}
          >
            {line.voice
              ? t("speakers.line.useVoiceOf", { voice: t("speakers.voice", { voice: line.voice }) })
              : t("speakers.line.useVoice")}
          </button>
        </li>
        {state.participants.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className="line-picker__option"
              aria-pressed={current === p.id}
              onClick={() => choose({ kind: "person", participantId: p.id })}
            >
              <Avatar name={p.name} size={24} />
              <span>{p.name}</span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            className="line-picker__option"
            aria-expanded={guest}
            onClick={() => setGuest((g) => !g)}
          >
            {t("speakers.addGuest")}
          </button>
        </li>
        <li>
          <button
            type="button"
            className="line-picker__option"
            aria-pressed={current === "nobody"}
            onClick={() => choose({ kind: "nobody" })}
          >
            {t("speakers.line.nobody")}
          </button>
        </li>
      </ul>
      {guest ? (
        <GuestForm
          onCancel={() => setGuest(false)}
          onAdd={async (name) => {
            const participantId = await speakers.addGuest(name);
            choose({ kind: "person", participantId });
          }}
        />
      ) : null}
    </div>
  );
}
