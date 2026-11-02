// A stand-in for the core's capture commands (src-tauri/src/captures) and the suggestion commands
// (src-tauri/src/suggestions), shared by the component tests' fake core and the e2e build's mock
// backend. It mirrors the core's rules; the core stays the judge.
import type {
  Capture,
  CaptureChange,
  CaptureFieldError,
  CaptureSuggestion,
  ConfirmSuggestion,
  LlmError,
  NewCapture,
  SuggestionsState,
} from "../../lib/ipc";
import { isValidDate, type Meeting } from "../agenda/model";
import { TEXT_MAX } from "./model";

const KINDS = ["decision", "todo", "question"];

const blank = (v: string | null | undefined) => (v && v.trim() ? v : null);

export function checkCapture(m: Meeting, c: Capture): CaptureFieldError[] {
  const errs: CaptureFieldError[] = [];
  const add = (field: string, code: string) => errs.push({ field, code });
  if (!/^[A-Za-z0-9-]{1,64}$/.test(c.id)) add("id", "invalid");
  const known = KINDS.includes(c.kind);
  if (!known) add("kind", "unknown");
  const text = c.text.trim();
  if (!text) add("text", "empty");
  else if (Array.from(text).length > TEXT_MAX) add("text", "tooLong");
  const todo = c.kind === "todo";
  if (c.owner) {
    if (known && !todo) add("owner", "notTodo");
    else if (!m.participants.some((p) => p.id === c.owner)) add("owner", "notParticipant");
  }
  if (c.due) {
    if (!isValidDate(c.due)) add("due", "invalid");
    else if (known && !todo) add("due", "notTodo");
  }
  if (m.mode === "free") {
    if (c.itemId) add("itemId", "notInFreeMode");
    if (c.topicId && !(m.run?.topics ?? []).some((t) => t.id === c.topicId)) add("topicId", "unknown");
  } else {
    if (c.topicId) add("topicId", "notInAgendaMode");
    if (c.itemId && !m.items.some((it) => it.id === c.itemId)) add("itemId", "unknown");
  }
  const segments = c.segments ?? [];
  if (c.source === "typed") {
    if (segments.length) add("segments", "notSuggested");
  } else if (c.source === "suggested") {
    if (!segments.length) add("segments", "empty");
  } else add("source", "unknown");
  return errs;
}

/** What the core keeps in memory only: the Undo copy per meeting and the suggestions. */
export interface FakeMemory {
  kept: Record<string, Capture>;
  pending: CaptureSuggestion[];
  /** Confirmed suggestions by capture id (for Undo of a confirm). */
  confirmed: Record<string, CaptureSuggestion>;
  error: LlmError | null;
}

export function fakeMemory(pending: CaptureSuggestion[] = [], error: LlmError | null = null): FakeMemory {
  return { kept: {}, pending: structuredClone(pending), confirmed: {}, error };
}

export interface FakeCaptureStore {
  meeting: (id: string) => (Meeting & { captures?: Capture[] }) | undefined;
  put: (m: Meeting & { captures?: Capture[] }) => void;
  now: () => number;
  /** Makes capture ids; the default counts up. */
  newId?: () => string;
  memory: FakeMemory;
}

/** Whether `cmd` is a capture or suggestion command of the core. */
export const isCaptureCommand = (cmd: string) =>
  cmd === "load_captures" ||
  cmd.endsWith("_capture") ||
  cmd === "load_suggestions" ||
  cmd.endsWith("_suggestion");

const suggestionState = (meetingId: string, mem: FakeMemory): SuggestionsState => ({
  meetingId,
  pending: structuredClone(mem.pending),
  error: mem.error,
});

const unknownSuggestion = { kind: "invalid", fields: [{ field: "suggestionId", code: "unknown" }] };

/**
 * Answers one capture command like the core does, or returns `undefined` for any other command.
 * Rejections are thrown as the core's error objects.
 */
