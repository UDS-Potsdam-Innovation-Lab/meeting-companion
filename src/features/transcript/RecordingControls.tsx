import { useI18n } from "../../i18n";
import type { CaptureState } from "../../lib/ipc";
import { PauseIcon, PlayIcon } from "../../ui/icons";
import { formatElapsed } from "./format";

interface Props {
  capture: CaptureState;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  /** Only the REC chip (the speakers view's top bar). */
  chipOnly?: boolean;
}

/**
 * Frame 02 top bar: the REC chip (red dot, "REC" and the recorded time, so the state is not shown by
 * colour alone), the "On-device · DE/EN" chip, and "Pause" / "Resume". The chip follows the core's
 * capture state: shown while recording or paused, gone when recording is off or failed.
 */
export function RecordingControls({ capture, busy, onPause, onResume, chipOnly = false }: Props) {
  const { t } = useI18n();
  const recording = capture.state === "recording";
  const paused = capture.state === "paused";
  const time = formatElapsed(capture.elapsedMs);
  return (
    <div className="rec-controls">
      {recording || paused ? (
        <span className={`rec-chip${paused ? " rec-chip--paused" : ""}`} data-testid="rec-chip">
          {recording ? <span className="rec-chip__dot" aria-hidden="true" /> : null}
          <span className="rec-chip__label">{recording ? t("recording.rec") : t("recording.paused")}</span>
          <span className="rec-chip__time">{time}</span>
        </span>
      ) : null}
      {chipOnly ? null : <span className="device-chip">{t("recording.onDevice")}</span>}
      {!chipOnly && (recording || paused) ? (
        // One button that changes its label, so focus stays on it across Pause and Resume.
        <button
          type="button"
          className="button button--outline button--small"
          onClick={recording ? onPause : onResume}
          disabled={busy}
          data-rec-action=""
        >
          {recording ? <PauseIcon /> : <PlayIcon />}
          {recording ? t("recording.pause") : t("recording.resume")}
        </button>
      ) : null}
    </div>
  );
}
