import type { Meeting } from "./model";

// Sample data from frame 01, used by tests, the e2e build and screenshots.
export const FIXTURE_PARTICIPANTS = [
  { id: "p-mk", name: "Mara Klein" },
  { id: "p-tb", name: "Tobias Brandt" },
  { id: "p-ls", name: "Lena Sommer" },
  { id: "p-ya", name: "Yusuf Aydin" },
  { id: "p-jr", name: "Jana Roth" },
];

export function filledMeeting(): Meeting {
  return {
    version: 1,
    id: "fixture-filled",
    title: "Product sync · Beta launch",
    date: "2026-10-30",
    start: "10:00",
    end: "11:00",
    participants: FIXTURE_PARTICIPANTS.map((p) => ({ ...p })),
    items: [
      { id: "i-1", title: "Check-in & goals", outcome: "", lead: "p-mk", goal: "inform", minutes: 5 },
      {
        id: "i-2",
        title: "Beta launch: scope and date",
        outcome: "a launch date everyone commits to",
        lead: "p-tb",
        goal: "decide",
        minutes: 15,
      },
      {
        id: "i-3",
        title: "Pilot schools: feedback so far",
        outcome: "",
        lead: "p-ls",
        goal: "discuss",
        minutes: 15,
      },
      {
        id: "i-4",
        title: "Budget for Q1 user research",
        outcome: "",
        lead: "p-ya",
        goal: "decide",
        minutes: 10,
      },
      {
        id: "i-5",
        title: "Open questions & next steps",
        outcome: "",
        lead: "p-mk",
        goal: "discuss",
        minutes: 10,
      },
    ],
    updatedAt: 1,
  };
}

export function overBudgetMeeting(): Meeting {
  const m = filledMeeting();
  m.id = "fixture-over";
  m.items = m.items.map((it) => (it.id === "i-3" ? { ...it, minutes: 30 } : it));
  return m;
}

// ---- live meeting (frame 02) --------------------------------------------------------------------

const at = (h: number, m: number, s = 0) => new Date(2026, 9, 30, h, m, s).getTime();

/**
 * Fixed clock times (local time on the fixture date) for the live fixtures. The live meeting
 * started at 10:00; item 01 ran 6 of 5 min, item 02 started at 10:06.
 */
export const LIVE_TIMES = {
  start: at(10, 0),
  item2Start: at(10, 6),
  /** 79 % of item 02's 15 min: 3:12 left, as in the frame. */
  running: at(10, 17, 48),
  /** 80 %: the nudge appears. */
  nudge: at(10, 18, 0),
  /** 2:10 over. */
  over: at(10, 23, 10),
  /** After the last item ended. */
  done: at(10, 58, 0),
} as const;

/** Frame 02: item 01 done (6 of 5 min), item 02 running. */
export function liveMeeting(): Meeting {
  const m = filledMeeting();
  m.id = "fixture-live";
  m.run = {
    startedAt: LIVE_TIMES.start,
    endedAt: null,
    items: [
      {
        itemId: "i-1",
        startedAt: LIVE_TIMES.start,
        endedAt: LIVE_TIMES.item2Start,
        extraMinutes: 0,
        parked: false,
      },
      { itemId: "i-2", startedAt: LIVE_TIMES.item2Start, endedAt: null, extraMinutes: 0, parked: false },
    ],
  };
  return m;
}

/** Every item ended; item 03 was parked after 4 min, item 02 got +5 min. */
export function liveDoneMeeting(): Meeting {
  const m = filledMeeting();
  m.id = "fixture-live-done";
  const t = (h: number, min: number) => at(h, min);
  m.run = {
    startedAt: t(10, 0),
    endedAt: null,
    items: [
      { itemId: "i-1", startedAt: t(10, 0), endedAt: t(10, 6), extraMinutes: 0, parked: false },
      { itemId: "i-2", startedAt: t(10, 6), endedAt: t(10, 24), extraMinutes: 5, parked: false },
      { itemId: "i-3", startedAt: t(10, 24), endedAt: t(10, 28), extraMinutes: 0, parked: true },
      { itemId: "i-4", startedAt: t(10, 28), endedAt: t(10, 39), extraMinutes: 0, parked: false },
      { itemId: "i-5", startedAt: t(10, 39), endedAt: t(10, 48), extraMinutes: 0, parked: false },
    ],
  };
  return m;
}

// ---- transcript (frame 02 centre) ---------------------------------------------------------------

