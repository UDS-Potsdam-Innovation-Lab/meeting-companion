// Job 014 "Help & legal", component tests (AC1–AC6). Licence data checks are in licences.test.ts.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emit } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SHORTCUTS } from "../../app/shortcuts";
import { I18nProvider, messages } from "../../i18n";
import { FakeClock } from "../../lib/clock";
import { EVENT_CAPTURE, type CaptureState, type OrganisationLoad } from "../../lib/ipc";
import { FIXTURE_ORGANISATION, MARKUP_ORGANISATION } from "../../lib/mockBackend";
import { fakeCore, renderApp, type FakeCore, type FakeRecording } from "../../test/backend";
import {
  FREE_TIMES,
  filledMeeting,
  LIVE_TIMES,
  LIVE_TRANSCRIPT,
  liveConsentedMeeting,
  liveFreeMeeting,
  liveMeeting,
} from "../agenda/fixtures";
import { SettingsProvider } from "../settings/useSettings";
import { OrganisationBlock } from "./LegalContent";
import { FEATURED, loadLicenceList, MODEL_LICENCES } from "./Licences";
import { PRIVACY_SLOTS, SECTIONS } from "./sections";

const ID = "fixture-live";
const ORG_PATH = "/home/u/.local/share/de.udspotsdam.meetingcompanion/organisation.json";

beforeEach(() => {
  localStorage.setItem("meeting-companion.locale", "en");
});

const helpView = () => document.querySelector('main[data-view="help"]');
const settingsView = () => document.querySelector('main[data-view="settings"]');
/** The visible one of several equal buttons (views underneath are `hidden`). */
const visible = (name: string | RegExp) =>
  screen.getAllByRole("button", { name }).find((b) => !b.closest("[hidden]"))!;
const calls = (core: FakeCore, cmd: string) => core.calls.filter((c) => c.cmd === cmd);

async function setup(rec: FakeRecording = {}) {
  return renderApp(
    { meeting: filledMeeting(), error: null },
    { recording: { ...rec, settings: { locale: "en", ...rec.settings } } },
  );
}

const recordingState = (s: Partial<CaptureState> = {}): CaptureState => ({
  state: "recording",
  meetingId: ID,
  elapsedMs: 83_000,
  level: 0.6,
  reason: null,
  ...s,
});

async function live(meeting = liveConsentedMeeting(), at: number = LIVE_TIMES.running) {
  return renderApp(
    { meeting, error: null },
    {
      clock: new FakeClock(at),
      view: "live",
      recording: {
        status: recordingState({ meetingId: meeting.id }),
        transcript: { segments: LIVE_TRANSCRIPT, error: null },
        settings: { locale: "en" },
      },
    },
  );
}

async function openHelp(user: ReturnType<typeof userEvent.setup>, name: string | RegExp = "Help & legal") {
  await user.click(visible(name));
  await waitFor(() => expect(helpView()).not.toBeNull());
}

async function openLegal(user: ReturnType<typeof userEvent.setup>, name: string | RegExp = "Legal notes") {
  await user.click(screen.getByRole("tab", { name }));
}

