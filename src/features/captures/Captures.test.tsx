// Job 018: quick capture in the live view's right column (AC1–AC5, component level).
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeClock } from "../../lib/clock";
import type { Capture } from "../../lib/ipc";
import { renderApp, type FakeRecording } from "../../test/backend";
import { FREE_TIMES, LIVE_TIMES, liveFreeMeeting, liveMeeting } from "../agenda/fixtures";
import type { Meeting } from "../agenda/model";
import { UNDO_MS } from "./model";

beforeEach(() => {
  localStorage.setItem("meeting-companion.locale", "en");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openLive(
  meeting: Meeting = liveMeeting(),
  rec: FakeRecording = {},
  time: number = LIVE_TIMES.running,
) {
  const clock = new FakeClock(time);
  const utils = await renderApp(
    { meeting, error: null },
    { clock, view: "live", recording: { captureNow: () => clock.now(), ...rec } },
  );
  return { clock, ...utils };
}

const column = () => screen.getByRole("region", { name: "Captured" });
const composer = () => screen.getByRole("form", { name: "Quick capture" });
const field = () => within(composer()).getByRole("textbox");
const tab = (name: RegExp) => within(column()).getByRole("button", { name });
const kindButton = (name: "Decision" | "To-do" | "Question") =>
  within(within(composer()).getByRole("group", { name: "Kind" })).getByRole("button", { name });
const list = () => within(column()).queryByTestId("capture-list");
const notice = () => screen.queryByTestId("undo-notice");
const agendaRow = (title: RegExp) =>
  within(screen.getByRole("region", { name: "Agenda" }))
    .getAllByRole("listitem")
    .find((li) => title.test(li.textContent ?? ""))!;

const stored = (over: Partial<Capture> = {}): Capture => ({
  id: "c-1",
  kind: "todo",
  text: "Send the invitations for the Thursday check-ins again",
  owner: "p-mk",
  due: "2026-11-09",
  itemId: "i-1",
  topicId: null,
  source: "typed",
  createdAt: LIVE_TIMES.start + 5 * 60_000,
  ...over,
});

describe("AC1 quick capture is saved durably", () => {
  it("Enter saves a decision to the running item; the field clears and keeps focus; counts go up", async () => {
    const user = userEvent.setup();
    const { core } = await openLive();
    expect(tab(/^Decisions/)).toHaveAttribute("aria-pressed", "true");
    expect(tab(/^Decisions/)).toHaveTextContent("0");
    await user.click(field());
    await user.type(field(), "Beta launches on the 14th without offline mode{Enter}");

    const add = core.calls.find((c) => c.cmd === "add_capture");
    expect(add?.args).toEqual({
      meetingId: "fixture-live",
      capture: {
        kind: "decision",
        text: "Beta launches on the 14th without offline mode",
        owner: null,
        due: null,
        itemId: "i-2",
        topicId: null,
      },
    });
    await waitFor(() => expect(field()).toHaveValue(""));
    expect(field()).toHaveFocus();
    expect(within(list()!).getByText("Beta launches on the 14th without offline mode")).toBeVisible();
    expect(
      within(list()!).getByRole("heading", { name: "Now · Item 02 · Beta launch: scope and date" }),
    ).toBeVisible();
    expect(tab(/^Decisions/)).toHaveTextContent("1");
    expect(agendaRow(/Beta launch/)).toHaveTextContent("1 decision");
    expect(core.captures()).toHaveLength(1);
  });

  it("/t switches kind and tab, takes owner and date chips, and saves a to-do with both", async () => {
    const user = userEvent.setup();
    const { core } = await openLive();
    await user.type(field(), "/t Write to the third pilot school");
    expect(field()).toHaveValue("Write to the third pilot school");
    expect(kindButton("To-do")).toHaveAttribute("aria-pressed", "true");
    expect(tab(/^To-dos/)).toHaveAttribute("aria-pressed", "true");
    const who = within(composer()).getByRole("group", { name: "Who" });
    await user.click(within(who).getByRole("button", { name: "Yusuf" }));
    const due = within(composer()).getByRole("group", { name: "Due" });
    // The fixture day is Friday 30 Oct 2026: the Friday chip is the next one.
    await user.click(within(due).getByRole("button", { name: /Nov 6/ }));
    await user.click(within(composer()).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(core.captures()).toHaveLength(1));
    const [c] = core.captures();
    expect(c).toMatchObject({
      kind: "todo",
      text: "Write to the third pilot school",
      owner: "p-ya",
      due: "2026-11-06",
      itemId: "i-2",
      topicId: null,
      source: "typed",
      createdAt: LIVE_TIMES.running,
    });
    expect(field()).toHaveFocus();
    const card = within(list()!).getByText("Write to the third pilot school").closest("article")!;
    expect(card).toHaveTextContent("Yusuf Aydin");
    expect(card).toHaveTextContent(/due Fri, Nov 6/);
    expect(agendaRow(/Beta launch/)).toHaveTextContent("1 to-do");
    // A kind button is one tap and switches the tab with it.
    await user.click(kindButton("Question"));
    expect(tab(/^Questions/)).toHaveAttribute("aria-pressed", "true");
  });

  it('shows the capture and "just saved" only after the core answered', async () => {
    const user = userEvent.setup();
    let release: (() => void) | null = null;
    const saved: Capture = stored({
      id: "c-9",
      kind: "decision",
      text: "Go",
      owner: null,
      due: null,
      itemId: "i-2",
      createdAt: LIVE_TIMES.running,
    });
    await openLive(liveMeeting(), {
      captureReply: (cmd) =>
        cmd === "add_capture"
          ? new Promise((resolve) => (release = () => resolve({ capture: saved, captures: [saved] })))
          : undefined,
    });
    await user.type(field(), "Go{Enter}");
    expect(release).not.toBeNull();
    expect(screen.queryByText("just saved")).toBeNull();
    expect(list()).toBeNull();
    expect(notice()).toBeNull();
    expect(field()).toHaveValue("Go");
    await act(async () => release!());
    expect(await screen.findByText("just saved")).toBeVisible();
    expect(field()).toHaveValue("");
    expect(notice()).toHaveTextContent("Decision saved · Item 02");
  });

  it("in agenda-free mode a capture goes to the running topic, otherwise to No topic", async () => {
    const user = userEvent.setup();
    const { core } = await openLive(liveFreeMeeting(), {}, FREE_TIMES.running);
    // At rest the composer is a one-line field; with focus it says where the capture goes.
    expect(within(composer()).queryByText("Interview recruiting")).not.toBeVisible();
    await user.click(field());
    expect(within(composer()).getByText("Interview recruiting")).toBeVisible();
    await user.type(field(), "First round remote{Enter}");
    await waitFor(() => expect(core.captures()).toHaveLength(1));
    expect(core.captures()[0]).toMatchObject({ itemId: null, topicId: "t-4" });
    const topics = screen.getByRole("region", { name: "Topics so far" });
    expect(within(topics).getByRole("button", { name: /Interview recruiting/ })).toHaveTextContent(
      "1 decision",
    );
    expect(
      within(list()!).getByRole("heading", { name: "Talking now · Interview recruiting" }),
    ).toBeVisible();

    // Stop the running topic: the next capture has no topic.
    await user.click(within(topics).getByRole("button", { name: /Interview recruiting/ }));
    await user.click(field());
    expect(within(composer()).getByText("No topic")).toBeVisible();
    await user.type(field(), "Offline mode after the beta{Enter}");
    await waitFor(() => expect(core.captures()).toHaveLength(2));
    expect(core.captures()[1]).toMatchObject({ itemId: null, topicId: null });
    expect(within(list()!).getByRole("heading", { name: "No topic" })).toBeVisible();
  });
});

describe("AC2 the core validates; errors show next to the field by key", () => {
  it("an empty or too long text is refused, the text is kept and nothing is stored", async () => {
    const user = userEvent.setup();
    const { core } = await openLive();
    await user.type(field(), "   {Enter}");
    expect(await within(composer()).findByText("Type something first.")).toBeVisible();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAccessibleDescription("Type something first.");

    await user.clear(field());
    await user.click(field());
    await user.paste("x".repeat(501));
    expect(within(composer()).getByText("501 / 500")).toBeVisible();
    await user.keyboard("{Enter}");
    expect(await within(composer()).findByText("At most 500 characters (now 501).")).toBeVisible();
    expect(field()).toHaveValue("x".repeat(501));
    expect(core.captures()).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a write the core could not do says so; the text stays", async () => {
    const user = userEvent.setup();
    await openLive(liveMeeting(), {
      captureReply: (cmd) => (cmd === "add_capture" ? Promise.reject({ kind: "storageFailed" }) : undefined),
    });
    await user.type(field(), "Ask the district office{Enter}");
    expect(
      await within(composer()).findByText(
        "Not saved: the meeting could not be written on this device. Try again.",
      ),
    ).toBeVisible();
    expect(field()).toHaveValue("Ask the district office");
    expect(field()).toHaveFocus();
    expect(notice()).toBeNull();
  });

  it("maps the core's field codes: unknown participant, wrong kind, unknown item, not running", async () => {
    const user = userEvent.setup();
    const replies: unknown[] = [
      { kind: "invalid", fields: [{ field: "owner", code: "notParticipant" }] },
      { kind: "invalid", fields: [{ field: "kind", code: "unknown" }] },
      { kind: "invalid", fields: [{ field: "itemId", code: "unknown" }] },
      { kind: "invalid", fields: [{ field: "due", code: "invalid" }] },
      { kind: "notRunning" },
    ];
    await openLive(liveMeeting(), {
      captureReply: (cmd) => (cmd === "add_capture" ? Promise.reject(replies.shift()) : undefined),
    });
    for (const message of [
      "This person is not in the meeting.",
      "Choose decision, to-do or question.",
      "That agenda item no longer exists.",
      "That date does not exist.",
      "Not saved: the meeting is no longer running.",
    ]) {
      await user.type(field(), "x{Enter}");
      expect(await within(composer()).findByText(message)).toBeVisible();
      await user.clear(field());
    }
  });
});

describe("AC3 everything captured can be edited or undone", () => {
  it("edit opens inline; Esc leaves the capture unchanged; Save writes the change", async () => {
    const user = userEvent.setup();
    const { core } = await openLive(liveMeeting(), { captures: [stored()] });
    await user.click(tab(/^To-dos/));
    const card = within(list()!)
      .getByText(/Thursday check-ins/)
      .closest("article")!;
    expect(within(card).queryByRole("button", { name: /Delete/ })).toBeNull();
    const edit = within(card).getByRole("button", { name: /^Edit: Send the invitations/ });
    await user.click(edit);
    const editor = within(list()!).getByRole("group", { name: /^Edit ?· Item 01$/ });
    const text = within(editor).getByRole("textbox", { name: "Text" });
    expect(text).toHaveFocus();
    await user.type(text, " now");
    await user.keyboard("{Escape}");
    expect(within(list()!).queryByRole("group", { name: /^Edit/ })).toBeNull();
    expect(core.calls.some((c) => c.cmd === "update_capture")).toBe(false);
    expect(within(list()!).getByText("Send the invitations for the Thursday check-ins again")).toBeVisible();
    expect(within(list()!).getByRole("button", { name: /^Edit: Send the invitations/ })).toHaveFocus();

    await user.click(within(list()!).getByRole("button", { name: /^Edit: Send the invitations/ }));
    const again = within(list()!).getByRole("group", { name: /^Edit/ });
    await user.clear(within(again).getByRole("textbox", { name: "Text" }));
    await user.type(within(again).getByRole("textbox", { name: "Text" }), "Reschedule the check-ins");
    await user.click(
      within(within(again).getByRole("group", { name: "Who" })).getByRole("button", { name: "Lena" }),
    );
    await user.click(within(again).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(core.captures()[0]?.text).toBe("Reschedule the check-ins"));
    expect(core.captures()[0]).toMatchObject({
      id: "c-1",
      owner: "p-ls",
      itemId: "i-1",
      createdAt: stored().createdAt,
    });
    const updated = within(list()!).getByText("Reschedule the check-ins").closest("article")!;
    expect(updated).toHaveTextContent("edited");
    expect(updated).toHaveTextContent("Lena Sommer");
  });

  it("delete lives in the editor; Undo within 8 s restores it with its id, time and item", async () => {
    const user = userEvent.setup();
    const { core, clock } = await openLive(liveMeeting(), { captures: [stored()] });
    await user.click(tab(/^To-dos/));
    expect(agendaRow(/Check-in/)).toHaveTextContent("1 to-do");
    await user.click(within(list()!).getByRole("button", { name: /^Edit:/ }));
    await user.click(within(list()!).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(core.captures()).toEqual([]));
    expect(within(column()).queryByRole("article")).toBeNull();
    expect(tab(/^To-dos/)).toHaveTextContent("0");
    expect(agendaRow(/Check-in/)).not.toHaveTextContent("to-do");
    expect(notice()).toHaveTextContent("To-do deleted");
    expect(notice()).toHaveTextContent("“Send the invitations for the Thursday check-ins again”");
    expect(field()).toHaveFocus();

    act(() => clock.advance(UNDO_MS - 100));
    expect(notice()).not.toBeNull();
    await user.click(within(notice()!).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(core.captures()).toEqual([stored()]));
    const restore = core.calls.find((c) => c.cmd === "restore_capture");
    expect(restore?.args).toEqual({ meetingId: "fixture-live", capture: stored() });
    expect(within(list()!).getByText(/Thursday check-ins/)).toBeVisible();
    expect(tab(/^To-dos/)).toHaveTextContent("1");
    expect(notice()).toHaveTextContent("Restored");
  });

  it("a new capture's Undo removes it again; the notice goes after 8 s", async () => {
    const user = userEvent.setup();
    const { core, clock } = await openLive();
    await user.type(field(), "Pilot check-in moves to Thursdays{Enter}");
    await waitFor(() => expect(core.captures()).toHaveLength(1));
    expect(notice()).toHaveTextContent("Decision saved · Item 02");
    await user.click(within(notice()!).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(core.captures()).toEqual([]));
    expect(core.calls.filter((c) => c.cmd === "delete_capture")).toHaveLength(1);
    expect(tab(/^Decisions/)).toHaveTextContent("0");
    expect(agendaRow(/Beta launch/)).not.toHaveTextContent("decision");

    await user.type(field(), "Second one{Enter}");
    await waitFor(() => expect(core.captures()).toHaveLength(1));
    act(() => clock.advance(UNDO_MS - 1));
    expect(notice()).not.toBeNull();
    act(() => clock.advance(1));
    expect(notice()).toBeNull();
    expect(screen.queryByText("just saved")).toBeNull();
  });
});

describe("round 2: the composer rests as one line, and while a card is edited", () => {
  it("shows kind buttons and the field at rest; owner, date and Save open with focus; an editor closes them", async () => {
    const user = userEvent.setup();
    await openLive(liveMeeting(), { captures: [stored()] });
    await user.click(tab(/^To-dos/));
    expect(composer()).toHaveAttribute("data-open", "false");
    expect(within(composer()).queryByRole("group", { name: "Who" })).toBeNull();
    expect(within(composer()).getByRole("button", { name: "Save", hidden: true })).not.toBeVisible();
    await user.click(field());
    expect(composer()).toHaveAttribute("data-open", "true");
    expect(within(composer()).getByRole("group", { name: "Who" })).toBeVisible();
    expect(within(composer()).getByRole("button", { name: "Save" })).toBeVisible();
    // A draft keeps it open, until a card's editor opens.
    await user.type(field(), "draft");
    await user.click(within(list()!).getByRole("button", { name: /^Edit:/ }));
    expect(composer()).toHaveAttribute("data-open", "false");
    expect(field()).toHaveValue("draft");
    await user.keyboard("{Escape}");
    expect(composer()).toHaveAttribute("data-open", "true");
  });
});

describe("AC4 capture text stays inert", () => {
  it("markup and script are shown literally", async () => {
    const user = userEvent.setup();
    const { container } = await openLive();
    const text = '<img src=x onerror="alert(1)"><b>bold</b><script>alert(2)</script>';
    await user.click(field());
    await user.paste(text);
    await user.keyboard("{Enter}");
    expect(await within(list()!).findByText(text)).toBeVisible();
    expect(container.querySelector("img, b, script")).toBeNull();
  });
});

describe("AC5 usable while talking", () => {
  it("announces a saved capture once through the polite live region", async () => {
    const user = userEvent.setup();
    await openLive();
    const live = screen.getByTestId("nudge-announcement");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toBeEmptyDOMElement();
    await user.type(field(), "Go with the 14th{Enter}");
    await waitFor(() => expect(live.textContent?.trim()).toBe("Decision saved · Item 02"));
    // Typing on does not repeat it.
    await user.type(field(), "more");
    expect(live.textContent?.trim()).toBe("Decision saved · Item 02");
  });

  it("Tab reaches every control of the composer in order; Esc clears the field", async () => {
    const user = userEvent.setup();
    await openLive();
    await user.click(kindButton("To-do"));
    const order = [
      kindButton("Question"),
      field(),
      ...within(within(composer()).getByRole("group", { name: "Who" })).getAllByRole("button"),
      ...within(within(composer()).getByRole("group", { name: "Due" })).getAllByRole("button"),
      within(composer()).getByRole("button", { name: "Save" }),
    ];
    for (const el of order) {
      await user.tab();
      expect(el).toHaveFocus();
    }
    await user.click(field());
    await user.type(field(), "draft");
    await user.keyboard("{Escape}");
    expect(field()).toHaveValue("");
  });

  it("is German by default and uses du", async () => {
    localStorage.removeItem("meeting-companion.locale");
    const user = userEvent.setup();
    await openLive(liveMeeting(), {
      captureReply: (cmd) => (cmd === "add_capture" ? Promise.reject({ kind: "storageFailed" }) : undefined),
    });
    expect(screen.getByRole("region", { name: "Festgehalten" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Beschluss notieren …" })).toBeVisible();
    expect(screen.getByText("Noch nichts festgehalten")).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: "Beschluss notieren …" }), "x{Enter}");
    expect(
      await screen.findByText(
        "Nicht gespeichert: Das Meeting konnte auf diesem Gerät nicht geschrieben werden. Versuch es noch einmal.",
      ),
    ).toBeVisible();
  });

  it("below 1200 px the captures are the centre card's second tab and the composer stays below", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width: 1199px"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const user = userEvent.setup();
    await openLive(liveMeeting(), { captures: [stored()] });
    expect(screen.queryByRole("region", { name: "Captured" })).toBeNull();
    const view = screen.getByRole("group", { name: "View" });
    const captured = within(view).getByRole("button", { name: /^Captured/ });
    expect(captured).toHaveTextContent("1");
    expect(within(view).getByRole("button", { name: "Transcript" })).toHaveAttribute("aria-pressed", "true");
    await user.click(captured);
    expect(captured).toHaveAttribute("aria-pressed", "true");
    const panel = screen.getByTestId("captures-column");
    await user.click(within(panel).getByRole("button", { name: /^To-dos/ }));
    expect(within(panel).getByText(/Thursday check-ins/)).toBeVisible();
    expect(document.querySelector(".transcript-card__body")).not.toBeVisible();
    // The composer is outside the card and saves as in the wide layout.
    await user.type(field(), "Ask Jana{Enter}");
    expect(await within(panel).findByText("Ask Jana")).toBeVisible();
    expect(captured).toHaveTextContent("2");
  });
});

describe("AC5 every string of the column comes from a key", () => {
  it("empty column, cards, editor, error and notice show only keys and user data", async () => {
    const user = userEvent.setup();
    const meeting = liveMeeting();
    const clock = new FakeClock(LIVE_TIMES.running);
    await renderApp(
      { meeting, error: null },
      {
        clock,
        view: "live",
        keyMode: true,
        recording: {
          captures: [stored()],
          captureNow: () => clock.now(),
        },
      },
    );
    const userData = new Set([
      stored().text,
      ...meeting.participants.flatMap((p) => [
        p.name,
        p.name.split(" ")[0]!,
        p.name
          .split(" ")
          .map((w) => w[0])
          .join(""),
      ]),
      ...meeting.items.map((i) => i.title),
    ]);
    const offenders = () => {
      const root = screen.getByTestId("captures-column");
      const out: string[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n.textContent ?? "").trim();
        if (!text || /^(⟦[\w.]+⟧\s*)+$/.test(text) || /^[\d\s:.,\-–·/]+$/.test(text) || userData.has(text))
          continue;
        // Dates and times are formatted by Intl, not text.
        if (/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d+$/.test(text)) continue;
        out.push(text);
      }
      for (const el of root.querySelectorAll("[aria-label],[placeholder],[title]")) {
        for (const attr of ["aria-label", "placeholder", "title"]) {
          const v = el.getAttribute(attr);
          if (v !== null && !/^(⟦[\w.]+⟧\s*)+$/.test(v) && !userData.has(v)) out.push(`${attr}: ${v}`);
        }
      }
      return out;
    };
    expect(offenders()).toEqual([]);
    const col = screen.getByTestId("captures-column");
    // To-dos tab with the card, the editor, a refused save and the notice after a delete.
    await user.click(within(col).getAllByRole("button")[1]!);
    expect(offenders()).toEqual([]);
    await user.click(col.querySelector<HTMLButtonElement>("[data-edit]")!);
    expect(offenders()).toEqual([]);
    const editor = col.querySelector(".capture-editor")!;
    await user.clear(within(editor as HTMLElement).getByRole("textbox"));
    await user.keyboard("{Enter}");
    expect(await within(col).findByText("⟦captures.error.text.empty⟧")).toBeVisible();
    expect(offenders()).toEqual([]);
    await user.click(within(editor as HTMLElement).getByRole("button", { name: "⟦captures.edit.delete⟧" }));
    expect(await screen.findByTestId("undo-notice")).toBeVisible();
    expect(offenders()).toEqual([]);
  });
});
