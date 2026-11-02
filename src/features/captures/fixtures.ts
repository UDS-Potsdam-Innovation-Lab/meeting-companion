// Sample captures of frames 21, for tests, the e2e build and screenshots (job 018).
import type { Capture, CaptureSuggestion } from "../../lib/ipc";

const at = (h: number, m: number) => new Date(2026, 9, 30, h, m).getTime();

const capture = (c: Partial<Capture> & Pick<Capture, "id" | "kind" | "text" | "createdAt">): Capture => ({
  owner: null,
  due: null,
  itemId: null,
  topicId: null,
  source: "typed",
  ...c,
});

/** Frame 21 "Captures": item 01 has a decision and two to-dos; item 02 (running) nothing yet. */
export const LIVE_CAPTURES: Capture[] = [
  capture({
    id: "c-d1",
    kind: "decision",
    text: "Pilot check-ins are on Thursdays from now on",
    itemId: "i-1",
    createdAt: at(10, 4),
  }),
  capture({
    id: "c-t1",
    kind: "todo",
    text: "Send the invitations for the Thursday check-ins again",
    owner: "p-mk",
    due: "2026-11-09",
    itemId: "i-1",
    createdAt: at(10, 5),
  }),
  capture({
    id: "c-t2",
    kind: "todo",
    text: "Send the feedback form to the three pilot schools",
    owner: "p-ls",
    itemId: "i-1",
    createdAt: at(10, 6),
  }),
];

/** Frame 21o: agenda-free; one decision for "Release notes language", one without a topic, one to-do. */
export const FREE_CAPTURES: Capture[] = [
  capture({
    id: "c-f1",
    kind: "decision",
    text: "Offline mode comes after the beta",
    createdAt: at(10, 2),
  }),
  capture({
    id: "c-f2",
    kind: "todo",
    text: "Ask two schools from the autumn workshop",
    owner: "p-tb",
    topicId: "t-2",
    createdAt: at(10, 18),
  }),
  capture({
    id: "c-f3",
    kind: "decision",
    text: "Release notes in German first, English a week later",
    topicId: "t-3",
    createdAt: at(10, 21),
  }),
];

// ---- capture suggestions (job 019, frames 21g/h/l/f/n/s) ------------------------------------------

/** Who said the lines of `LIVE_TRANSCRIPT` (seq 0–4): Tobias, Lena, Mara, Yusuf, Mara. */
export const SUGGEST_VOICES = ["B", "C", "A", "D", "A"] as const;

/** The people of those voices, as the speakers view stores them. */
export const SUGGEST_SPEAKERS = {
  voices: [
    { voice: "A", participantId: "p-mk", source: "manual" as const, confirmed: true },
    { voice: "B", participantId: "p-tb", source: "manual" as const, confirmed: true },
    { voice: "C", participantId: "p-ls", source: "manual" as const, confirmed: true },
    { voice: "D", participantId: "p-ya", source: "manual" as const, confirmed: true },
  ],
  lines: [],
};

const at3 = (h: number, m: number, s: number) => new Date(2026, 9, 30, h, m, s).getTime();

/** Frame 21g: the decision Mara's line at 10:11 suggests. */
export const SUGGEST_DECISION: CaptureSuggestion = {
  id: "s-decision",
  kind: "decision",
  text: "Beta launches on 14 Nov without offline mode",
  owner: null,
  segments: [2],
  createdAt: at3(10, 11, 20),
};

/** Frame 21g/h: the to-do of Mara's line at 10:12, with Yusuf as the suggested owner. */
export const SUGGEST_TODO: CaptureSuggestion = {
  id: "s-todo",
  kind: "todo",
  text: "Write to the third pilot school this week that offline mode comes later",
  owner: "p-ya",
  segments: [4],
  createdAt: at3(10, 12, 30),
};

/** Frame 21s "Waiting behind": a second decision from the first lines. */
export const SUGGEST_DECISION_2: CaptureSuggestion = {
  id: "s-decision-2",
  kind: "decision",
  text: "The launch moves from the 7th to the 14th",
  owner: null,
  segments: [0, 1],
  createdAt: at3(10, 11, 50),
};

/** Frame 21h: the decision of 10:11, confirmed ("festgehalten" on its line). */
export const CONFIRMED_DECISION: Capture = capture({
  id: "c-s1",
  kind: "decision",
  text: "Beta launches on 14 Nov without offline mode",
  itemId: "i-2",
  source: "suggested",
  segments: [2],
  createdAt: at3(10, 11, 30),
});

/** Frame 21f: many captures under the pinned suggestion. */
export const MANY_CAPTURES: Capture[] = [
  ...LIVE_CAPTURES,
  ...[
    "Pilot schools get the beta build on Monday",
    "Feedback goes into one shared board",
    "Teachers can opt out of telemetry",
    "We keep the weekly sync at 10:00",
    "Support answers within one school day",
    "The beta runs until the end of January",
    "Release notes link the help pages",
  ].map((text, i) =>
    capture({ id: `c-m${i}`, kind: "decision", text, itemId: "i-1", createdAt: at(10, 7) + i * 1_000 }),
  ),
];
