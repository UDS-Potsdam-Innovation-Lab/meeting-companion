// Job 007: the SoundWave component and its level stream (AC2–AC4), with a fake rAF and matchMedia.
import { act, render, renderHook } from "@testing-library/react";
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_LEVEL, type LevelEvent } from "../lib/ipc";
import { BAR_MS, NO_SIGNAL_MS, REDUCED_EVERY_MS, SoundWave, useNoSignal, type WaveState } from "./SoundWave";

const ID = "m-1";

/** A controllable requestAnimationFrame: frames run only when the test says so. */
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let scheduled: number;
let reduced: boolean;
let changeListeners: (() => void)[];

function runFrame(now: number) {
  const due = [...frames.values()];
  frames.clear();
  for (const cb of due) cb(now);
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  scheduled = 0;
  reduced = false;
  changeListeners = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    scheduled += 1;
    frames.set(nextFrame, cb);
    return nextFrame++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)" && reduced,
    media: query,
    addEventListener: (_: string, cb: () => void) => changeListeners.push(cb),
    removeEventListener: () => {},
  }));
  mockIPC(() => null, { shouldMockEvents: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});

const level = (l: number, meetingId: string | null = ID) =>
  act(() => emit(EVENT_LEVEL, { meetingId, level: l, peak: l } satisfies LevelEvent));

/** Lets the mocked event channel register its listeners. */
const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

const heights = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(".sound-wave__bar")].map((b) => parseFloat(b.style.height || "2"));

describe("AC2/AC3 the wave while listening", () => {
  it("moves with the level events of its meeting, through animation frames, aria-hidden", async () => {
    const { container } = render(<SoundWave state="listening" source={ID} />);
    await settle();
    const wave = container.querySelector(".sound-wave")!;
    expect(wave).toHaveAttribute("aria-hidden", "true");
    expect(wave).toHaveAttribute("data-state", "listening");
    expect(container.querySelectorAll(".sound-wave__bar")).toHaveLength(21);
    expect(frames.size).toBe(1);

    // Another meeting's level (or the microphone test's) is not drawn.
    runFrame(1_000);
    await level(0.9, "other");
    await level(0.9, null);
    runFrame(1_050);
    expect(Math.max(...heights(container as HTMLElement))).toBe(2);

    await level(0.8);
    runFrame(1_090);
    expect(Math.max(...heights(container as HTMLElement))).toBeGreaterThan(10);
    // The history scrolls: after 2 s without new levels it is flat again.
    for (let t = 1_100; t <= 3_400; t += BAR_MS) runFrame(t);
    expect(Math.max(...heights(container as HTMLElement))).toBe(2);
  });

  it.each<WaveState>(["paused", "off", "lost", "noSignal"])(
    "%s draws a flat line, no bars, and schedules no frame",
    async (state) => {
      const { container } = render(<SoundWave state={state} source={ID} />);
      await settle();
      await level(0.9);
      expect(scheduled).toBe(0);
      expect(container.querySelector(".sound-wave__bar")).toBeNull();
      expect(container.querySelector(".sound-wave__line")).not.toBeNull();
      expect(container.querySelector(".sound-wave")).toHaveAttribute("data-state", state);
      expect(container.querySelector(".sound-wave")).toHaveAttribute("aria-hidden", "true");
    },
  );

  it("keeps no level from before: paused then listening again starts flat", async () => {
    const { container, rerender } = render(<SoundWave state="listening" source={ID} />);
    await settle();
    await level(1);
    runFrame(500);
    expect(Math.max(...heights(container as HTMLElement))).toBeGreaterThan(10);
    rerender(<SoundWave state="paused" source={ID} />);
    expect(frames.size).toBe(0);
    rerender(<SoundWave state="listening" source={ID} />);
    await settle();
    runFrame(600);
    expect(Math.max(...heights(container as HTMLElement))).toBe(2);
  });

  it("schedules no frame while the document is hidden and resumes when it is shown", async () => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    const { unmount } = render(<SoundWave state="listening" source={ID} />);
    await settle();
    expect(scheduled).toBe(0);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(frames.size).toBe(1);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(frames.size).toBe(0);
    unmount();
    expect(frames.size).toBe(0);
  });

  it("stops its frames on unmount", async () => {
    const { unmount } = render(<SoundWave state="listening" source={ID} />);
    await settle();
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
  });
});

describe("AC2 No signal", () => {
  it("turns on after 500 ms without a level event, off with the next one, and only while listening", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const { result, rerender } = renderHook(({ on }) => useNoSignal(on, ID), { initialProps: { on: true } });
    await settle();
    expect(result.current).toBe(false);
    for (let i = 0; i < 10; i++) {
      await level(0.4);
      act(() => vi.advanceTimersByTime(40));
    }
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(NO_SIGNAL_MS - 100));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe(true);
    await level(0.4);
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(NO_SIGNAL_MS + 100));
    expect(result.current).toBe(true);
    // Paused: never "No signal", and nothing carried over to the next start.
    rerender({ on: false });
    expect(result.current).toBe(false);
    rerender({ on: true });
    expect(result.current).toBe(false);
  });
});

describe("AC4 reduced motion", () => {
  it("shows a static level bar instead of the wave, updated at most 4 times a second, without frames", async () => {
    reduced = true;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { container, rerender } = render(<SoundWave state="listening" source={ID} />);
    await settle();
    expect(container.querySelector(".sound-wave__bar")).toBeNull();
    const value = container.querySelector<HTMLElement>(".sound-wave__value")!;
    expect(container.querySelector(".sound-wave--reduced")).toHaveAttribute("aria-hidden", "true");
    const writes: string[] = [];
    new MutationObserver(() => writes.push(value.style.width)).observe(value, { attributes: true });
    // 25 level events a second for 2 s, each different.
    for (let i = 0; i < 50; i++) {
      await level(0.2 + (i % 5) * 0.1);
      act(() => vi.advanceTimersByTime(40));
    }
    await act(() => Promise.resolve());
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.length).toBeLessThanOrEqual(2_000 / REDUCED_EVERY_MS);
    expect(value.style.width).not.toBe("0%");
    expect(value.style.transition).toBe("");
    expect(scheduled).toBe(0);

    // Same states as the wave: paused / no signal / lost hold no level.
    for (const state of ["paused", "noSignal", "lost", "off"] as const) {
      rerender(<SoundWave state={state} source={ID} />);
      expect(container.querySelector(".sound-wave")).toHaveAttribute("data-state", state);
      expect(container.querySelector<HTMLElement>(".sound-wave__value")!.style.width).toBe("0%");
    }
    expect(scheduled).toBe(0);
  });

  it("follows a change of the system setting", async () => {
    const { container } = render(<SoundWave state="listening" source={ID} />);
    await settle();
    expect(container.querySelector(".sound-wave__bar")).not.toBeNull();
    reduced = true;
    act(() => changeListeners.forEach((cb) => cb()));
    expect(container.querySelector(".sound-wave__bar")).toBeNull();
    expect(container.querySelector(".sound-wave--reduced")).not.toBeNull();
    expect(frames.size).toBe(0);
  });
});
