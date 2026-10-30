import { useEffect, useRef, useState } from "react";
import { TopBar } from "../../app/TopBar";
import { useI18n } from "../../i18n";
import { useClock, useNow } from "../../lib/clock";
import type { Meeting } from "../agenda/model";
import type { MeetingState } from "../agenda/useMeeting";
import { EndMeeting } from "./EndMeeting";
import { LiveAgenda, OverallLine } from "./LiveAgenda";
import { Nudge, nudgeTitle } from "./Nudge";
import { advance, canExtend, endRun, extend, liveSnapshot, nudgeDue, nudgeKey } from "./run";
import { TimerCard } from "./TimerCard";

export const LIVE_VIEW = "live";

interface Props {
  /** The running meeting (`state.meeting`, narrowed). Mount with `key={meeting.id}`. */
  meeting: Meeting;
  state: MeetingState;
}

/**
 * Frame 02 "Live meeting": top bar, the left column (timer, agenda, parking lot, overall line), the
 * time nudge and "End meeting" at the bottom right. The centre and right columns come with later jobs; their space stays empty.
 */
export function LiveView({ meeting, state }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const clock = useClock();
  const now = useNow();
  const { update, startNew, saveFailed } = state;
  const run = meeting.run!;
  const snapshot = liveSnapshot(meeting, run, now);
  const { current } = snapshot;
  const extendable = canExtend(meeting);

  // Nudge: shown from 80 % of the current budget until "Wrap up", "+5 min" or the item ends; at most
  // once per item and budget. Dismissals last for this session.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const key = current ? nudgeKey(current) : null;
  const showNudge = current !== null && key !== null && nudgeDue(current) && !dismissed.has(key);

  // Announced once per nudge through the polite live region, which always exists. The text is set
  // when a nudge appears (state adjusted during render), not on every change of its countdown.
  const [announced, setAnnounced] = useState<{ key: string | null; text: string }>({ key: null, text: "" });
  const visibleKey = showNudge ? key : null;
  if (visibleKey !== announced.key) {
    setAnnounced({
      key: visibleKey,
      text: visibleKey && current ? `${nudgeTitle(i18n, current)} ${t("nudge.body")}` : "",
    });
  }

  // Focus: when the last item ends, move to "Agenda done"; when the nudge closes while it had focus,
  // move to "Next ›" (or "Agenda done") instead of losing it.
  const doneRef = useRef<HTMLHeadingElement>(null);
  const nudgeRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const next = leftRef.current?.querySelector<HTMLButtonElement>('[data-action="next"]');
    (next ?? doneRef.current)?.focus();
  });

  const nudgeHasFocus = () => !!nudgeRef.current?.contains(document.activeElement);
  const onExtend = () => {
    if (nudgeHasFocus()) refocus.current = true;
    update(extend);
  };
  const onAdvance = (parked: boolean) => {
    const wasLast = snapshot.rows.every((r) => r.state !== "upcoming");
    if (wasLast || nudgeHasFocus()) refocus.current = true;
    update((m) => advance(m, clock.now(), parked));
  };
  const onWrapUp = () => {
    if (!key) return;
    if (nudgeHasFocus()) refocus.current = true;
    setDismissed((d) => new Set(d).add(key));
  };
  const onEnd = () => {
    update((m) => endRun(m, clock.now()));
    // Wrap-up (frame 04) does not exist yet: a new meeting opens in setup.
    startNew();
  };

  return (
    <>
      <TopBar meetingTitle={meeting.title} />
      <main className="live" id="main" data-view={LIVE_VIEW}>
        <h1 className="visually-hidden">{t("live.heading")}</h1>
        <div className="live__left" ref={leftRef}>
          {saveFailed ? (
            <div className="banner banner--error" role="alert">
              {t("store.saveFailed")}
            </div>
          ) : null}
          <TimerCard
            ref={doneRef}
            current={current}
            canExtend={extendable}
            onExtend={onExtend}
            onPark={() => onAdvance(true)}
            onNext={() => onAdvance(false)}
          />
          <LiveAgenda snapshot={snapshot} />
          <OverallLine snapshot={snapshot} />
        </div>
        <div className="live__stage">
          {showNudge && current ? (
            <Nudge
              ref={nudgeRef}
              current={current}
              canExtend={extendable}
              onWrapUp={onWrapUp}
              onExtend={onExtend}
            />
          ) : null}
        </div>
        {/* Last in the view, visually and in tab order. */}
        <div className="live__footer">
          <EndMeeting onEnd={onEnd} />
        </div>
        <div className="visually-hidden" aria-live="polite" data-testid="nudge-announcement">
          {announced.text}
        </div>
      </main>
    </>
  );
}
