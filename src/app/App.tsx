import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { AgendaSetup } from "../features/agenda/AgendaSetup";
import { useMeeting } from "../features/agenda/useMeeting";
import { LiveView } from "../features/live/LiveView";
import { isRunning } from "../features/live/run";
import { SettingsView } from "../features/settings/SettingsView";
import { SettingsProvider } from "../features/settings/useSettings";
import { SETTINGS_BUTTON, TopBar } from "./TopBar";

export function App() {
  return (
    <SettingsProvider>
      <Shell />
    </SettingsProvider>
  );
}

/** Ctrl+, (Cmd+, on macOS). */
function isSettingsShortcut(e: KeyboardEvent) {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "," || e.code === "Comma");
}

function Shell() {
  const { t } = useI18n();
  const defaultTitle = useCallback(() => t("meeting.defaultTitle"), [t]);
  const state = useMeeting(defaultTitle);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const returnFocus = useRef(false);

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => {
    returnFocus.current = true;
    setSettingsOpen(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSettingsShortcut(e)) return;
      e.preventDefault();
      setSettingsOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Back from the settings: focus goes to the "Settings" button of the view that shows again.
  useEffect(() => {
    if (settingsOpen || !returnFocus.current) return;
    returnFocus.current = false;
    const visible = [...document.querySelectorAll<HTMLButtonElement>(`[${SETTINGS_BUTTON}]`)].find(
      (b) => !b.closest("[hidden]"),
    );
    visible?.focus();
  }, [settingsOpen]);

  const live = state.meeting && isRunning(state.meeting) ? state.meeting : null;
  // The view stays mounted under the settings, so a running recording, the transcript and its scroll
  // position, and unsaved edits carry on. Opening or closing the settings never touches recording.
  return (
    <div className="app">
      <div className="app__view" hidden={settingsOpen}>
        {live ? (
          // A meeting that is running reopens in the live view, also after a restart.
          <LiveView
            key={live.id}
            meeting={live}
            state={state}
            onOpenSettings={openSettings}
            hidden={settingsOpen}
          />
        ) : (
          <>
            <TopBar onNewMeeting={state.startNew} onOpenSettings={openSettings} />
            <AgendaSetup state={state} />
          </>
        )}
      </div>
      {settingsOpen ? (
        <SettingsView
          origin={live ? "live" : "setup"}
          meetingTitle={live?.title ?? state.meeting?.title}
          onBack={closeSettings}
        />
      ) : null}
    </div>
  );
}
