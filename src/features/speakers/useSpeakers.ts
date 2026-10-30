import { useCallback, useEffect, useState } from "react";
import {
  addGuest as addGuestCommand,
  applyNameRound,
  chooseLine as chooseLineCommand,
  chooseVoice as chooseVoiceCommand,
  listSpeakerModels,
  loadSpeakers,
  type LineTarget,
  type SpeakerError,
  type SpeakerModelList,
  type SpeakerState,
  type TranscriptSegment,
  type VoiceLabel,
} from "../../lib/ipc";
import { EMPTY_SPEAKERS, nameRoundLines } from "./model";

export interface Speakers {
  state: SpeakerState;
  /** The speaker models found; null while the core is asked. */
  models: SpeakerModelList | null;
  /** The last choice could not be stored. */
  failed: boolean;
  chooseVoice: (voice: VoiceLabel, participantId: string | null) => Promise<void>;
  chooseLine: (seq: number, target: LineTarget) => Promise<void>;
  /** Adds a guest; resolves with the guest's id, or rejects with the {@link SpeakerError}. */
  addGuest: (name: string) => Promise<string>;
  applyNames: () => Promise<void>;
}

/**
 * The speakers of the live meeting: people, choices and name-round suggestions from the core, asked
 * again whenever a voiced line of the name round arrives. Every change goes through a core command,
 * which checks it and stores it; the state shown is what the core returned.
 */
export function useSpeakers(meetingId: string, lines: TranscriptSegment[]): Speakers {
  const [state, setState] = useState<SpeakerState>(EMPTY_SPEAKERS);
  const [models, setModels] = useState<SpeakerModelList | null>(null);
  const [failed, setFailed] = useState(false);
  const inRound = nameRoundLines(lines);

  useEffect(() => {
    let cancelled = false;
    void loadSpeakers(meetingId).then(
      (s) => !cancelled && setState(s),
      () => {
        // Nothing to show yet; the transcript works without it.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [meetingId, inRound]);

  useEffect(() => {
    let cancelled = false;
    void listSpeakerModels().then((m) => !cancelled && setModels(m));
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(async (command: () => Promise<SpeakerState>) => {
    try {
      setState(await command());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  const chooseVoice = useCallback(
    (voice: VoiceLabel, participantId: string | null) =>
      run(() => chooseVoiceCommand(meetingId, voice, participantId)),
    [run, meetingId],
  );
  const chooseLine = useCallback(
    (seq: number, target: LineTarget) => run(() => chooseLineCommand(meetingId, seq, target)),
    [run, meetingId],
  );
  const applyNames = useCallback(() => run(() => applyNameRound(meetingId)), [run, meetingId]);
  const addGuest = useCallback(
    async (name: string) => {
      const added = await addGuestCommand(meetingId, name).catch((e: SpeakerError) => {
        if (e.kind !== "invalidName") setFailed(true);
        throw e;
      });
      setState(added.state);
      setFailed(false);
      return added.participantId;
    },
    [meetingId],
  );

  return { state, models, failed, chooseVoice, chooseLine, addGuest, applyNames };
}
