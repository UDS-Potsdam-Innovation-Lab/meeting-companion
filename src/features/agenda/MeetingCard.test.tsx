import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "../../test/backend";
import { filledMeeting } from "./fixtures";

const XSS = "<img src=x onerror=alert(1)>";

async function setup() {
  localStorage.setItem("meeting-companion.locale", "en");
  const user = userEvent.setup();
  const r = await renderApp({ meeting: filledMeeting(), error: null });
  return { user, ...r };
}

describe("AC2 meeting card", () => {
  it("edits title, date and time slot and saves each valid change", async () => {
    const { user, core } = await setup();
    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Team sync");
    await waitFor(() => expect(core.last()?.title).toBe("Team sync"));

    const date = screen.getByLabelText("Date");
    await user.clear(date);
    await user.type(date, "2026-11-02");
    await waitFor(() => expect(core.last()?.date).toBe("2026-11-02"));

    const end = screen.getByLabelText("End");
    await user.clear(end);
    await user.type(end, "11:30");
    await waitFor(() => expect(core.last()?.end).toBe("11:30"));
    expect(screen.getByRole("status")).toHaveTextContent("55 of 90 min planned · 35 min buffer");
  });

  it("rejects an empty title next to the field and does not save it", async () => {
    const { user, core } = await setup();
    const title = screen.getByLabelText("Title");
    await user.clear(title);
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title).toHaveAccessibleDescription("Please enter a title.");
    expect(core.saved.every((m) => m.title !== "")).toBe(true);
  });

  it("rejects a title over 200 characters and does not save it", async () => {
    const { user, core } = await setup();
    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.click(title);
    await user.paste("a".repeat(201));
    expect(title).toHaveAccessibleDescription("The title can be at most 200 characters long.");
    expect(core.saved.some((m) => m.title.length > 200)).toBe(false);
  });

  it("rejects an end time that is not after the start, and does not save it", async () => {
    const { user, core } = await setup();
    const end = screen.getByLabelText("End");
    await user.clear(end);
    await user.type(end, "09:30");
    expect(end).toHaveAccessibleDescription("The end must be after the start.");
    expect(core.saved.some((m) => m.end === "09:30")).toBe(false);

    const start = screen.getByLabelText("Start");
    await user.clear(start);
    await user.type(start, "09:00");
    // 09:00–09:30 is valid again and is saved as one change.
    await waitFor(() => expect(core.last()).toMatchObject({ start: "09:00", end: "09:30" }));
    expect(end).not.toHaveAttribute("aria-invalid");
  });

  it("adds and removes participants with initials avatars", async () => {
    const { user, core } = await setup();
    await user.type(screen.getByLabelText("Add a person"), "Özlem Şahin{Enter}");
    await waitFor(() => expect(core.last()?.participants.map((p) => p.name)).toContain("Özlem Şahin"));
    const item = screen.getByText("Özlem Şahin").closest("li")!;
    expect(item).toHaveTextContent("ÖŞ");
    expect(screen.getByRole("heading", { name: "6 participants" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Özlem Şahin" }));
    await waitFor(() => expect(core.last()?.participants.map((p) => p.name)).not.toContain("Özlem Şahin"));
  });

  it("rejects an empty participant name and does not save", async () => {
    const { user, core } = await setup();
    const before = core.saved.length;
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByLabelText("Add a person")).toHaveAccessibleDescription("Please enter a name.");
    expect(core.saved.length).toBe(before);
  });

  it("rejects a duplicate participant name and does not save", async () => {
    const { user, core } = await setup();
    const before = core.saved.length;
    await user.type(screen.getByLabelText("Add a person"), "  mara klein {Enter}");
    expect(screen.getByLabelText("Add a person")).toHaveAccessibleDescription(
      "This person is already on the list.",
    );
    expect(core.saved.length).toBe(before);
  });

  it("renders markup in names and titles as literal text", async () => {
    const { user, core, container } = await setup();
    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.click(title);
    await user.paste(XSS);
    await user.click(screen.getByLabelText("Add a person"));
    await user.paste(XSS);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(core.last()?.participants.map((p) => p.name)).toContain(XSS));

    expect(title).toHaveValue(XSS);
    expect(screen.getByText(XSS)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("button", { name: `Remove ${XSS}` })).toBeInTheDocument();
  });
});
