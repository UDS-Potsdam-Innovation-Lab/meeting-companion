import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { useClock } from "../../lib/clock";
import { viewReady, type LoadError } from "../../lib/ipc";
import { CloseIcon } from "../../ui/icons";
import { startRun } from "../live/run";
import { AgendaList } from "./AgendaList";
import { FreeExplainer } from "./FreeExplainer";
import { MeetingCard } from "./MeetingCard";
import { isFree, setMode, type MeetingMode } from "./model";
import { ModeSwitch } from "./ModeSwitch";
import { StartMeeting, type StartBlocker } from "./StartMeeting";
import type { MeetingState } from "./useMeeting";

export const AGENDA_SETUP_VIEW = "agenda-setup";

/**
 * Frame 01 "Agenda setup", without the assistant parts (later jobs). In agenda-free mode (frame 16a)
 * the agenda list gives way to a short explanation; typed items stay in the meeting.
 */
export function AgendaSetup({ state }: { state: MeetingState }) {
  const { t } = useI18n();
  const { meeting, loadError, saveFailed, update, dismissLoadError } = state;
  const ready = meeting !== null;
  const clock = useClock();
  // Input that has not passed validation is kept in the forms, not in the meeting; they report it here.
  const [invalidMeeting, setInvalidMeeting] = useState(false);
  const [invalidItem, setInvalidItem] = useState(false);
  const onMeetingValidity = useCallback((bad: boolean) => setInvalidMeeting(bad), []);
  const onItemValidity = useCallback((bad: boolean) => setInvalidItem(bad), []);

  const free = meeting !== null && isFree(meeting);
  const onMode = (mode: MeetingMode) => {
    // The agenda list (and an open editor with invalid input) goes away with the switch.
    if (update((m) => setMode(m, mode))) setInvalidItem(false);
  };

  let blocker: StartBlocker | null = null;
  if (loadError === "keyUnavailable") blocker = "locked";
  else if (invalidMeeting || (!free && invalidItem)) blocker = "invalid";
  else if (!meeting || (!free && meeting.items.length === 0)) blocker = "noItems";

  useEffect(() => {
    if (ready) void viewReady(AGENDA_SETUP_VIEW);
  }, [ready]);

  return (
    <main className="setup" id="main" data-view={AGENDA_SETUP_VIEW} aria-busy={!ready}>
      <div className="setup__left">
        <div className="setup__heading">
          <div className="setup__step-row">
            <p className="setup__step">{t("setup.step")}</p>
            {meeting ? <ModeSwitch mode={free ? "free" : "agenda"} onChange={onMode} /> : null}
          </div>
          <h1 className="setup__title">{free ? t("setup.free.title") : t("setup.title")}</h1>
          <p className="setup__subtitle">{free ? t("setup.free.subtitle") : t("setup.subtitle")}</p>
        </div>

        {loadError ? <LoadErrorBanner error={loadError} onDismiss={dismissLoadError} /> : null}
        {saveFailed && loadError !== "keyUnavailable" ? (
          <div className="banner banner--error" role="alert">
            {t("store.saveFailed")}
          </div>
        ) : null}

        {meeting && free ? <FreeExplainer meeting={meeting} /> : null}
        {meeting && !free ? (
          <AgendaList key={meeting.id} meeting={meeting} onChange={update} onValidity={onItemValidity} />
        ) : null}
      </div>

      <div className="setup__right">
        {meeting ? (
          <>
            <MeetingCard
              key={meeting.id}
              meeting={meeting}
              onChange={update}
              onValidity={onMeetingValidity}
            />
            <StartMeeting blocker={blocker} onStart={() => update((m) => startRun(m, clock.now()))} />
          </>
        ) : null}
      </div>
    </main>
  );
}

function LoadErrorBanner({ error, onDismiss }: { error: LoadError; onDismiss: () => void }) {
  const { t } = useI18n();
  if (error === "keyUnavailable") {
    // Not dismissable: nothing is saved while the key is missing.
    return (
      <div className="banner banner--error" role="alert">
        <div className="banner__text">
          <p className="banner__title">{t("store.keyUnavailable.title")}</p>
          <p>{t("store.keyUnavailable.body")}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="banner banner--error" role="alert">
      <div className="banner__text">
        <p className="banner__title">
          {error === "corrupt" ? t("store.loadCorrupt.title") : t("store.loadUnreadable.title")}
        </p>
        <p>{t("store.loadFailed.body")}</p>
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label={t("store.dismiss")}
        title={t("store.dismiss")}
        onClick={onDismiss}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
