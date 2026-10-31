import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emit } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messages } from "../../i18n";
import { EVENT_CAPTURE, type CaptureState, type LlmTestReply } from "../../lib/ipc";
import {
  FAKE_LLM_MODELS,
  FAKE_LLM_REPLY,
  renderApp,
  type FakeCore,
  type FakeRecording,
} from "../../test/backend";
import { filledMeeting } from "../agenda/fixtures";

// Job 011, frame 17 "Language model".

const MARKER = "FAKE-MARKER-KEY-for-tests-only-6630";
const QWEN = FAKE_LLM_MODELS.models[0]!;

beforeEach(() => {
  localStorage.setItem("meeting-companion.locale", "en");
});

afterEach(() => {
  vi.restoreAllMocks();
});

const changes = (core: FakeCore) =>
  core.calls.filter((c) => c.cmd === "update_setting").map((c) => (c.args as { change: unknown }).change);
const settingsButton = () =>
  screen.getAllByRole("button", { name: "Settings" }).find((b) => !b.closest("[hidden]"))!;
const engineRadio = (name: RegExp) => screen.getByRole("radio", { name });

async function openSection(rec: FakeRecording = {}) {
  const user = userEvent.setup();
  const rendered = await renderApp(
    { meeting: filledMeeting(), error: null },
    { recording: { ...rec, settings: { locale: "en", ...rec.settings } } },
  );
  await user.click(settingsButton());
  await user.click(screen.getByRole("tab", { name: /^Language model/ }));
  await screen.findByRole("heading", { name: "Language model", level: 2 });
  return { user, ...rendered };
}

describe("AC5 the section and its engine choice", () => {
  it("sits between On this device and General, with Off chosen by default and Test disabled", async () => {
    await openSection();
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual([
      expect.stringMatching(/^Audio/),
      expect.stringMatching(/^On this device/),
      expect.stringMatching(/^Language model/),
      expect.stringMatching(/^General/),
    ]);
    expect(engineRadio(/^Off/)).toBeChecked();
    expect(engineRadio(/^On this device/)).not.toBeChecked();
    expect(engineRadio(/^Claude API \(cloud\)/)).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Test" })).toBeDisabled();
    expect(screen.getByText("Choose an engine to test it.")).toBeVisible();
    // No Save button: every change goes to the store at once.
    expect(screen.queryByRole("button", { name: /^Save$/ })).toBeNull();
  });

  it("On this device lists the GGUF models with size and folder and applies the first one at once", async () => {
    const { user, core } = await openSection();
    await user.click(engineRadio(/^On this device/));
    expect(changes(core)).toEqual([{ key: "languageModel", value: { local: QWEN.id } }]);
    const card = screen.getByRole("region", { name: "Model on this device" });
    expect(within(card).getByRole("radio", { name: QWEN.name })).toBeChecked();
    expect(within(card).getByText("2.0 GB · Hugging Face")).toBeVisible();
    expect(within(card).getAllByText("Found in /m")).toHaveLength(2);
    await user.click(within(card).getByRole("radio", { name: FAKE_LLM_MODELS.models[1]!.name }));
    expect(changes(core).at(-1)).toEqual({
      key: "languageModel",
      value: { local: FAKE_LLM_MODELS.models[1]!.id },
    });
    expect(core.events.at(-1)?.event).toBe("settings-changed");
  });

  it("with no model found it shows the folders searched and changes nothing", async () => {
    const { user, core } = await openSection({
      llmModels: { models: [], searched: ["/a/models", "/b/hub"], available: true },
    });
    await user.click(engineRadio(/^On this device/));
    const none = screen.getByTestId("no-llm-model");
    expect(none).toHaveTextContent("No language model found on this device");
    expect(none).toHaveTextContent("/a/models");
    expect(none).toHaveTextContent("/b/hub");
    expect(changes(core)).toEqual([]);
    expect(engineRadio(/^Off/)).toBeChecked();
  });

  it("AC1 a chosen model that disappeared shows Not found any more and nothing switches", async () => {
    const { core } = await openSection({
      settings: { languageModel: { local: "/gone/Phi-4-mini-Q4_K_M.gguf" } },
      llmTest: () => Promise.reject({ kind: "noModel" }),
    });
    expect(engineRadio(/^On this device/)).toBeChecked();
    const gone = screen.getByTestId("llm-model-gone");
    expect(gone).toHaveTextContent("Phi-4-mini-Q4_K_M.gguf");
    expect(gone).toHaveTextContent("Not found any more");
    expect(screen.getByText("The chosen model was moved or deleted.")).toBeVisible();
    expect(screen.getByText(/does not switch to another model or to Claude by itself/)).toBeVisible();
    const card = screen.getByRole("region", { name: "Model on this device" });
    for (const r of within(card).getAllByRole("radio")) expect(r).not.toBeChecked();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByTestId("llm-error")).toHaveTextContent("No model");
    expect(changes(core)).toEqual([]);
  });

  it("while this version has no local runtime, On this device cannot be chosen and says why", async () => {
    await openSection({ llmModels: { models: [], searched: ["/a"], available: false } });
    expect(engineRadio(/^On this device/)).toBeDisabled();
    expect(screen.getByText("Not available in this version yet.")).toBeVisible();
  });

  it("the Claude model comes from the closed list and applies at once", async () => {
    const { user, core } = await openSection({ settings: { languageModel: "claude" }, apiKeySet: true });
    const select = screen.getByRole("combobox", { name: "Model" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Claude Sonnet 5.5", "Claude Haiku 5.5", "Claude Opus 5.5"]);
    expect(select).toHaveValue("sonnet");
    await user.selectOptions(select, "haiku");
    expect(changes(core)).toEqual([{ key: "claudeModel", value: "haiku" }]);
  });
});

describe("AC3 Claude only after a person confirms the destination", () => {
  it("shows an inline confirmation naming Anthropic and what is sent; Cancel leaves the setting", async () => {
    const { user, core } = await openSection();
    await user.click(engineRadio(/^Claude API \(cloud\)/));
    const confirm = screen.getByTestId("llm-confirm");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(confirm).getByRole("heading", { name: "Send text to Anthropic?" })).toBeVisible();
    expect(within(confirm).getByTestId("llm-destination")).toHaveTextContent(
      "Anthropic, api.anthropic.com, USA",
    );
    expect(confirm).toHaveTextContent(/text from your meetings, when a feature asks for it/i);
    expect(screen.getByText("Confirm below to switch")).toBeVisible();
    // Nothing changed yet, Off is still the setting.
    expect(changes(core)).toEqual([]);
    expect(engineRadio(/^Off/)).toBeChecked();
    // The confirmation follows the choice in the tab order; focus is not moved away from the radios.
    expect(engineRadio(/^Claude API/)).toHaveFocus();
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("llm-confirm")).toBeNull();
    expect(changes(core)).toEqual([]);
    expect(engineRadio(/^Off/)).toBeChecked();
    expect(engineRadio(/^Claude API/)).toHaveFocus();
    expect(core.settings.languageModel).toBe("none");
  });

  it("Use Claude API changes the setting; the destination line stays while Claude is chosen", async () => {
    const { user, core } = await openSection();
    await user.click(engineRadio(/^Claude API \(cloud\)/));
    await user.click(screen.getByRole("button", { name: "Use Claude API" }));
    expect(changes(core)).toEqual([{ key: "languageModel", value: "claude" }]);
    expect(engineRadio(/^Claude API/)).toBeChecked();
    expect(await screen.findByTestId("llm-destination-line")).toHaveTextContent(
      "Text goes to Anthropic, api.anthropic.com, USA",
    );
    // Off switches back without a confirmation.
    await user.click(engineRadio(/^Off/));
    expect(changes(core).at(-1)).toEqual({ key: "languageModel", value: "none" });
    expect(screen.queryByTestId("llm-destination-line")).toBeNull();
  });
});

