import { useCallback } from "react";
import { useI18n } from "../i18n";
import { AgendaSetup } from "../features/agenda/AgendaSetup";
import { useMeeting } from "../features/agenda/useMeeting";
import { TopBar } from "./TopBar";

export function App() {
  const { t } = useI18n();
  const defaultTitle = useCallback(() => t("meeting.defaultTitle"), [t]);
  const state = useMeeting(defaultTitle);
  return (
    <div className="app">
      <TopBar onNewMeeting={state.startNew} />
      <AgendaSetup state={state} />
    </div>
  );
}
