// The only module that talks to the Tauri core. Everything else imports from here.
import { invoke } from "@tauri-apps/api/core";
import type { Meeting } from "../features/agenda/model";

/** `keyUnavailable`: the data key is not in the OS keychain; nothing can be read or saved. */
export type LoadError = "corrupt" | "unreadable" | "keyUnavailable";

export interface LoadResult {
  meeting: Meeting | null;
  error: LoadError | null;
}

export type SaveError =
  | { kind: "invalid"; fields: { field: string; code: string }[] }
  | { kind: "io" }
  | { kind: "locked" }
  | { kind: "unknown" };

/** The most recently edited meeting, or why it could not be read. */
export async function loadLatestMeeting(): Promise<LoadResult> {
  try {
    return await invoke<LoadResult>("load_latest_meeting");
  } catch {
    return { meeting: null, error: "unreadable" };
  }
}

/** Saves the meeting on this device. Resolves with the save time; rejects with a {@link SaveError}. */
export async function saveMeeting(meeting: Meeting): Promise<number> {
  try {
    return await invoke<number>("save_meeting", { meeting });
  } catch (e) {
    const err = e as Partial<SaveError> | undefined;
    throw err && (err.kind === "invalid" || err.kind === "io" || err.kind === "locked")
      ? err
      : { kind: "unknown" };
  }
}

/** Tells the core a view finished rendering (used by the smoke run of the built app). */
export async function viewReady(view: string): Promise<void> {
  try {
    await invoke("view_ready", { view });
  } catch {
    // Not fatal for the app.
  }
}