export function fakeCaptureCommand(
  store: FakeCaptureStore,
  cmd: string,
  args: Record<string, unknown>,
): unknown {
  if (!isCaptureCommand(cmd)) return undefined;
  const mem = store.memory;
  // The restore request carries the two ids only (a closed schema, like the core's RestoreRequest).
  if (cmd === "restore_capture") {
    const req = args.restore as Record<string, unknown> | undefined;
    const keys = Object.keys(args);
    if (!req || keys.length !== 1 || Object.keys(req).sort().join() !== "captureId,meetingId")
      throw { kind: "invalid", fields: [{ field: "restore", code: "unknownField" }] };
    args = { meetingId: req.meetingId, captureId: req.captureId };
  }
  if (cmd === "load_suggestions") return suggestionState(args.meetingId as string, mem);
  const m = store.meeting(args.meetingId as string);
  if (!m) throw { kind: "noMeeting" };
  const list = m.captures ?? [];
  if (cmd === "load_captures") return structuredClone(list);
  if (!m.run || m.run.endedAt !== null) throw { kind: "notRunning" };
  const now = store.now();
  const write = (captures: Capture[], capture: Capture) => {
    store.put({ ...m, captures });
    return { capture: structuredClone(capture), captures: structuredClone(captures) };
  };
  let n = list.length + 1;
  const make = store.newId ?? (() => `c-${n++}`);
  const newId = () => {
    let id = make();
    while (list.some((c) => c.id === id)) id = make();
    return id;
  };
  const remove = () => {
    const i = find();
    mem.kept[m.id] = structuredClone(list[i]!);
    return write(
      list.filter((_, j) => j !== i),
      list[i]!,
    );
  };
  const invalid = (fields: CaptureFieldError[]) => {
    if (fields.length) throw { kind: "invalid", fields };
  };
  const find = () => {
    const i = list.findIndex((c) => c.id === args.captureId);
    if (i < 0) throw { kind: "unknownCapture" };
    return i;
  };
  switch (cmd) {
    case "add_capture": {
      const input = args.capture as NewCapture;
      const capture: Capture = {
        id: newId(),
        kind: input.kind,
        text: input.text.trim(),
        owner: blank(input.owner),
        due: blank(input.due),
        itemId: blank(input.itemId),
        topicId: blank(input.topicId),
        source: "typed",
        createdAt: now,
      };
      invalid(checkCapture(m, capture));
      return write([...list, capture], capture);
    }
    case "update_capture": {
      const i = find();
      const change = args.change as CaptureChange;
      const capture: Capture = {
        ...list[i]!,
        kind: change.kind,
        text: change.text.trim(),
        owner: blank(change.owner),
        due: blank(change.due),
        editedAt: now,
      };
      invalid(checkCapture(m, capture));
      return write(
        list.map((c, j) => (j === i ? capture : c)),
        capture,
      );
    }
    case "delete_capture":
      return remove();
    case "restore_capture": {
      const kept = mem.kept[m.id];
      if (!kept || kept.id !== args.captureId)
        throw { kind: "invalid", fields: [{ field: "captureId", code: "notRemoved" }] };
      delete mem.kept[m.id];
      return write(
        [...list, kept].sort((a, b) => a.createdAt - b.createdAt),
        kept,
      );
    }
    case "confirm_suggestion": {
      const confirm = args.confirm as ConfirmSuggestion;
      const s = mem.pending.find((p) => p.id === confirm.suggestionId);
      if (!s) throw unknownSuggestion;
      const edit = confirm.edit;
      const capture: Capture = {
        id: newId(),
        kind: edit?.kind ?? s.kind,
        text: (edit?.text ?? s.text).trim(),
        owner: blank(edit ? edit.owner : s.owner),
        due: blank(edit?.due ?? null),
        itemId: blank(confirm.itemId),
        topicId: blank(confirm.topicId),
        source: "suggested",
        segments: [...s.segments],
        createdAt: now,
      };
      invalid(checkCapture(m, capture));
      const out = write([...list, capture], capture);
      mem.pending = mem.pending.filter((p) => p.id !== s.id);
      mem.confirmed[capture.id] = s;
      return out;
    }
    case "dismiss_suggestion": {
      if (!mem.pending.some((p) => p.id === args.suggestionId)) throw unknownSuggestion;
      mem.pending = mem.pending.filter((p) => p.id !== args.suggestionId);
      return suggestionState(m.id, mem);
    }
    case "unconfirm_suggestion": {
      const out = remove();
      const back = mem.confirmed[args.captureId as string];
      if (back) {
        delete mem.confirmed[args.captureId as string];
        mem.pending = [...mem.pending, back].sort((a, b) => a.createdAt - b.createdAt);
      }
      return out;
    }
  }
  return undefined;
}
