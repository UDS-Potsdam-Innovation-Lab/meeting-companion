import type { ReactNode } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { useSettings } from "../settings/useSettings";
import type { CaptureState } from "../../lib/ipc";
import { PauseIcon, PlayIcon } from "../../ui/icons";
import { formatElapsed } from "./format";

interface Props {
  capture: CaptureState;
  busy?: boolean;
  /** Without these, only the chips are shown (settings view). */
  onPause?: () => void;
  onResume?: () => void;
  /** Only the REC chip (the speakers view's top bar, as in frame 06). */
  chipOnly?: boolean;
  /** After the device chip, before Pause: the suggestions' cloud chip (job 019, frame 21g). */
  extra?: ReactNode;
}

/** "On-device · DE/EN", "· DE" or "· EN": the default meeting language from the settings. */
export function DeviceChip() {
  const { t } = useI18n();
  const { settings } = useSettings();
  return (
    <span className="device-chip" data-testid="device-chip">
      {t(`recording.onDevice.${settings.meetingLanguage}` as MessageKey)}
    </span>
  );
}

/**
 * Frame 02 top bar: the REC chip (red dot, "REC" and the recorded time, so the state is not shown by
 * colour alone), the "On-device · DE/EN" chip, and "Pause" / "Resume". The chip follows the core's
 * capture state: shown while recording or paused, gone when recording is off or failed.
 */
export function RecordingControls({
  capture,
  busy = false,
  onPause,
  onResume,
  chipOnly = false,
  extra,
}: Props) {
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
      {chipOnly ? null : <DeviceChip />}
      {extra}
      {(recording || paused) && onPause && onResume ? (
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