describe("AC1 entry, same window, Back and Escape", () => {
  it("setup: the top-bar button opens the view with two tabs; Back and Escape return focus to it", async () => {
    const user = userEvent.setup();
    await setup();
    const button = visible("Help & legal");
    expect(button).toHaveAttribute("data-help-button");
    await openHelp(user);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Help & legal" })).toBeVisible();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Help", "Legal notes"]);
    expect(screen.getByRole("tab", { name: "Help" })).toHaveAttribute("aria-selected", "true");
    // The setup view is kept underneath, hidden.
    expect(screen.queryByRole("region", { name: /^Meeting$/ })).toBeNull();
    expect(visible("Help & legal")).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("button", { name: "Back to setup" }));
    expect(helpView()).toBeNull();
    expect(screen.getByRole("region", { name: /^Meeting$/ })).toBeVisible();
    expect(button).toHaveFocus();

    await openHelp(user);
    await user.keyboard("{Escape}");
    expect(helpView()).toBeNull();
    expect(button).toHaveFocus();
  });

  it("live (agenda): recording state and timer keep running while the view is open and after", async () => {
    const user = userEvent.setup();
    const { core } = await live();
    await screen.findByTestId("rec-chip");
    await openHelp(user);
    // The REC chip stays visible in the top bar of the view.
    const chip = () => screen.getAllByTestId("rec-chip").find((c) => !c.closest("[hidden]"))!;
    await waitFor(() => expect(chip()).toHaveTextContent("REC00:01:23"));
    act(() => void emit(EVENT_CAPTURE, recordingState({ elapsedMs: 95_000 })));
    await waitFor(() => expect(chip()).toHaveTextContent("REC00:01:35"));
    // Opening Help & legal never touches the recording.
    for (const cmd of ["pause_recording", "stop_recording", "start_recording"]) {
      expect(calls(core, cmd), cmd).toEqual([]);
    }
    await user.click(screen.getByRole("button", { name: "Back to meeting" }));
    expect(helpView()).toBeNull();
    expect(document.querySelector('main[data-view="live"]')).toBeVisible();
    expect(chip()).toHaveTextContent("REC00:01:35");
    expect(visible("Help & legal")).toHaveFocus();
    expect(calls(core, "pause_recording")).toEqual([]);
    expect(calls(core, "stop_recording")).toEqual([]);
  });

  it("live (agenda-free): the top bar has the button too", async () => {
    const user = userEvent.setup();
    await live(liveFreeMeeting(), FREE_TIMES.half);
    await openHelp(user);
    expect(screen.getByRole("button", { name: "Back to meeting" })).toBeVisible();
  });

  it("settings: the top-bar button and the link under the sections open it; Back returns to the settings", async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(visible("Settings"));
    await user.click(screen.getByRole("tab", { name: /General/ }));
    // The link (wide: under the section list; narrow: after the section; CSS shows one).
    const links = screen.getAllByRole("button", {
      name: /^Help & legal\s*How it works, shortcuts, privacy$/,
    });
    const link = links[0]!;
    await user.click(link);
    await waitFor(() => expect(helpView()).not.toBeNull());
    expect(screen.getByRole("button", { name: "Back to settings" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Back to settings" }));
    expect(helpView()).toBeNull();
    expect(settingsView()).not.toBeNull();
    // The settings are as they were left.
    expect(screen.getByRole("tab", { name: /General/ })).toHaveAttribute("aria-selected", "true");
    expect(link).toHaveFocus();

    const topBarButton = document.querySelector<HTMLElement>(".settings-view [data-help-button]")!;
    await user.click(topBarButton);
    await user.keyboard("{Escape}");
    expect(settingsView()).not.toBeNull();
    expect(topBarButton).toHaveFocus();
    // Escape once more leaves the settings: Help's Escape did not also close them.
    await user.keyboard("{Escape}");
    expect(settingsView()).toBeNull();
  });

  it("Settings in the view's top bar and Ctrl+, open the settings", async () => {
    const user = userEvent.setup();
    await setup();
    await openHelp(user);
    await user.click(visible("Settings"));
    expect(helpView()).toBeNull();
    expect(settingsView()).not.toBeNull();
    expect(screen.getByRole("tab", { name: /Audio/ })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Back to setup" }));
    await openHelp(user);
    await user.keyboard("{Control>},{/Control}");
    expect(settingsView()).not.toBeNull();
  });
});

describe("AC2 help content", () => {
  it("shows the three sections with the meeting topics and the troubleshooting entries", async () => {
    const user = userEvent.setup();
    await setup();
    await openHelp(user);
    const h2 = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(h2).toEqual(["How a meeting works", "Keyboard shortcuts", "Troubleshooting"]);
    const how = screen.getByRole("region", { name: "How a meeting works" });
    expect(
      within(how)
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent),
    ).toEqual([
      "Agenda mode",
      "Agenda-free mode",
      "Recording and consent",
      "Speakers",
      "Sound wave",
      "Ending a meeting",
    ]);
    const trouble = screen.getByRole("region", { name: "Troubleshooting" });
    expect(
      within(trouble)
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(["Microphone lost", "No speech model", "No speaker model"]);
    // "On this page" lists the same sections; choosing one moves focus to its heading.
    const toc = screen.getByRole("navigation", { name: "On this page" });
    await user.click(within(toc).getByRole("button", { name: "Troubleshooting" }));
    expect(screen.getByRole("heading", { level: 2, name: "Troubleshooting" })).toHaveFocus();
    expect(within(toc).getByRole("button", { name: "Troubleshooting" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("the shortcut list is generated from the registry, one row per shortcut", async () => {
    const user = userEvent.setup();
    await setup();
    await openHelp(user);
    const rows = [...document.querySelectorAll("[data-shortcut]")];
    expect(rows.map((r) => r.getAttribute("data-shortcut"))).toEqual(SHORTCUTS.map((s) => s.id));
    const settings = rows[0]!;
    expect([...settings.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["Ctrl", ","]);
    expect(settings).toHaveTextContent("Open Settings");
    // A listed shortcut works: Escape leaves the view.
    await user.keyboard("{Escape}");
    expect(helpView()).toBeNull();
  });

  it.each([
    ["Open Audio settings", "mic", /Audio/],
    ["Open On this device", "speech", /On this device/],
    ["Open On this device", "speaker", /On this device/],
  ])("“%s” of %s opens the settings at the right section", async (name, entry, tab) => {
    const user = userEvent.setup();
    await setup();
    await openHelp(user);
    const item = document.querySelector<HTMLElement>(`[data-trouble="${entry}"]`)!;
    await user.click(within(item).getByRole("button", { name }));
    expect(helpView()).toBeNull();
    expect(settingsView()).not.toBeNull();
    expect(screen.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: tab })).toHaveFocus();
    // "Back" from there returns to setup, where the meeting was.
    await user.click(screen.getByRole("button", { name: "Back to setup" }));
    expect(screen.getByRole("region", { name: /^Meeting$/ })).toBeVisible();
  });
});

const PRIVACY_KEYS = [
  "legal.privacy.recorded.body",
  "legal.privacy.audio",
  "legal.privacy.level",
  "legal.privacy.stored.body",
  "legal.privacy.leaves.body",
  "legal.privacy.consent.body",
  "legal.privacy.retention.body",
  "legal.privacy.controller.body",
];

describe("AC3 privacy notice and consent texts", () => {
  it("states every promise by its key", async () => {
    const user = userEvent.setup();
    await renderApp({ meeting: filledMeeting(), error: null }, { keyMode: true });
    await openHelp(user, "⟦topbar.help⟧");
    await openLegal(user, "⟦help.tab.legal⟧");
    const notice = screen.getByRole("region", { name: "⟦legal.privacy.title⟧" });
    for (const key of PRIVACY_KEYS) expect(within(notice).getByText(`⟦${key}⟧`)).toBeInTheDocument();
  });

  it("says what the app does: folder, encryption, keychain, no audio, no level, nothing leaves", async () => {
    const user = userEvent.setup();
    await setup();
    await openHelp(user);
    await openLegal(user);
    const notice = screen.getByRole("region", { name: "Privacy notice" });
    expect(notice).toHaveTextContent(
      "Only on this device, in /home/u/.local/share/de.udspotsdam.meetingcompanion/meetings. Meetings and transcripts are encrypted (XChaCha20-Poly1305); the key is kept in the system keychain.",
    );
    expect(notice).toHaveTextContent("Audio is never written to disk.");
    expect(notice).toHaveTextContent("The input level only moves the sound wave and is never stored.");
    expect(notice).toHaveTextContent("Nothing. The app sends no audio, transcripts or meeting data anywhere");
    expect(notice).toHaveTextContent(
      "Recording starts only after the facilitator confirms that everyone was informed",
    );
    expect(notice).toHaveTextContent("a red REC indicator is visible");
    expect(notice).toHaveTextContent("Transcripts and meetings stay until a person deletes them.");
    // The slots of later features render nothing yet.
    for (const slot of PRIVACY_SLOTS) expect(document.getElementById(slot)).toBeNull();
  });

  it("the consent texts are the consent prompt's keys: a changed text shows in both places", async () => {
    const before = { ...messages.en };
    try {
      messages.en["consent.title"] = "Transcribe this team meeting now?";
      messages.en["consent.local"] = "Audio and text stay on this laptop.";
      const user = userEvent.setup();
      await renderApp(
        { meeting: liveMeeting(), error: null },
        { clock: new FakeClock(LIVE_TIMES.running), view: "live", recording: { settings: { locale: "en" } } },
      );
      // The prompt in the live view.
      expect(screen.getByText("Transcribe this team meeting now?")).toBeVisible();
      expect(screen.getByText("Audio and text stay on this laptop.")).toBeVisible();
      await openHelp(user);
      await openLegal(user);
      const copy = screen.getByRole("region", { name: "Consent texts" });
      expect(within(copy).getByText("Transcribe this team meeting now?")).toBeVisible();
      expect(within(copy).getByText(messages.en["consent.check"])).toBeVisible();
      expect(within(copy).getByText("Audio and text stay on this laptop.")).toBeVisible();
    } finally {
      Object.assign(messages.en, before);
    }
  });
});

function renderOrganisation(load: OrganisationLoad | null) {
  fakeCore();
  return render(
    <I18nProvider>
      <SettingsProvider>
        <OrganisationBlock load={load} />
      </SettingsProvider>
    </I18nProvider>,
  );
}

describe("AC4 organisation details", () => {
  it("a valid file shows its fields, read-only, with where it came from", async () => {
    const user = userEvent.setup();
    await setup({ organisation: { status: "found", organisation: FIXTURE_ORGANISATION, path: ORG_PATH } });
    await openHelp(user);
    await openLegal(user);
    const block = screen.getByRole("region", { name: "Organisation" });
    await within(block).findByText("Grundschule am Lindenpark");
    const terms = within(block)
      .getAllByRole("term")
      .map((t) => t.textContent);
    expect(terms).toEqual([
      "Organisation",
      "Address",
      "Controller",
      "Data protection officer",
      "Contact",
      "Imprint",
    ]);
    expect(
      within(block)
        .getAllByRole("definition")
        .map((d) => d.textContent),
    ).toEqual([
      FIXTURE_ORGANISATION.name,
      FIXTURE_ORGANISATION.address,
      FIXTURE_ORGANISATION.controller,
      FIXTURE_ORGANISATION.dpoContact,
      FIXTURE_ORGANISATION.contact,
      FIXTURE_ORGANISATION.imprintUrl,
    ]);
    expect(block).toHaveTextContent(`From ${ORG_PATH}. Shown as text; addresses are not links.`);
    expect(within(block).queryByRole("link")).toBeNull();
    expect(within(block).queryByRole("textbox")).toBeNull();
    expect(screen.queryByTestId("org-placeholder")).toBeNull();
  });

  it("only the fields the file has are shown", () => {
    renderOrganisation({
      status: "found",
      organisation: { ...FIXTURE_ORGANISATION, address: null, dpoContact: null, contact: null },
      path: ORG_PATH,
    });
    expect(screen.getAllByRole("term").map((t) => t.textContent)).toEqual([
      "Organisation",
      "Controller",
      "Imprint",
    ]);
  });

  it("without a file the placeholder says the organisation has not added its details", async () => {
    const user = userEvent.setup();
    await setup();
    await openHelp(user);
    await openLegal(user);
    const placeholder = await screen.findByTestId("org-placeholder");
    expect(placeholder).toHaveTextContent("Your organisation has not added its details yet");
    expect(placeholder).toHaveTextContent(`IT can place them in ${ORG_PATH}`);
    expect(screen.queryByText("The organisation file could not be read.")).toBeNull();
    expect(screen.queryByRole("term")).toBeNull();
  });

  it("a rejected file shows the placeholder and a notice that it could not be read", () => {
    renderOrganisation({ status: "invalid", organisation: null, path: ORG_PATH });
    expect(screen.getByRole("status")).toHaveTextContent("The organisation file could not be read.");
    expect(screen.getByRole("status")).toHaveTextContent("Ask your IT to check organisation.json.");
    expect(screen.getByTestId("org-placeholder")).toHaveTextContent(
      "Your organisation has not added its details yet",
    );
    expect(screen.queryByRole("term")).toBeNull();
  });

  it("markup and javascript: values are shown as literal text: no element, no link", () => {
    const { container } = renderOrganisation({
      status: "found",
      organisation: MARKUP_ORGANISATION,
      path: ORG_PATH,
    });
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(screen.getByText("<b>Lindenstraße</b> 12")).toBeInTheDocument();
    expect(screen.getByText('<a href="javascript:alert(1)">Datenschutz</a>')).toBeInTheDocument();
    expect(screen.getByText("javascript:alert(1)")).toBeInTheDocument();
    expect(container.querySelector("img, a, b, script, [href], [onerror]")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("values that are not strings never render, whatever the core sent", () => {
    const bad = {
      ...FIXTURE_ORGANISATION,
      name: { __html: "<img src=x>" },
    } as unknown as OrganisationLoad["organisation"];
    const { container } = renderOrganisation({ status: "found", organisation: bad, path: ORG_PATH });
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getAllByRole("term")[0]).toHaveTextContent("Address");
  });
});

describe("AC5 licences", () => {
  it("lists the named components with version, licence and their full texts on demand", async () => {
    const user = userEvent.setup();
    await setup();
    await openHelp(user);
    await openLegal(user);
    const section = screen.getByRole("region", { name: "Open-source licences" });
    await within(section).findByText("whisper.cpp");
    const list = await loadLicenceList();
    for (const f of FEATURED) {
      const entry = section.querySelector<HTMLElement>(`[data-component="${CSS.escape(f.name)}"]`)!;
      const c = list.components.find((x) => x.name === f.name)!;
      expect(entry, f.name).not.toBeNull();
      expect(entry).toHaveTextContent(f.label ?? f.name);
      if (c.version) expect(entry).toHaveTextContent(c.version);
      expect(entry).toHaveTextContent(c.licence);
    }
    // Collapsed by default; opening one shows its full licence text.
    const whisper = section.querySelector<HTMLElement>('[data-component="whisper.cpp"]')!;
    expect(whisper.querySelector("pre")).toBeNull();
    await user.click(within(whisper).getByText("whisper.cpp"));
    await waitFor(() => expect(whisper.querySelector("pre")).not.toBeNull());
    expect(whisper.querySelector("pre")).toHaveTextContent("MIT License");
    expect(whisper.querySelector("pre")).toHaveTextContent("Permission is hereby granted");
    expect(whisper).toHaveTextContent("via whisper-rs 0.16.0");
    // All the others in one list.
    const others = list.components.length - FEATURED.length;
    await user.click(within(section).getByText(`All ${others} other components`));
    await waitFor(() =>
      expect(section.querySelectorAll("[data-component]").length).toBe(list.components.length),
    );
  });

  it("models are not bundled; the known licences of the supported model families are named", async () => {
    const user = userEvent.setup();
    await setup();
    await openHelp(user);
    await openLegal(user);
    const section = screen.getByRole("region", { name: "Open-source licences" });
    expect(section).toHaveTextContent("Models are not bundled");
    expect(section).toHaveTextContent("The licence of the model you placed on this device applies.");
    const rows = within(section)
      .getAllByRole("row")
      .slice(1)
      .map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent));
    expect(rows).toEqual([
      ["whisper ggml models", "MIT"],
      ["3D-Speaker models", "Apache-2.0"],
      ["WeSpeaker VoxCeleb models", "CC-BY-4.0"],
      ["NeMo TitaNet models", "CC-BY-4.0"],
    ]);
    expect(MODEL_LICENCES).toHaveLength(4);
  });
});

/** Text nodes and labels that are not message keys (`⟦key⟧`) or allowed data. */
function literalOffenders(container: HTMLElement, data: Set<string>): string[] {
  const allowed = (s: string) => {
    const text = s.trim();
    if (text === "") return true;
    if (/^(⟦[\w.-]+⟧\s*)+$/.test(text)) return true;
    if (/^[\d\s:.\-–·]+$/.test(text)) return true;
    return data.has(text);
  };
  const offenders: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!allowed(n.textContent ?? "")) offenders.push(`text: ${n.textContent?.slice(0, 80)}`);
  }
  for (const el of container.querySelectorAll("*")) {
    for (const attr of ["aria-label", "aria-valuetext", "title", "placeholder", "alt"]) {
      const v = el.getAttribute(attr);
      if (v !== null && !allowed(v)) offenders.push(`${attr}: ${v}`);
    }
  }
  return offenders;
}

describe("AC6 every string by key, German default, switches at once", () => {
  afterEach(() => localStorage.clear());

  it("no literal strings in Help or Legal notes (licence data and organisation values are data)", async () => {
    const user = userEvent.setup();
    const meeting = filledMeeting();
    const { container } = await renderApp(
      { meeting, error: null },
      {
        keyMode: true,
        recording: { organisation: { status: "found", organisation: FIXTURE_ORGANISATION, path: ORG_PATH } },
      },
    );
    await openHelp(user, "⟦topbar.help⟧");
    const view = () => container.querySelector<HTMLElement>(".help-view")!;
    const data = new Set<string>([meeting.title]);
    expect(literalOffenders(view(), data)).toEqual([]);

    await openLegal(user, "⟦help.tab.legal⟧");
    await screen.findByText(FIXTURE_ORGANISATION.name!);
    const list = await loadLicenceList();
    for (const c of list.components) {
      for (const v of [c.name, c.version, c.licence, c.via]) if (v) data.add(v);
    }
    for (const text of Object.values(list.texts)) data.add(text);
    for (const f of FEATURED) if (f.label) data.add(f.label);
    for (const m of MODEL_LICENCES) data.add(m.licence);
    for (const v of Object.values(FIXTURE_ORGANISATION)) if (v) data.add(v);
    await screen.findByText("whisper.cpp");
    await user.click(screen.getByText("whisper.cpp"));
    await waitFor(() => expect(container.querySelector('[data-component="whisper.cpp"] pre')).not.toBeNull());
    expect(literalOffenders(view(), data)).toEqual([]);
  });

  it("is German by default and switches with the language switch at once", async () => {
    localStorage.removeItem("meeting-companion.locale");
    const user = userEvent.setup();
    await renderApp({ meeting: filledMeeting(), error: null });
    await openHelp(user, "Hilfe & Rechtliches");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hilfe & Rechtliches");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Hilfe", "Rechtliche Hinweise"]);
    expect(screen.getByRole("heading", { level: 2, name: "Tastenkürzel" })).toBeInTheDocument();
    expect(document.querySelector('[data-shortcut="openSettings"] kbd')).toHaveTextContent("Strg");
    const view = helpView();
    await user.click(visible("English"));
    expect(helpView()).toBe(view);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Help & legal");
    expect(screen.getByRole("heading", { level: 2, name: "Keyboard shortcuts" })).toBeInTheDocument();
    await openLegal(user);
    expect(screen.getByRole("heading", { level: 2, name: "Privacy notice" })).toBeInTheDocument();
    await user.click(visible("Deutsch"));
    expect(screen.getByRole("heading", { level: 2, name: "Datenschutzhinweis" })).toBeInTheDocument();
  });

  it("every section of both tabs has its id and an h2 under the one h1", async () => {
    const user = userEvent.setup();
    await setup();
    await openHelp(user);
    for (const tab of ["Help", "Legal notes"] as const) {
      await user.click(screen.getByRole("tab", { name: tab }));
      const sections = SECTIONS[tab === "Help" ? "help" : "legal"];
      const panel = screen.getByRole("tabpanel");
      expect(
        within(panel)
          .getAllByRole("heading", { level: 2 })
          .map((h) => h.closest("section")?.id),
      ).toEqual(sections.map((s) => s.id));
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    }
  });

  it("tabs follow the settings pattern: arrows, Home and End", async () => {
    const user = userEvent.setup();
    await setup();
    await openHelp(user);
    screen.getByRole("tab", { name: "Help" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Legal notes" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Legal notes" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Help" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Legal notes" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Help" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Legal notes" })).toHaveAttribute("tabindex", "-1");
  });
});
