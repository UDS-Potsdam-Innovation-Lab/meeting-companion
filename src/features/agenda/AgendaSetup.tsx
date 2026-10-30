import { useEffect } from "react";
import { useI18n } from "../../i18n";
import { viewReady, type LoadError } from "../../lib/ipc";
import { CloseIcon } from "../../ui/icons";
import { AgendaList } from "./AgendaList";
import { MeetingCard } from "./MeetingCard";
import type { MeetingState } from "./useMeeting";

export const AGENDA_SETUP_VIEW = "agenda-setup";

/** Frame 01 "Agenda setup", without the assistant parts (later jobs). */
export function AgendaSetup({ state }: { state: MeetingState }) {
  const { t } = useI18n();
  const { meeting, loadError, saveFailed, update, dismissLoadError } = state;
  const ready = meeting !== null;

  useEffect(() => {
    if (ready) void viewReady(AGENDA_SETUP_VIEW);
  }, [ready]);

  return (
    <main className="setup" id="main" data-view={AGENDA_SETUP_VIEW} aria-busy={!ready}>
      <div className="setup__left">
        <div className="setup__heading">
          <p className="setup__step">{t("setup.step")}</p>
          <h1 className="setup__title">{t("setup.title")}</h1>
          <p className="setup__subtitle">{t("setup.subtitle")}</p>
        </div>

        {loadError ? <LoadErrorBanner error={loadError} onDismiss={dismissLoadError} /> : null}
        {saveFailed && loadError !== "keyUnavailable" ? (
          <div className="banner banner--error" role="alert">
            {t("store.saveFailed")}
          </div>
        ) : null}

        {meeting ? <AgendaList key={meeting.id} meeting={meeting} onChange={update} /> : null}
      </div>

      <div className="setup__right">
        {meeting ? <MeetingCard key={meeting.id} meeting={meeting} onChange={update} /> : null}
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
