import { useCallback } from "react";
import { useI18n } from "../i18n";
import { AgendaSetup } from "../features/agenda/AgendaSetup";
import { useMeeting } from "../features/agenda/useMeeting";
import { LiveView } from "../features/live/LiveView";
import { isRunning } from "../features/live/run";
import { TopBar } from "./TopBar";

export function App() {
  const { t } = useI18n();
  const defaultTitle = useCallback(() => t("meeting.defaultTitle"), [t]);
  const state = useMeeting(defaultTitle);
  // A meeting that is running reopens in the live view, also after a restart.
  if (state.meeting && isRunning(state.meeting)) {
    return (
      <div className="app">
        <LiveView key={state.meeting.id} meeting={state.meeting} state={state} />
      </div>
    );
  }
  return (
    <div className="app">
      <TopBar onNewMeeting={state.startNew} />
      <AgendaSetup state={state} />
    </div>
  );
}
