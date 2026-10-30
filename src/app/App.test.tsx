import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "../test/backend";
import { filledMeeting } from "../features/agenda/fixtures";

describe("AC5 start-up and storage", () => {
  it("reopens the most recently edited meeting with all fields", async () => {
    localStorage.setItem("meeting-companion.locale", "en");
    const { core } = await renderApp({ meeting: filledMeeting(), error: null });
    expect(screen.getByLabelText("Title")).toHaveValue("Product sync · Beta launch");
    expect(screen.getByLabelText("Date")).toHaveValue("2026-10-30");
    expect(screen.getByLabelText("Start")).toHaveValue("10:00");
    expect(screen.getByLabelText("End")).toHaveValue("11:00");
    expect(screen.getByText("Yusuf Aydin")).toBeInTheDocument();
    expect(screen.getByText("Outcome: a launch date everyone commits to")).toBeInTheDocument();
    // Opening does not write anything.
    expect(core.saved).toHaveLength(0);
    await waitFor(() => expect(core.readyViews).toContain("agenda-setup"));
  });

  it("shows an error and an empty new meeting when the stored file is corrupt", async () => {
    localStorage.setItem("meeting-companion.locale", "en");
    const { core } = await renderApp({ meeting: null, error: "corrupt" });
    expect(screen.getByRole("alert")).toHaveTextContent("The meeting you edited last could not be read.");
    expect(screen.getByRole("alert")).toHaveTextContent("The saved file is left unchanged.");
    expect(screen.getByLabelText("Title")).toHaveValue("New meeting");
    expect(screen.getByText("No topics yet. Add the first one.")).toBeInTheDocument();
    expect(core.saved).toHaveLength(0);
  });

  it("a missing keychain key shows a lasting error and nothing claims to be saved", async () => {
    localStorage.setItem("meeting-companion.locale", "en");
    const user = userEvent.setup();
    const { mockIPC } = await import("@tauri-apps/api/mocks");
    await renderApp({ meeting: null, error: "keyUnavailable" });
    expect(screen.getByRole("alert")).toHaveTextContent("Your saved meetings cannot be decrypted right now.");
    expect(screen.getByRole("alert")).toHaveTextContent("The files stay unchanged");
    expect(screen.queryByRole("button", { name: "Dismiss message" })).toBeNull();
    mockIPC((cmd) => {
      if (cmd === "save_meeting") throw { kind: "locked" };
      return null;
    });
    await user.type(screen.getByLabelText("Title"), "!");
    await user.click(screen.getByRole("button", { name: "New meeting" }));
    // Still exactly one message, the key message.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("cannot be decrypted");
  });

  it("New meeting starts an empty meeting and saves it", async () => {
    localStorage.setItem("meeting-companion.locale", "en");
    const user = userEvent.setup();
    const { core } = await renderApp({ meeting: filledMeeting(), error: null });
    await user.click(screen.getByRole("button", { name: "New meeting" }));
    expect(screen.getByLabelText("Title")).toHaveValue("New meeting");
    await waitFor(() => expect(core.last()?.items).toEqual([]));
    expect(core.last()?.id).not.toBe(filledMeeting().id);
  });

  it("shows a message when a save fails", async () => {
    localStorage.setItem("meeting-companion.locale", "en");
    const user = userEvent.setup();
    await renderApp({ meeting: filledMeeting(), error: null });
    const { mockIPC } = await import("@tauri-apps/api/mocks");
    mockIPC((cmd) => {
      if (cmd === "save_meeting") throw { kind: "io" };
      return null;
    });
    await user.type(screen.getByLabelText("Title"), "!");
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be saved");
  });
});

describe("AC6 language", () => {
  it("is German on first start", async () => {
    await renderApp();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Was steht auf der Agenda?");
    expect(document.documentElement.lang).toBe("de");
    expect(screen.getByRole("button", { name: "Deutsch" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches all visible text without a reload and remembers the choice", async () => {
    const user = userEvent.setup();
    const { unmount } = await renderApp({ meeting: filledMeeting(), error: null });
    const titleInput = screen.getByLabelText("Titel");
    await user.type(titleInput, "!");
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("What's on the agenda?");
    expect(screen.getByRole("status")).toHaveTextContent("55 of 60 min planned · 5 min buffer");
    // Same element, typed text kept: no reload.
    expect(screen.getByLabelText("Title")).toBe(titleInput);
    expect(titleInput).toHaveValue("Product sync · Beta launch!");
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("meeting-companion.locale")).toBe("en");

    unmount();
    await renderApp({ meeting: filledMeeting(), error: null });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("What's on the agenda?");
  });
});
