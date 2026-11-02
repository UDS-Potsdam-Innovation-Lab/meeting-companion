import { useCallback, useEffect, useRef, useState } from "react";
import { TopBar } from "../../app/TopBar";
import { useI18n } from "../../i18n";
import { useClock, useNow } from "../../lib/clock";
import { isFree, type Meeting } from "../agenda/model";
import type { MeetingState } from "../agenda/useMeeting";
import { EndMeeting } from "./EndMeeting";
import { addTopic, canAddTopic, freeSnapshot, halfTimeKey, tapTopic } from "./free";
import { FreeTimerCard } from "./FreeTimerCard";
import { HalfTimeNudge, halfTimeText } from "./HalfTimeNudge";
import { TopicsCard } from "./TopicsCard";
import { LiveAgenda, OverallLine } from "./LiveAgenda";
import { Nudge, nudgeTitle } from "./Nudge";
import { advance, canExtend, endRun, extend, liveSnapshot, nudgeDue, nudgeKey } from "./run";
import { TimerCard } from "./TimerCard";
import { RecordingControls } from "../transcript/RecordingControls";
import { AT_BOTTOM, TranscriptPanel, type FeedScroll } from "../transcript/TranscriptPanel";
import { useRecording } from "../transcript/useRecording";
import { SpeakersView } from "../speakers/SpeakersView";
import { useSpeakers } from "../speakers/useSpeakers";
import type { Capture, CaptureSuggestion, CaptureType } from "../../lib/ipc";
import { NARROW_LIVE_QUERY, useMediaQuery } from "../../lib/media";
import {
  CaptureList,
  CapturesColumn,
  CaptureTabs,
  Composer,
  savedAnnouncement,
  UndoNotice,
} from "../captures/CapturesPanel";
import { countByKind, countByTarget, currentTarget } from "../captures/model";
import { useCaptures } from "../captures/useCaptures";
import { KIND_KEYS } from "../captures/labels";
import { SuggestionPin, type LineSource } from "../captures/SuggestionCard";
import { CloudSuggestChip, SuggestionStatusLine } from "../captures/SuggestionStatus";
import { lineMarks, pendingKinds, suggestStatus, tabSuggestions } from "../captures/suggestions";
import { useSuggestions } from "../captures/useSuggestions";
import { useSettings } from "../settings/useSettings";
import type { Section } from "../settings/SettingsView";
import { lineSpeaker } from "../speakers/model";

export const LIVE_VIEW = "live";

interface Props {
  /** The running meeting (`state.meeting`, narrowed). Mount with `key={meeting.id}`. */
  meeting: Meeting;
  state: MeetingState;
  onOpenSettings: () => void;
  /** Opens the settings at one section ("Sprachmodell wählen" → the language model). */
  onOpenSettingsAt?: (section: Section) => void;
  /** The settings view covers this one; recording and the transcript carry on underneath. */
  hidden?: boolean;
}

/**
 * Frame 02 "Live meeting": top bar with the recording indicator, the left column (timer, agenda,
 * parking lot, overall line), the centre column (transcript), the time nudge over it and "End meeting"
 * at the bottom right, and the right column with the captures (job 018: tabs, cards, quick capture). Below
 * 1200 px the captures are a second tab of the centre card, with the composer stuck to the bottom.
 *
 * An agenda-free meeting (frame 16) has the same top bar (plus "Free mode"), centre column and
 * recording; its left column is the whole-meeting timer and "Topics so far", and its nudge comes at
 * half time.
 */