describe("AC2 the API key: keychain only, the UI learns set yes/no", () => {
  it("the field is a password field without autocomplete, cleared after saving; the key is nowhere else", async () => {
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const { user, core, container } = await openSection({ settings: { languageModel: "claude" } });
    expect(await screen.findByTestId("key-status")).toHaveTextContent("No key");
    const field = screen.getByLabelText("Claude API key");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAttribute("autocomplete", "off");
    const save = screen.getByRole("button", { name: "Save key" });
    expect(save).toBeDisabled();
    await user.type(field, `  ${MARKER}  `);
    await user.click(save);
    expect(await screen.findByTestId("key-status")).toHaveTextContent("Key saved");
    expect(screen.getByText("In the system keychain. The app never shows it.")).toBeVisible();
    expect(screen.queryByLabelText("Claude API key")).toBeNull();
    // The key went to the core once, in the set_api_key request, and came back nowhere.
    const sent = core.calls.filter((c) => JSON.stringify(c.args ?? null).includes(MARKER));
    expect(sent.map((c) => c.cmd)).toEqual(["set_api_key"]);
    for (const r of core.responses) expect(JSON.stringify(r ?? null)).not.toContain(MARKER);
    for (const e of core.events) expect(JSON.stringify(e)).not.toContain(MARKER);
    expect(core.responses).toContainEqual({ set: true });
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      expect(`${k}=${localStorage.getItem(k)}`).not.toContain(MARKER);
    }
    expect(container.innerHTML).not.toContain(MARKER);
    for (const spy of [log, warn, error])
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(MARKER);

    // Replace: the field comes back empty.
    await user.click(screen.getByRole("button", { name: "Replace key" }));
    expect(screen.getByLabelText("Claude API key")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    // Remove: inline confirmation, then the keychain entry is deleted.
    await user.click(screen.getByRole("button", { name: "Remove key" }));
    expect(screen.getByText("Remove the key from the keychain?")).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getAllByRole("button", { name: "Remove key" })[0]!);
    expect(await screen.findByTestId("key-status")).toHaveTextContent("No key");
    expect(core.apiKeySet).toBe(false);
    expect(core.calls.some((c) => c.cmd === "delete_api_key")).toBe(true);
    // A Claude test now fails with "No key".
    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByTestId("llm-error")).toHaveTextContent("No keySave an API key first.");
  });

  it("an invalid key names no value and stays out of the page text", async () => {
    const { user, container } = await openSection({ settings: { languageModel: "claude" } });
    const field = await screen.findByLabelText("Claude API key");
    await user.type(field, `${MARKER} two`);
    await user.click(screen.getByRole("button", { name: "Save key" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Not a valid key. Use 1–512 characters without spaces or line breaks.");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(container.textContent).not.toContain(MARKER);
    expect(screen.getByTestId("key-status")).toHaveTextContent("No key");
  });

  it("a locked keychain is explained and the app keeps working", async () => {
    const { user } = await openSection({ settings: { languageModel: "claude" }, keychainUnavailable: true });
    expect(await screen.findByText("System keychain not available")).toBeVisible();
    expect(screen.getByText(/The app keeps the key nowhere else/)).toBeVisible();
    expect(screen.queryByLabelText("Claude API key")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    // The rest of the settings still work.
    await user.click(engineRadio(/^Off/));
    expect(engineRadio(/^Off/)).toBeChecked();
  });
});

describe("AC4 / AC5 the Test reply is plain text; errors are words, not colour", () => {
  it("markup in the reply is shown literally", async () => {
    const reply: LlmTestReply = {
      ...FAKE_LLM_REPLY,
      text: '<img src=x onerror="alert(1)"><b>bold</b> & <script>x()</script>',
    };
    const { user, container } = await openSection({
      settings: { languageModel: "claude" },
      apiKeySet: true,
      llmTest: () => Promise.resolve(reply),
    });
    expect(screen.getByText(messages.en["settings.llm.test.sample"])).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Test" }));
    const text = await screen.findByTestId("llm-reply-text");
    expect(text.textContent).toBe(reply.text);
    expect(text.children).toHaveLength(0);
    expect(container.querySelector("img, script, b")).toBeNull();
    expect(screen.getByTestId("llm-reply")).toHaveTextContent("Reply received");
    expect(screen.getByTestId("llm-reply")).toHaveTextContent("Claude Sonnet 5.5 · 1.4 s");
    expect(screen.getByRole("button", { name: "Test again" })).toBeEnabled();
  });

  it.each([
    ["offline", "Offline", "No connection to api.anthropic.com within 10 s"],
    ["unauthorized", "Key not accepted (401)", "Replace it with a valid key"],
    ["rateLimited", "Rate limited (429)", "Wait a minute"],
    ["failed", "Test failed", "longer than 60 s"],
    ["keychainUnavailable", "System keychain not available", "Unlock the keychain"],
  ])("%s is named in words", async (kind, title, body) => {
    const { user } = await openSection({
      settings: { languageModel: "claude" },
      apiKeySet: true,
      llmTest: () => Promise.reject({ kind }),
    });
    await user.click(screen.getByRole("button", { name: "Test" }));
    const err = await screen.findByTestId("llm-error");
    expect(err).toHaveAttribute("data-kind", kind);
    expect(err).toHaveTextContent(title);
    expect(err).toHaveTextContent(body);
  });
});

describe("AC6 a slow engine blocks nothing and can be cancelled", () => {
  it("while the Test waits, the settings and the recording state stay usable; Cancel ends it", async () => {
    let settle: (r: { kind: string }) => void = () => {};
    const { user, core } = await openSection({
      settings: { languageModel: { local: QWEN.id } },
      llmTest: () =>
        new Promise((_, reject) => {
          settle = reject;
        }),
    });
    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByTestId("llm-waiting")).toHaveTextContent(`Waiting for ${QWEN.name}`);
    expect(screen.getByText("Stops within a second. The settings stay usable meanwhile.")).toBeVisible();
    // Other settings still apply at once.
    await user.click(screen.getByRole("tab", { name: /^General/ }));
    await user.click(screen.getByRole("radio", { name: /^Dark/ }));
    expect(changes(core).at(-1)).toEqual({ key: "theme", value: "dark" });
    // The recording state still arrives.
    const rec: CaptureState = {
      state: "recording",
      meetingId: "fixture-filled",
      elapsedMs: 5_000,
      level: 0.4,
      reason: null,
    };
    await act(() => emit(EVENT_CAPTURE, rec));
    await waitFor(() =>
      expect(screen.getAllByTestId("rec-chip").filter((c) => !c.closest("[hidden]"))[0]).toHaveTextContent(
        "REC00:00:05",
      ),
    );
    await user.click(screen.getByRole("tab", { name: /^Language model/ }));
    // The section was left and opened again: a fresh Test card, nothing stuck.
    expect(screen.getByRole("button", { name: /^Test/ })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Test" }));
    const old = settle;
    await user.click(await screen.findByRole("button", { name: "Cancel test" }));
    expect(core.calls.some((c) => c.cmd === "cancel_llm_test")).toBe(true);
    await act(async () => {
      old({ kind: "cancelled" });
      settle({ kind: "cancelled" });
    });
    const err = await screen.findByTestId("llm-error");
    expect(err).toHaveTextContent("Cancelled");
    expect(err).toHaveTextContent("The test was stopped. Nothing else happened.");
  });
});
