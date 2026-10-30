import { mockIPC } from "@tauri-apps/api/mocks";
import { render, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";
import { App } from "../app/App";
import { I18nProvider } from "../i18n";
import { ClockProvider, systemClock, type Clock } from "../lib/clock";
import type { Meeting } from "../features/agenda/model";
import type { LoadResult } from "../lib/ipc";

export interface FakeCore {
  saved: Meeting[];
  readyViews: string[];
  /** The last meeting the core accepted. */
  last: () => Meeting | undefined;
}

/** Mocks the Tauri core: `load_latest_meeting` returns `load`, saves are recorded. */
export function fakeCore(load: LoadResult = { meeting: null, error: null }): FakeCore {
  const core: FakeCore = { saved: [], readyViews: [], last: () => core.saved[core.saved.length - 1] };
  mockIPC((cmd, args) => {
    if (cmd === "load_latest_meeting") return structuredClone(load);
    if (cmd === "save_meeting") {
      core.saved.push(structuredClone((args as { meeting: Meeting }).meeting));
      return Date.now();
    }
    if (cmd === "view_ready") {
      core.readyViews.push((args as { view: string }).view);
      return null;
    }
    throw new Error(`unexpected command ${cmd}`);
  });
  return core;
}

export interface RenderOptions {
  keyMode?: boolean;
  clock?: Clock;
  /** The view to wait for: agenda setup (default) or the live meeting. */
  view?: "setup" | "live";
}

export async function renderApp(load?: LoadResult, opts: RenderOptions = {}) {
  const core = fakeCore(load);
  const utils = render(
    <ClockProvider clock={opts.clock ?? systemClock}>
      <I18nProvider keyMode={opts.keyMode}>
        <App />
      </I18nProvider>
    </ClockProvider>,
  );
  if (opts.view === "live") {
    await waitFor(() => expect(utils.container.querySelector('main[data-view="live"]')).not.toBeNull());
  } else {
    // The setup view is ready once the meeting card is there.
    await screen.findByRole("region", { name: opts.keyMode ? "⟦meeting.heading⟧" : /^Meeting$/ });
  }
  return { core, ...utils };
}