export function LiveView({ meeting, state, onOpenSettings, onOpenSettingsAt, hidden = false }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const clock = useClock();
  const now = useNow();
  const { update, startNew, saveFailed } = state;
  const run = meeting.run!;
  const free = isFree(meeting);
  const snapshot = liveSnapshot(meeting, run, now);
  const freeSnap = free ? freeSnapshot(meeting, run, now) : null;
  const title = free ? t("free.title", { title: meeting.title }) : meeting.title;
  const { current } = snapshot;
  const extendable = canExtend(meeting);
  const onConsent = useCallback((at: number) => update((m) => ({ ...m, recordingConsentAt: at })), [update]);
  const recording = useRecording(meeting.id, onConsent);
  const speakers = useSpeakers(meeting.id, recording.lines);

  // Captures (job 018): the open kind tab is also the composer's kind. A capture is announced once,
  // through the polite live region below, after the core wrote it.
  const [captureKind, setCaptureType] = useState<CaptureType>("decision");
  const [captureSaid, setCaptureSaid] = useState({ text: "", n: 0 });
  const onCaptureSaved = useCallback(
    (c: Capture) => setCaptureSaid((s) => ({ text: savedAnnouncement(i18n, meeting, c), n: s.n + 1 })),
    [i18n, meeting],
  );
  // Capture suggestions (job 019): read from the core, pinned one per tab, announced once, never focused
  // on their own. The status line says where the transcript text goes.
  const { settings } = useSettings();
  const onSuggestion = useCallback(
    (s: CaptureSuggestion) =>
      setCaptureSaid((x) => ({
        text: t("captures.suggest.announce", { kind: t(KIND_KEYS[s.kind]) }),
        n: x.n + 1,
      })),
    [t],
  );
  const suggestions = useSuggestions(meeting.id, onSuggestion);
  const captures = useCaptures(meeting.id, onCaptureSaved, suggestions.refresh);
  const suggest = suggestStatus(settings.languageModel, suggestions.error);
  const marks = lineMarks(suggestions.pending, captures.captures);
  const pinnedNow = tabSuggestions(suggestions.pending, captureKind, suggestions.front)[0];
  const highlight = new Set(pinnedNow?.segments ?? []);
  const cloudChip = settings.languageModel === "claude" && recording.capture.state === "recording";
  const captureTarget = currentTarget(meeting);
  const captureCounts = countByTarget(captures.captures);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const focusComposer = useCallback(() => composerRef.current?.focus(), []);
  const narrow = useMediaQuery(NARROW_LIVE_QUERY);
  const [centreCaptures, setCentreCaptures] = useState(false);
  // Opening "Captured" on a narrow window brings the card up, so the list is in view at once (21k).
  const centreShown = useRef(false);
  useEffect(() => {
    if (!narrow || !centreCaptures) {
      centreShown.current = false;
      return;
    }
    if (centreShown.current) return;
    centreShown.current = true;
    viewRef.current?.querySelector(".transcript-card")?.scrollIntoView?.({ block: "start" });
  }, [narrow, centreCaptures]);
  // One column: the nudge sticks above the composer, which sticks to the bottom; CSS needs its height.
  const composerBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = composerBox.current;
    const live = box?.closest<HTMLElement>(".live");
    if (!box || !live || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      live.style.setProperty("--composer-height", `${box.offsetHeight}px`),
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [narrow]);

  // Frame 06 opens in place of the live view, in the same window; recording goes on. Back returns to
  // the transcript where the reader left it, with focus on the button that opened the speakers.
  const [showSpeakers, setShowSpeakers] = useState(false);
  const [feedScroll, setFeedScroll] = useState<FeedScroll | null>(null);
  const openSpeakers = () => {
    const feed = viewRef.current?.querySelector<HTMLElement>(".transcript-feed");
    setFeedScroll(
      feed
        ? { top: feed.scrollTop, pinned: feed.scrollHeight - feed.scrollTop - feed.clientHeight <= AT_BOTTOM }
        : null,
    );
    setShowSpeakers(true);
  };
  const speakersHeading = useRef<HTMLHeadingElement>(null);
  const backFocus = useRef(false);
  useEffect(() => {
    if (showSpeakers) speakersHeading.current?.focus();
    else if (backFocus.current) {
      backFocus.current = false;
      viewRef.current?.querySelector<HTMLButtonElement>("[data-speakers-button]")?.focus();
    }
  }, [showSpeakers]);

  // When a recording control the user was on disappears with the state change it caused (Start
  // recording, Pause on a device error), focus moves to the control that now applies instead of being
  // lost. Nothing is focused on page load.
  const viewRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<Element | null>(null);
  const captureState = recording.capture.state;
  useEffect(() => {
    const view = viewRef.current;
    const track = (e: FocusEvent) => {
      lastFocused.current = e.target as Element;
    };
    view?.addEventListener("focusin", track);
    return () => view?.removeEventListener("focusin", track);
  }, []);
  useEffect(() => {
    const was = lastFocused.current;
    const active = document.activeElement;
    if (!was || (active && active !== document.body)) return;
    if (was.isConnected && !(was as HTMLButtonElement).disabled) return;
    viewRef.current?.querySelector<HTMLButtonElement>("[data-rec-action]:not(:disabled)")?.focus();
  }, [captureState, recording.busy]);

  // A tap on a transcript chip opens its kind's tab (the centre card's "Captured" tab when narrow) with
  // its card in front, and focus moves there. "›" on a card shows its source line in the transcript.
  const onMark = (id: string) => {
    const s = suggestions.pending.find((p) => p.id === id);
    if (!s) return;
    setCaptureType(s.kind);
    if (narrow) setCentreCaptures(true);
    suggestions.bringForward(id);
  };
  const onShowLine = (seq: number) => {
    if (narrow) setCentreCaptures(false);
    setTimeout(() => {
      const line = viewRef.current?.querySelector<HTMLElement>(`.transcript-line[data-seq="${seq}"]`);
      line?.scrollIntoView?.({ block: "center" });
      line?.querySelector<HTMLButtonElement>(".line-speaker")?.focus();
    }, 0);
  };
  const sourceOf = (seq: number): LineSource | null => {
    const line = recording.lines.find((l) => l.seq === seq);
    if (!line) return null;
    const who = lineSpeaker(speakers.state, line);
    const name =
      who.kind === "person"
        ? who.person.name
        : who.kind === "voice"
          ? t("speakers.voice", { voice: who.voice })
          : null;
    return { name, at: line.at };
  };
  const pin = (
    <SuggestionPin
      meeting={meeting}
      kind={captureKind}
      captures={captures}
      suggestions={suggestions}
      target={captureTarget}
      sourceOf={sourceOf}
      onShowLine={onShowLine}
      onEmpty={focusComposer}
    />
  );
  const statusLine = (
    <SuggestionStatusLine
      status={suggest}
      onChooseModel={() => (onOpenSettingsAt ?? onOpenSettings)("llm")}
    />
  );
  const suggested = pendingKinds(suggestions.pending);

  // Nudge: shown from 80 % of the current budget until "Wrap up", "+5 min" or the item ends; at most
  // once per item and budget. Dismissals last for this session.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const key = current ? nudgeKey(current) : null;
  const showNudge = !free && current !== null && key !== null && nudgeDue(current) && !dismissed.has(key);

  // Half-time nudge of an agenda-free meeting: from 50 % of the time available, at most once per run
  // while the view is open. Dismissing it lasts for this session.
  const halfKey = halfTimeKey(run);
  const [halfDismissed, setHalfDismissed] = useState(false);
  const showHalf = !!freeSnap?.halfTimeDue && !halfDismissed;

  // Announced once per nudge through the polite live region, which always exists. The text is set
  // when a nudge appears (state adjusted during render), not on every change of its countdown.
  const [announced, setAnnounced] = useState<{ key: string | null; text: string }>({ key: null, text: "" });
  const visibleKey = showNudge ? key : showHalf ? halfKey : null;
  if (visibleKey !== announced.key) {
    let text = "";
    if (showNudge && current) text = `${nudgeTitle(i18n, current)} ${t("nudge.body")}`;
    else if (showHalf && freeSnap) text = halfTimeText(i18n, freeSnap).announcement;
    setAnnounced({ key: visibleKey, text });
    // The newer message wins: a nudge replaces a capture's announcement.
    if (text) setCaptureSaid((s) => ({ text: "", n: s.n }));
  }
  // Two saves with the same words still change the region (a no-break space every other time).
  const liveText = captureSaid.text ? captureSaid.text + (captureSaid.n % 2 ? "" : "\u00a0") : announced.text;

  // Focus: when the last item ends, move to "Agenda done"; when the nudge closes while it had focus,
  // move to "Next ›" (or "Agenda done") instead of losing it.
  const doneRef = useRef<HTMLHeadingElement>(null);
  const nudgeRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const next = leftRef.current?.querySelector<HTMLButtonElement>(
      '[data-action="next"], [data-action="add-topic"]:not(:disabled)',
    );
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
  const onDismissHalf = () => {
    if (nudgeHasFocus()) refocus.current = true;
    setHalfDismissed(true);
  };
  const onAddTopic = (topicTitle: string) => update((m) => addTopic(m, topicTitle, clock.now()));
  const onTapTopic = (id: string) => update((m) => tapTopic(m, id, clock.now()));
  const ended = useRef(false);
  const onEnd = () => {
    if (ended.current) return;
    ended.current = true;
    // The meeting ends at once. Capture stops in the background: the core closes the microphone
    // first, and saving the ended run stops it as well. A slow or failed stop changes nothing here.
    void recording.stop();
    update((m) => endRun(m, clock.now()));
    // Wrap-up (frame 04) does not exist yet: a new meeting opens in setup.
    startNew();
  };

  if (showSpeakers) {
    return (
      <div className="live-view" ref={viewRef}>
        <TopBar
          meetingTitle={title}
          actions={
            <>
              <RecordingControls
                capture={recording.capture}
                busy={recording.busy}
                onPause={() => void recording.pause()}
                onResume={() => void recording.start()}
                chipOnly
              />
              <button
                type="button"
                className="button button--outline button--small"
                onClick={() => {
                  backFocus.current = true;
                  setShowSpeakers(false);
                }}
              >
                {t("speakers.back")}
              </button>
            </>
          }
        />
        <SpeakersView ref={speakersHeading} lines={recording.lines} speakers={speakers} />
      </div>
    );
  }

  return (
    <div className="live-view" ref={viewRef}>
      <TopBar
        meetingTitle={title}
        onOpenSettings={onOpenSettings}
        actions={
          <>
            {free ? <span className="mode-chip">{t("free.chip")}</span> : null}
            {cloudChip ? <CloudSuggestChip /> : null}
            <RecordingControls
              capture={recording.capture}
              busy={recording.busy}
              onPause={() => void recording.pause()}
              onResume={() => void recording.start()}
            />
          </>
        }
      />
      <main
        className="live"
        id="main"
        data-view={LIVE_VIEW}
        data-mode={free ? "free" : "agenda"}
        data-centre={narrow && centreCaptures ? "captures" : "transcript"}
      >
        <h1 className="visually-hidden">{t("live.heading")}</h1>
        <div className="live__left" ref={leftRef}>
          {saveFailed ? (
            <div className="banner banner--error" role="alert">
              {t("store.saveFailed")}
            </div>
          ) : null}
          {freeSnap ? (
            <>
              <FreeTimerCard snapshot={freeSnap} />
              <TopicsCard
                topics={freeSnap.topics}
                counts={captureCounts}
                canAdd={canAddTopic(meeting)}
                onAdd={onAddTopic}
                onTap={onTapTopic}
              />
            </>
          ) : (
            <>
              <TimerCard
                ref={doneRef}
                current={current}
                canExtend={extendable}
                onExtend={onExtend}
                onPark={() => onAdvance(true)}
                onNext={() => onAdvance(false)}
              />
              <LiveAgenda snapshot={snapshot} counts={captureCounts} />
              <OverallLine snapshot={snapshot} />
            </>
          )}
        </div>
        <div className="live__centre">
          <TranscriptPanel
            recording={recording}
            consented={!!meeting.recordingConsentAt}
            speakers={speakers}
            onOpenSpeakers={openSpeakers}
            initialScroll={feedScroll}
            onOpenSettings={onOpenSettings}
            hidden={hidden}
            marks={marks}
            highlight={highlight}
            onMark={onMark}
            tabs={
              narrow
                ? {
                    showCaptures: centreCaptures,
                    onShow: setCentreCaptures,
                    count: captures.captures.length,
                    panel: (
                      <div className="captures-column captures-column--narrow" data-testid="captures-column">
                        <CaptureTabs
                          counts={countByKind(captures.captures)}
                          kind={captureKind}
                          onKind={setCaptureType}
                          suggested={suggested}
                        />
                        <CaptureList
                          meeting={meeting}
                          captures={captures}
                          kind={captureKind}
                          target={captureTarget}
                          onDeleted={focusComposer}
                          top={pin}
                        />
                      </div>
                    ),
                  }
                : undefined
            }
          />
        </div>
        {narrow ? (
          <div className="live__composer" ref={composerBox}>
            <UndoNotice meeting={meeting} captures={captures} onGone={focusComposer} />
            <Composer
              ref={composerRef}
              meeting={meeting}
              captures={captures}
              kind={captureKind}
              onKind={setCaptureType}
              target={captureTarget}
            />
            {statusLine}
          </div>
        ) : (
          <div className="live__right">
            <CapturesColumn
              meeting={meeting}
              captures={captures}
              kind={captureKind}
              onKind={setCaptureType}
              target={captureTarget}
              composerRef={composerRef}
              pin={pin}
              status={statusLine}
              suggested={suggested}
            />
          </div>
        )}
        <div className="live__stage">
          {showHalf && freeSnap ? (
            <HalfTimeNudge ref={nudgeRef} snapshot={freeSnap} onDismiss={onDismissHalf} />
          ) : null}
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
          {liveText}
        </div>
      </main>
    </div>
  );
}
