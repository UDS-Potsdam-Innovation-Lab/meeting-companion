// A stand-in for the Tauri core, used only by the browser build for Playwright and screenshots
// (`vite build --mode e2e`). It keeps meetings in localStorage so a page reload acts like a restart.
import { mockIPC } from "@tauri-apps/api/mocks";
import { filledMeeting, liveDoneMeeting, liveMeeting, overBudgetMeeting } from "../features/agenda/fixtures";
import { isMeetingValid, type Meeting } from "../features/agenda/model";
import type { LoadResult } from "./ipc";

const KEY = "mock-backend.meetings";
const CORRUPT_KEY = "mock-backend.corrupt";
const LOCKED_KEY = "mock-backend.locked";

type Fixture = "empty" | "filled" | "over" | "corrupt" | "locked" | "live" | "live-done";

const SEEDS: Partial<Record<Fixture, () => Meeting>> = {
  filled: filledMeeting,
  over: overBudgetMeeting,
  live: liveMeeting,
  "live-done": liveDoneMeeting,
};

function seed(fixture: Fixture) {
  localStorage.removeItem(CORRUPT_KEY);
  localStorage.removeItem(LOCKED_KEY);
  const make = SEEDS[fixture];
  const meetings: Meeting[] = make ? [make()] : [];
  localStorage.setItem(KEY, JSON.stringify(meetings));
  if (fixture === "corrupt") localStorage.setItem(CORRUPT_KEY, "1");
  if (fixture === "locked") localStorage.setItem(LOCKED_KEY, "1");
}

function all(): Meeting[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Meeting[];
  } catch {
    return [];
  }
}

export function installMockBackend() {
  const url = new URL(window.location.href);
  const fixture = url.searchParams.get("fixture") as Fixture | null;
  if (fixture) {
    seed(fixture);
    url.searchParams.delete("fixture");
    window.history.replaceState(null, "", url);
  }

  mockIPC((cmd, args) => {
    switch (cmd) {
      case "load_latest_meeting": {
        if (localStorage.getItem(LOCKED_KEY)) {
          return { meeting: null, error: "keyUnavailable" } satisfies LoadResult;
        }
        if (localStorage.getItem(CORRUPT_KEY)) {
          localStorage.removeItem(CORRUPT_KEY);
          return { meeting: null, error: "corrupt" } satisfies LoadResult;
        }
        const list = all();
        return { meeting: list[list.length - 1] ?? null, error: null } satisfies LoadResult;
      }
      case "save_meeting": {
        if (localStorage.getItem(LOCKED_KEY)) throw { kind: "locked" };
        const meeting = (args as { meeting: Meeting }).meeting;
        if (!isMeetingValid(meeting)) throw { kind: "invalid", fields: [] };
        const now = Date.now();
        const list = all().filter((m) => m.id !== meeting.id);
        list.push({ ...meeting, updatedAt: now });
        localStorage.setItem(KEY, JSON.stringify(list));
        return now;
      }
      case "view_ready":
        return null;
      default:
        throw new Error(`mock backend: unknown command ${cmd}`);
    }
  });
}
