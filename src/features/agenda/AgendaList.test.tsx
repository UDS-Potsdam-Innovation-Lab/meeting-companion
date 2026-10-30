import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "../../test/backend";
import { filledMeeting, overBudgetMeeting } from "./fixtures";
import type { Meeting } from "./model";

async function setup(meeting: Meeting | null = filledMeeting()) {
  localStorage.setItem("meeting-companion.locale", "en");
  const user = userEvent.setup();
  const r = await renderApp({ meeting, error: null });
  return { user, ...r };
}

const rowTitles = () =>
  Array.from(document.querySelectorAll(".agenda-row__title")).map((el) => el.textContent);
const rowNumbers = () =>
  Array.from(document.querySelectorAll(".agenda-row__num")).map((el) => el.textContent);

describe("AC3 agenda list", () => {
  it("shows items numbered 01, 02, … with lead, goal and time", async () => {
    await setup();
    expect(rowNumbers()).toEqual(["01", "02", "03", "04", "05"]);
    const second = document.querySelectorAll(".agenda-row")[1] as HTMLElement;
    expect(second).toHaveTextContent("Beta launch: scope and date");
    expect(second).toHaveTextContent("Outcome: a launch date everyone commits to");
    expect(within(second).getByRole("img", { name: "Lead: Tobias Brandt" })).toHaveTextContent("TB");
    expect(second).toHaveTextContent("Decide");
    expect(second).toHaveTextContent("15 min");
  });

  it("adds a topic with title, outcome, lead, goal and minutes", async () => {
    const { user, core } = await setup();
    await user.click(screen.getByRole("button", { name: "Add topic" }));
    const editor = screen.getByRole("group", { name: "Edit topic" });
    const title = within(editor).getByLabelText("Topic");
    expect(title).toHaveFocus();
    await user.type(title, "Wrap-up");
    await user.type(within(editor).getByLabelText("Outcome (optional)"), "Owners for every to-do");
    await user.selectOptions(within(editor).getByLabelText("Lead"), "Jana Roth");
    await user.click(within(editor).getByLabelText("Inform"));
    const minutes = within(editor).getByLabelText("Minutes");
    await user.clear(minutes);
    await user.type(minutes, "5");
    await waitFor(() =>
      expect(core.last()?.items[5]).toMatchObject({
        title: "Wrap-up",
        outcome: "Owners for every to-do",
        lead: "p-jr",
        goal: "inform",
        minutes: 5,
      }),
    );
    expect(rowNumbers()).toEqual(["01", "02", "03", "04", "05", "06"]);
    await user.click(within(editor).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("group", { name: "Edit topic" })).toBeNull();
  });

  it("a new topic without a title is not saved and disappears when closed", async () => {
    const { user, core } = await setup();
    const before = core.saved.length;
    await user.click(screen.getByRole("button", { name: "Add topic" }));
    await user.keyboard("{Escape}");
    expect(rowTitles()).toHaveLength(5);
    expect(core.saved.length).toBe(before);
    expect(screen.getByRole("button", { name: "Add topic" })).toHaveFocus();
  });

  it("rejects minutes outside 1–240 and an empty topic, without saving", async () => {
    const { user, core } = await setup();
    await user.click(screen.getByRole("button", { name: /^Check-in & goals/ }));
    const editor = screen.getByRole("group", { name: "Edit topic" });
    const minutes = within(editor).getByLabelText("Minutes");
    await user.clear(minutes);
    await user.type(minutes, "241");
    expect(minutes).toHaveAccessibleDescription("Please enter whole minutes between 1 and 240.");
    await user.clear(minutes);
    await user.type(minutes, "0");
    expect(minutes).toHaveAttribute("aria-invalid", "true");
    const title = within(editor).getByLabelText("Topic");
    await user.clear(title);
    expect(title).toHaveAccessibleDescription("Please enter a topic.");
    expect(
      core.saved.some((m) => m.items.some((i) => i.minutes > 240 || i.minutes < 1 || i.title === "")),
    ).toBe(false);
  });

  it("edits an existing item; the selected row is highlighted", async () => {
    const { user, core } = await setup();
    const topic = screen.getByRole("button", { name: /^Pilot schools/ });
    await user.click(topic);
    expect(topic).toHaveAttribute("aria-expanded", "true");
    expect(topic.closest("li")).toHaveClass("is-selected");
    const editor = screen.getByRole("group", { name: "Edit topic" });
    await user.click(within(editor).getByLabelText("Decide"));
    await waitFor(() => expect(core.last()?.items[2]?.goal).toBe("decide"));
  });

  it("moves items up and down and removes them", async () => {
    const { user, core } = await setup();
    await user.click(screen.getByRole("button", { name: "Move “Check-in & goals” down" }));
    expect(rowTitles().slice(0, 2)).toEqual(["Beta launch: scope and date", "Check-in & goals"]);
    expect(screen.getByRole("button", { name: "Move “Check-in & goals” down" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Move “Open questions & next steps” up" }));
    expect(rowTitles()[3]).toBe("Open questions & next steps");
    await user.click(screen.getByRole("button", { name: "Remove “Budget for Q1 user research”" }));
    expect(rowTitles()).not.toContain("Budget for Q1 user research");
    expect(rowNumbers()).toEqual(["01", "02", "03", "04"]);
    await waitFor(() => expect(core.last()?.items.map((i) => i.id)).toEqual(["i-2", "i-1", "i-3", "i-5"]));
    expect(screen.getByRole("button", { name: "Move “Beta launch: scope and date” up" })).toBeDisabled();
  });

  it("moves items with the keyboard", async () => {
    const { user } = await setup();
    screen.getByRole("button", { name: "Move “Check-in & goals” down" }).focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    expect(rowTitles()[2]).toBe("Check-in & goals");
    await user.keyboard("{Shift>}{Tab}{/Shift}{Enter}");
    expect(rowTitles()[1]).toBe("Check-in & goals");
  });

  it("offers only the meeting's participants as lead", async () => {
    const { user } = await setup();
    await user.click(screen.getByRole("button", { name: /^Check-in & goals/ }));
    const options = within(screen.getByLabelText("Lead")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "No lead",
      "Mara Klein",
      "Tobias Brandt",
      "Lena Sommer",
      "Yusuf Aydin",
      "Jana Roth",
    ]);
  });

  it("removing a participant clears them as lead on their items", async () => {
    const { user, core } = await setup();
    await user.click(screen.getByRole("button", { name: "Remove Mara Klein" }));
    await waitFor(() =>
      expect(
        core
          .last()
          ?.items.filter((i) => i.lead === null)
          .map((i) => i.id),
      ).toEqual(["i-1", "i-5"]),
    );
    const first = document.querySelectorAll(".agenda-row")[0] as HTMLElement;
    expect(within(first).getByRole("img", { name: "No lead" })).toBeInTheDocument();
  });

  it("an empty meeting shows only Add topic and 0 of M", async () => {
    await setup(null);
    expect(screen.getByText("No topics yet. Add the first one.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/^0 of 60 min planned · 60 min buffer$/);
  });
});

describe("AC4 budget line", () => {
  it("under the slot shows the buffer", async () => {
    await setup();
    const line = screen.getByRole("status");
    expect(line).toHaveTextContent("55 of 60 min planned · 5 min buffer");
    expect(line).not.toHaveClass("budget-line--over");
  });

  it("exactly the slot shows no buffer", async () => {
    const m = filledMeeting();
    m.items[0]!.minutes = 10;
    await setup(m);
    expect(screen.getByRole("status")).toHaveTextContent("60 of 60 min planned · 0 min buffer");
  });

  it("over the slot says how much over, in text and in the overrun colour", async () => {
    await setup(overBudgetMeeting());
    const line = screen.getByRole("status");
    expect(line).toHaveTextContent("70 of 60 min planned · 10 min over");
    expect(line).toHaveClass("budget-line--over");
  });
});
