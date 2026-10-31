import { describe, expect, it } from "vitest";
import type { SpeakerState, TranscriptSegment } from "../../lib/ipc";
import { FIXTURE_PARTICIPANTS, SPEAKER_CHOICES, SPEAKER_TRANSCRIPT } from "../agenda/fixtures";
import {
  lineSpeaker,
  matchedCount,
  percentShares,
  shorten,
  voiceCount,
  voiceStatus,
  voiceSummaries,
} from "./model";

const lines: TranscriptSegment[] = SPEAKER_TRANSCRIPT.map((l, seq) => ({ ...l, seq }));

const state: SpeakerState = {
  participants: FIXTURE_PARTICIPANTS,
  voices: SPEAKER_CHOICES.voices,
  lines: [{ seq: 9, participantId: "p-jr" }],
  suggestions: [
    { voice: "C", candidates: ["p-ls"], unsure: false },
    { voice: "D", candidates: ["p-ya", "p-jr"], unsure: true },
  ],
};

describe("AC3 voice summaries", () => {
  it("talk-time shares come from final line durations and add up to 100", () => {
    const v = voiceSummaries(lines);
    expect(v.map((x) => x.voice)).toEqual(["A", "B", "C", "D", "E"]);
    expect(v[0]!.talkMs).toBe(6_000 + 7_000 + 5_000);
    expect(v.reduce((a, x) => a + x.share, 0)).toBe(100);
    expect(v[0]!.firstText).toBe("Okay. Let's start with a quick check-in. I'm Mara Klein.");
    expect(v[3]!.spans).toHaveLength(2);
    expect(voiceCount(lines)).toBe(5);
    for (const parts of [[1, 1, 1], [5, 3, 2, 7, 1], [0, 4], [], [10, 10, 10, 10, 10, 10, 10]]) {
      const shares = percentShares(parts);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(parts.some((p) => p > 0) ? 100 : 0);
    }
  });

  it("shortens long lines on whole characters", () => {
    expect(shorten("short")).toBe("short");
    const s = shorten("ä".repeat(100), 10);
    expect(Array.from(s)).toHaveLength(10);
    expect(s.endsWith("…")).toBe(true);
  });
});

describe("AC4/AC5 who is shown", () => {
  it("each voice is confirmed, suggested, unsure or unassigned; only confirmed ones count as matched", () => {
    expect(voiceStatus(state, "A")).toMatchObject({
      kind: "confirmed",
      source: "nameRound",
      person: { id: "p-mk" },
    });
    expect(voiceStatus(state, "B")).toMatchObject({ kind: "confirmed", source: "manual" });
    expect(voiceStatus(state, "C")).toMatchObject({ kind: "suggested", person: { id: "p-ls" } });
    expect(voiceStatus(state, "D")).toMatchObject({ kind: "unsure" });
    expect(voiceStatus(state, "E")).toEqual({ kind: "unassigned", chosen: false });
    const unassigned = {
      ...state,
      voices: [{ voice: "E", participantId: null, source: "manual" as const, confirmed: true }],
    };
    expect(voiceStatus(unassigned, "E")).toEqual({ kind: "unassigned", chosen: true });
    expect(matchedCount(state, ["A", "B", "C", "D", "E"])).toBe(2);
  });

  it("lines show the confirmed person of their voice, also earlier ones; a suggestion never shows", () => {
    expect(lineSpeaker(state, lines[0]!)).toMatchObject({ kind: "person", person: { name: "Mara Klein" } });
    expect(lineSpeaker(state, lines[10]!)).toMatchObject({ kind: "person", person: { name: "Mara Klein" } });
    // C has a suggestion only: the line reads "Voice C".
    expect(lineSpeaker(state, lines[2]!)).toEqual({ kind: "voice", voice: "C" });
    // A line choice wins over the voice, for that line only.
    expect(lineSpeaker(state, lines[9]!)).toMatchObject({
      kind: "person",
      person: { id: "p-jr" },
      viaLine: true,
    });
    const nobody = { ...state, lines: [{ seq: 0, participantId: null }] };
    expect(lineSpeaker(nobody, lines[0]!)).toEqual({ kind: "none" });
    expect(lineSpeaker(nobody, lines[10]!)).toMatchObject({ kind: "person" });
    // No voice and no choice: nobody.
    expect(lineSpeaker({ ...state, lines: [] }, lines[9]!)).toEqual({ kind: "none" });
  });
});