/** `liveMeeting()` with the recording consent confirmed at 10:01. */
export function liveConsentedMeeting(): Meeting {
  const m = liveMeeting();
  m.recordingConsentAt = at(10, 1);
  return m;
}

const line = (h: number, m: number, s: number, text: string, lang: "de" | "en") => {
  const startMs = (h * 3600 + m * 60 + s - (10 * 3600 + 60)) * 1000;
  return { startMs, endMs: startMs + 4_000, at: at(h, m, s), text, lang, final: true };
};

/** Final lines of the frame (without speakers), German and English mixed. Recorded since 10:01. */
export const LIVE_TRANSCRIPT = [
  line(
    10,
    9,
    5,
    "If we keep the offline mode in scope, we can't make the 7th. Realistically it's the 14th.",
    "en",
  ),
  line(
    10,
    10,
    12,
    "Die Pilotschulen brauchen offline nicht für die Beta. Zwei von dreien haben stabiles WLAN in den Klassenräumen.",
    "de",
  ),
  line(10, 11, 3, "Then let's cut offline from the beta and go with the 14th. Any objections?", "en"),
  line(10, 11, 40, "Passt für mich, solange wir die dritte Schule früh informieren.", "de"),
  line(10, 12, 18, "Okay. Yusuf, can you write to them this week?", "en"),
];

/** The line being spoken in the frame. */
export const LIVE_PARTIAL = {
  ...line(10, 12, 50, "And the release notes for the schools, should those go out in German only or", "en"),
  final: false,
};

/** Recorded time at `LIVE_TIMES.running` (recording since 10:01, no pause): 16:48. */
export const LIVE_ELAPSED_MS = (16 * 60 + 48) * 1000;

// ---- speakers (frame 06, job 004) ---------------------------------------------------------------

const voiced = (
  h: number,
  m: number,
  s: number,
  voice: string | null,
  seconds: number,
  text: string,
  lang: "de" | "en" = "en",
) => {
  const l = line(h, m, s, text, lang);
  return { ...l, endMs: l.startMs + seconds * 1000, voice };
};

/**
 * Final lines with voices, recorded since 10:01: a name round in the first two minutes (A says
 * Mara's name, B Tobias's, C Lena's, D both Yusuf's and Jana's, E nobody's), then the discussion.
 */
export const SPEAKER_TRANSCRIPT = [
  voiced(10, 1, 5, "A", 6, "Okay. Let's start with a quick check-in. I'm Mara Klein."),
  voiced(10, 1, 14, "B", 5, "Tobias Brandt, I keep the notes today."),
  voiced(10, 1, 22, "C", 5, "Lena hier, ich bringe das Feedback der Pilotschulen mit.", "de"),
  voiced(10, 1, 30, "D", 4, "Hi, this is Yusuf. Jana sends her regards."),
  voiced(10, 1, 38, "E", 4, "Hi, I'm from the district office, just listening."),
  voiced(
    10,
    9,
    5,
    "B",
    9,
    "If we keep the offline mode in scope, we can't make the 7th. Realistically it's the 14th.",
  ),
  voiced(
    10,
    10,
    12,
    "C",
    10,
    "Die Pilotschulen brauchen offline nicht für die Beta. Zwei von dreien haben stabiles WLAN.",
    "de",
  ),
  voiced(10, 11, 3, "A", 7, "Then let's cut offline from the beta and go with the 14th. Any objections?"),
  voiced(10, 11, 40, "D", 6, "Fine with me, as long as we tell the third school early."),
  voiced(10, 12, 2, null, 1, "Same here."),
  voiced(10, 12, 18, "A", 5, "Okay. Yusuf, can you write to them this week?"),
];

/** Choices stored for the `speakers` fixture: A by the name round, B by hand. */
export const SPEAKER_CHOICES = {
  voices: [
    { voice: "A", participantId: "p-mk", source: "nameRound" as const, confirmed: true },
    { voice: "B", participantId: "p-tb", source: "manual" as const, confirmed: true },
  ],
  lines: [] as { seq: number; participantId: string | null }[],
};

/** `live-speakers`: names on the live transcript, and one line ("Same here.") set to Jana by hand. */
export const LIVE_SPEAKER_CHOICES = {
  voices: [
    ...SPEAKER_CHOICES.voices,
    { voice: "C", participantId: "p-ls", source: "nameRound" as const, confirmed: true },
  ],
  lines: [{ seq: 9, participantId: "p-jr" }],
};
