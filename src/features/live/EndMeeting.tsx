import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";

/** How long the inline confirmation stays armed. */
export const CONFIRM_MS = 6000;

/**
 * "End meeting" in the top bar. The first click arms it inline (the same button now says "Click
 * again to end", with "Keep going" next to it); the second click ends the meeting. No dialog. It
 * disarms after a few seconds, on "Keep going" or on Escape.
 */
export function EndMeeting({ onEnd }: { onEnd: () => void }) {
  const { t } = useI18n();
  const [armed, setArmed] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), CONFIRM_MS);
    return () => clearTimeout(id);
  }, [armed]);

  function disarm() {
    setArmed(false);
    buttonRef.current?.focus();
  }

  return (
    <div
      className="end-meeting"
      onKeyDown={(e) => {
        if (e.key === "Escape" && armed) disarm();
      }}
    >
      {armed ? (
        <button type="button" className="button button--ghost button--small" onClick={disarm}>
          {t("live.end.cancel")}
        </button>
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        className={`button button--dark button--small${armed ? " button--armed" : ""}`}
        onClick={() => (armed ? onEnd() : setArmed(true))}
      >
        {armed ? t("live.end.confirm") : t("live.end")}
      </button>
      <span className="visually-hidden" role="status">
        {armed ? t("live.end.confirmHint") : ""}
      </span>
    </div>
  );
}
