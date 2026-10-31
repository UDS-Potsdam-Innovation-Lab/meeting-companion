import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { matches } from "../../app/shortcuts";

/** How long the inline confirmation stays armed. */
export const CONFIRM_MS = 6000;

/**
 * "End meeting", the last control of the live view. The first click arms it inline (the same button now says "Click
 * again to end", with "Keep going" next to it); the second click ends the meeting. No dialog. It
 * disarms after a few seconds, on "Keep going" or on Escape. The meeting ends exactly once: after the
 * second click the button stays as it is, disabled, and never disarms.
 */
export function EndMeeting({ onEnd }: { onEnd: () => void }) {
  const { t } = useI18n();
  const [armed, setArmed] = useState(false);
  const [ended, setEnded] = useState(false);
  // Set at once, so a second click before the next render cannot end the meeting again.
  const endedRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!armed || ended) return;
    const id = setTimeout(() => setArmed(false), CONFIRM_MS);
    return () => clearTimeout(id);
  }, [armed, ended]);

  function confirm() {
    if (endedRef.current) return;
    endedRef.current = true;
    setEnded(true);
    onEnd();
  }

  function disarm() {
    setArmed(false);
    buttonRef.current?.focus();
  }

  return (
    <div
      className="end-meeting"
      onKeyDown={(e) => {
        if (matches("back", e) && armed && !ended) disarm();
      }}
    >
      {armed && !ended ? (
        <button type="button" className="button button--ghost button--small" onClick={disarm}>
          {t("live.end.cancel")}
        </button>
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        className={`button button--dark button--small${armed ? " button--armed" : ""}`}
        disabled={ended}
        onClick={() => (armed ? confirm() : setArmed(true))}
      >
        {armed ? t("live.end.confirm") : t("live.end")}
      </button>
      <span className="visually-hidden" role="status">
        {armed ? t("live.end.confirmHint") : ""}
      </span>
    </div>
  );
}
