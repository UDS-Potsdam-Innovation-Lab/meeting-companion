import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { AgendaSetup } from "../features/agenda/AgendaSetup";
import { useMeeting } from "../features/agenda/useMeeting";
import { HelpView } from "../features/help/HelpView";
import { LiveView } from "../features/live/LiveView";
import { isRunning } from "../features/live/run";
import { SettingsView, type Section } from "../features/settings/SettingsView";
import { SettingsProvider } from "../features/settings/useSettings";
import { matches } from "./shortcuts";
import { HELP_BUTTON, SETTINGS_BUTTON, TopBar } from "./TopBar";

export function App() {
  return (
    <SettingsProvider>
      <Shell />
    </SettingsProvider>
  );
}

/** The first visible element with `attr` (views underneath the open one are `hidden`). */
function visibleWith(attr: string) {
  return [...document.querySelectorAll<HTMLElement>(`[${attr}]`)].find((b) => !b.closest("[hidden]"));
}

interface HelpState {
  /** Opened from the settings, or from the setup or live view. */
  origin: "settings" | "view";
  /** The control that opened the view; focus returns to it. */
  opener: HTMLElement | null;
}

function Shell() {
  const { t } = useI18n();
  const defaultTitle = useCallback(() => t("meeting.defaultTitle"), [t]);
  const state = useMeeting(defaultTitle);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // A new key remounts the settings at the section a troubleshooting entry asked for.
  const [settingsAt, setSettingsAt] = useState<{ section: Section; key: number; focus: boolean }>({
    section: "audio",
    key: 0,
    focus: false,
  });
  const [help, setHelp] = useState<HelpState | null>(null);
  const returnFocus = useRef(false);
  const helpReturn = useRef<HTMLElement | null>(null);

  const closeHelp = useCallback(() => {
    helpReturn.current = help?.opener ?? null;
    setHelp(null);
  }, [help]);
  const openSettingsAt = useCallback((section: Section) => {
    setHelp(null);
    setSettingsAt((s) => ({ section, key: s.key + 1, focus: true }));
    setSettingsOpen(true);
  }, []);
  const openSettings = useCallback(() => {
    if (!help) setSettingsOpen(true);
    // Help opened from the settings: they are underneath, as they were left.
    else if (help.origin === "settings") closeHelp();
    // From Help & legal over setup or live: the settings open with focus on their section tab.
    else openSettingsAt(settingsAt.section);
  }, [help, closeHelp, openSettingsAt, settingsAt.section]);
  const closeSettings = useCallback(() => {
    returnFocus.current = true;
    setSettingsOpen(false);
  }, []);
  const openHelp = useCallback(
    (opener: HTMLElement) => setHelp((h) => h ?? { origin: settingsOpen ? "settings" : "view", opener }),
    [settingsOpen],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matches("openSettings", e)) return;
      e.preventDefault();
      openSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSettings]);

  // Back from the settings: focus goes to the "Settings" button of the view that shows again.
  useEffect(() => {
    if (settingsOpen || !returnFocus.current) return;
    returnFocus.current = false;
    visibleWith(SETTINGS_BUTTON)?.focus();
  }, [settingsOpen]);

  // Back from Help & legal: focus goes to the control that opened it (the top-bar button or the link
  // in the settings), or to the visible "Help & legal" button if that control is gone.
  useEffect(() => {
    if (help) return;
    const opener = helpReturn.current;
    if (!opener) return;
    helpReturn.current = null;
    if (opener.isConnected && !opener.closest("[hidden]")) opener.focus();
    else visibleWith(HELP_BUTTON)?.focus();
  }, [help]);

  const live = state.meeting && isRunning(state.meeting) ? state.meeting : null;
  const origin = live ? "live" : "setup";
  const helpOpen = help !== null;
  // The views stay mounted under the settings and under Help & legal, so a running recording, the
  // transcript and its scroll position, and unsaved edits carry on. Opening or closing either view
  // never touches recording.
  return (
    <div className="app">
      <div className="app__view" hidden={settingsOpen || helpOpen}>
        {live ? (
          // A meeting that is running reopens in the live view, also after a restart.
          <LiveView
            key={live.id}
            meeting={live}
            state={state}
            onOpenSettings={openSettings}
            onOpenHelp={openHelp}
            hidden={settingsOpen || helpOpen}
          />
        ) : (
          <>
            <TopBar onNewMeeting={state.startNew} onOpenHelp={openHelp} onOpenSettings={openSettings} />
            <AgendaSetup state={state} />
          </>
        )}
      </div>
      {settingsOpen ? (
        <div className="app__view" hidden={helpOpen}>
          <SettingsView
            key={settingsAt.key}
            origin={origin}
            meetingTitle={live?.title ?? state.meeting?.title}
            onBack={closeSettings}
            onOpenHelp={openHelp}
            initialSection={settingsAt.section}
            focusSection={settingsAt.focus}
            active={!helpOpen}
          />
        </div>
      ) : null}
      {help ? (
        <HelpView
          origin={help.origin === "settings" ? "settings" : origin}
          meetingTitle={live?.title ?? state.meeting?.title}
          onBack={closeHelp}
          onOpenSettings={openSettings}
          onOpenSettingsAt={openSettingsAt}
        />
      ) : null}
    </div>
  );
}
