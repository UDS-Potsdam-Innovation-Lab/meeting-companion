// Who said what, worked out from the transcript lines and the speaker state the core keeps. Pure
// functions; the core decides what is stored, this only reads it.
import type { SpeakerParticipant, SpeakerState, TranscriptSegment, VoiceLabel } from "../../lib/ipc";

/** The name round: the first two minutes of recorded audio (as in the core). */
export const NAME_ROUND_MS = 120_000;

export const EMPTY_SPEAKERS: SpeakerState = { participants: [], voices: [], lines: [], suggestions: [] };

export interface VoiceSummary {
  voice: VoiceLabel;
  /** Talk time from the voice's final lines, ms. */
  talkMs: number;
  /** Share of all voiced talk time in whole percent; the shares of all voices add up to 100. */
  share: number;
  /** The voice's first final line. Untrusted text. */
  firstText: string;
  /** Each final line's span in recorded time. */
  spans: { startMs: number; endMs: number }[];
}

/** Whole-percent shares of `parts` that add up to exactly 100 (largest remainder). */
export function percentShares(parts: number[]): number[] {
  const total = parts.reduce((a, b) => a + b, 0);
  if (total <= 0) return parts.map(() => 0);
  const exact = parts.map((p) => (p * 100) / total);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, rest: e - Math.floor(e) })).sort((a, b) => b.rest - a.rest);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]! += 1;
    left -= 1;
  }
  return floors;
}

/** One summary per voice heard, in label order. */
export function voiceSummaries(lines: TranscriptSegment[]): VoiceSummary[] {
  const by = new Map<VoiceLabel, VoiceSummary>();
  for (const line of lines) {
    if (!line.final || !line.voice) continue;
    let v = by.get(line.voice);
    if (!v) {
      v = { voice: line.voice, talkMs: 0, share: 0, firstText: line.text, spans: [] };
      by.set(line.voice, v);
    }
    v.talkMs += Math.max(0, line.endMs - line.startMs);
    v.spans.push({ startMs: line.startMs, endMs: line.endMs });
  }
  const list = [...by.values()].sort((a, b) => a.voice.localeCompare(b.voice));
  const shares = percentShares(list.map((v) => v.talkMs));
  list.forEach((v, i) => (v.share = shares[i]!));
  return list;
}

/** Shortens untrusted text to at most `max` characters (whole characters, with an ellipsis). */
export function shorten(text: string, max = 60): string {
  const chars = Array.from(text.trim());
  return chars.length <= max
    ? chars.join("")
    : `${chars
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`;
}

/** What the speakers view shows for a voice. */
export type VoiceStatus =
  | { kind: "confirmed"; person: SpeakerParticipant; source: "nameRound" | "manual" }
  | { kind: "suggested"; person: SpeakerParticipant }
  | { kind: "unsure"; candidates: SpeakerParticipant[] }
  /** `chosen`: a person picked "Unassigned"; otherwise nobody has chosen yet. */
  | { kind: "unassigned"; chosen: boolean };

function person(state: SpeakerState, id: string | null | undefined): SpeakerParticipant | null {
  return (id && state.participants.find((p) => p.id === id)) || null;
}

export function voiceStatus(state: SpeakerState, voice: VoiceLabel): VoiceStatus {
  const choice = state.voices.find((v) => v.voice === voice);
  if (choice) {
    const p = person(state, choice.participantId);
    return p && choice.confirmed
      ? { kind: "confirmed", person: p, source: choice.source }
      : { kind: "unassigned", chosen: true };
  }
  const s = state.suggestions.find((x) => x.voice === voice);
  const candidates = (s?.candidates ?? [])
    .map((id) => person(state, id))
    .filter((p): p is SpeakerParticipant => p !== null);
  if (!s || candidates.length === 0) return { kind: "unassigned", chosen: false };
  if (s.unsure || candidates.length > 1) return { kind: "unsure", candidates };
  return { kind: "suggested", person: candidates[0]! };
}

/** Voices with a confirmed person. */
export function matchedCount(state: SpeakerState, voices: VoiceLabel[]): number {
  return voices.filter((v) => voiceStatus(state, v).kind === "confirmed").length;
}

/** Who is shown for a line: a person (a line choice, or the confirmed person of its voice), its
 * voice (muted, not confirmed), or nobody. A suggestion never shows here. */
export type LineSpeaker =
  | { kind: "person"; person: SpeakerParticipant; viaLine: boolean }
  | { kind: "voice"; voice: VoiceLabel }
  | { kind: "none" };

export function lineSpeaker(state: SpeakerState, line: TranscriptSegment): LineSpeaker {
  const override = line.seq === undefined ? undefined : state.lines.find((l) => l.seq === line.seq);
  if (override) {
    const p = person(state, override.participantId);
    return p ? { kind: "person", person: p, viaLine: true } : { kind: "none" };
  }
  if (!line.voice) return { kind: "none" };
  const status = voiceStatus(state, line.voice);
  return status.kind === "confirmed"
    ? { kind: "person", person: status.person, viaLine: false }
    : { kind: "voice", voice: line.voice };
}

/** Number of distinct voices heard. */
export function voiceCount(lines: TranscriptSegment[]): number {
  return new Set(lines.filter((l) => l.final && l.voice).map((l) => l.voice)).size;
}

/** Voiced lines in the name round: when this count changes, suggestions may change. */
export function nameRoundLines(lines: TranscriptSegment[]): number {
  return lines.filter((l) => l.final && l.voice && l.startMs < NAME_ROUND_MS).length;
}
