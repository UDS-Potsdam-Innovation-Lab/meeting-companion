import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { matches, tabTarget } from "../../app/shortcuts";
import { TopBar } from "../../app/TopBar";
import { useI18n, type MessageKey } from "../../i18n";
import { RecordingControls } from "../transcript/RecordingControls";
import type { Section as SettingsSection } from "../settings/SettingsView";
import { useCapture } from "../settings/useAudioState";
import { HelpContent } from "./HelpContent";
import { LegalContent } from "./LegalContent";
import { SECTIONS, TABS, type HelpTab } from "./sections";

export const HELP_VIEW = "help";

/** Where "Help & legal" was opened: "Back" returns there. */
export type HelpOrigin = "setup" | "live" | "settings";

const BACK_LABEL: Record<HelpOrigin, MessageKey> = {
  setup: "settings.backToSetup",
  live: "settings.backToMeeting",
  settings: "help.backToSettings",
};

interface Props {
  origin: HelpOrigin;
  meetingTitle?: string;
  onBack: () => void;
  onOpenSettings: () => void;
  /** A troubleshooting entry's "Open … settings". */
  onOpenSettingsAt: (section: SettingsSection) => void;
  initialTab?: HelpTab;
}

/**
 * Frame 19 "Help & legal": in the same window, not modal, over the view it was opened from (which
 * stays mounted, so a recording carries on and the REC chip stays in the top bar). Tabs "Help" and
 * "Legal notes" with an "On this page" list (a select when narrow); one long page of cards per tab.
 * Everything is bundled with the app; nothing is loaded from the network.
 */
export function HelpView({
  origin,
  meetingTitle,
  onBack,
  onOpenSettings,
  onOpenSettingsAt,
  initialTab = "help",
}: Props) {
  const { t } = useI18n();
  const capture = useCapture();
  const [tab, setTab] = useState<HelpTab>(initialTab);
  const sections = SECTIONS[tab];
  const [current, setCurrent] = useState(sections[0]!.id);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const ids = useId();
  const tocId = `${ids}-toc`;

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      // An open native select handles Escape itself.
      if (!matches("back", e) || e.defaultPrevented) return;
      e.preventDefault();
      onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const choose = (next: HelpTab) => {
    setTab(next);
    setCurrent(SECTIONS[next][0]!.id);
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = tabTarget(e, TABS, tab);
    if (!next) return;
    e.preventDefault();
    choose(next);
    tabRefs.current[next]?.focus();
  };

  /** Scrolls to a section and moves focus to its heading, so reading continues there. */
  const jump = (id: string) => {
    setCurrent(id);
    const heading = document.getElementById(`${id}-title`);
    heading?.scrollIntoView?.({ block: "start" });
    heading?.focus({ preventScroll: true });
  };

  return (
    <div className="help-view">
      <TopBar
        meetingTitle={meetingTitle ?? ""}
        actions={<RecordingControls capture={capture} />}
        onOpenHelp={() => tabRefs.current[tab]?.focus()}
        helpOpen
        onOpenSettings={onOpenSettings}
        onBack={onBack}
        backLabel={t(BACK_LABEL[origin])}
      />
      <main className="help" data-view={HELP_VIEW}>
        <div className="help__nav">
          <h1 className="help__title">{t("help.title")}</h1>
          <p className="help__intro">{t("help.intro")}</p>
          <div className="help__tabs" role="tablist" aria-label={t("help.tabs")}>
            {TABS.map((id) => (
              <button
                key={id}
                ref={(el) => {
                  tabRefs.current[id] = el;
                }}
                type="button"
                role="tab"
                id={`${ids}-tab-${id}`}
                aria-controls={`${ids}-panel`}
                aria-selected={id === tab}
                tabIndex={id === tab ? 0 : -1}
                className="help-tab"
                onClick={() => choose(id)}
                onKeyDown={onTabKey}
              >
                {t(`help.tab.${id}` as MessageKey)}
              </button>
            ))}
          </div>
          <nav className="help-toc" aria-labelledby={tocId}>
            <p className="help-toc__label" id={tocId}>
              {t("help.onThisPage")}
            </p>
            <ul className="help-toc__list">
              {sections.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="help-toc__link"
                    aria-current={s.id === current ? "true" : undefined}
                    onClick={() => jump(s.id)}
                  >
                    {t(s.title)}
                  </button>
                </li>
              ))}
            </ul>
            <div className="help-toc__select">
              <select
                aria-labelledby={tocId}
                value={current}
                onChange={(e) => jump(e.target.value)}
                className="help-toc__select-input"
              >
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {t(s.title)}
                  </option>
                ))}
              </select>
            </div>
          </nav>
        </div>
        <div
          className="help__panel"
          role="tabpanel"
          id={`${ids}-panel`}
          aria-labelledby={`${ids}-tab-${tab}`}
        >
          {tab === "help" ? <HelpContent onOpenSettingsAt={onOpenSettingsAt} /> : <LegalContent />}
        </div>
      </main>
    </div>
  );
}
