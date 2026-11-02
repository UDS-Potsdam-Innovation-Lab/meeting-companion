// Sample captures of frames 21, for tests, the e2e build and screenshots (job 018).
import type { Capture } from "../../lib/ipc";

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
