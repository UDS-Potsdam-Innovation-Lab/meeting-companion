import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { onCaptureLevel } from "../lib/ipc";

/** What the wave shows. Only "listening" moves; every other state draws no level at all. */
export type WaveState = "listening" | "paused" | "noSignal" | "lost" | "off";
/** Footer of the transcript card (frame 02) or the Audio meter in the settings (frame 14). */
export type WaveSize = "footer" | "settings";

/** One bar per 100 ms of level history, newest on the right. */
export const BAR_MS = 100;
/** Recording with no level event for this long: "No signal". */
export const NO_SIGNAL_MS = 500;
/** The reduced-motion bar changes at most 4 times a second. */
export const REDUCED_EVERY_MS = 250;
/** About 30 frames a second are drawn; the browser's own rate may be higher. */
const FRAME_MS = 1000 / 30;
/** Bars in the DOM (one more than fit, so the history scrolls in smoothly). Narrow windows show fewer by CSS. */
const BARS: Record<WaveSize, number> = { footer: 20, settings: 30 };

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function reducedQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(REDUCED_QUERY)
    : null;
}

function subscribeReduced(onChange: () => void) {
  const q = reducedQuery();
  q?.addEventListener("change", onChange);
  return () => q?.removeEventListener("change", onChange);
}

/** `prefers-reduced-motion: reduce`, following changes of the system setting. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => reducedQuery()?.matches ?? false,
    () => false,
  );
}

const clamp = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * True while `listening` and no level event of `source` (a meeting id, or null for the microphone
 * test) arrived for {@link NO_SIGNAL_MS}. Re-renders the caller only when that changes, never per event.
 */
export function useNoSignal(listening: boolean, source: string | null): boolean {
  const [none, setNone] = useState(false);
  useEffect(() => {
    if (!listening) return;
    let last = Date.now();
    let silent = false;
    const stop = onCaptureLevel((e) => {
      if (e.meetingId !== source) return;
      last = Date.now();
      if (silent) {
        silent = false;
        setNone(false);
      }
    });
    const timer = setInterval(() => {
      if (!silent && Date.now() - last >= NO_SIGNAL_MS) {
        silent = true;
        setNone(true);
      }
    }, BAR_MS);
    return () => {
      stop();
      clearInterval(timer);
      setNone(false);
    };
  }, [listening, source]);
  return listening && none;
}

interface Props {
  state: WaveState;
  /** Whose level: the meeting id, or null for the microphone test. */
  source: string | null;
  size?: WaveSize;
}

/**
 * The live sound wave (job 007): a scrolling history of the input level, drawn as mirrored bars
 * (one per 100 ms, about the last 2 s). Fed by the core's `capture-level` events through a ref and
 * `requestAnimationFrame`, so a level never re-renders the view around it. Flat when paused or
 * off, dashed with "No signal", flat beside "Microphone lost". Under `prefers-reduced-motion` a
 * static level bar takes its place. Decorative (`aria-hidden`): the status text next to it carries
 * the meaning.
 */
export function SoundWave({ state, source, size = "footer" }: Props) {
  const reduced = useReducedMotion();
  if (reduced) return <LevelBar state={state} source={source} size={size} />;
  if (state === "listening") return <Wave source={source} size={size} />;
  return (
    <span className={`sound-wave sound-wave--${size} sound-wave--flat`} data-state={state} aria-hidden="true">
      <span className="sound-wave__line" />
    </span>
  );
}

function Wave({ source, size }: { source: string | null; size: WaveSize }) {
  const rowRef = useRef<HTMLSpanElement>(null);
  const n = BARS[size];

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const bars = Array.from(row.children) as HTMLElement[];
    // history[n] is the slot being filled now; older slots to the left.
    const history = new Float32Array(n + 1);
    let slot = -1;
    let frame = 0;
    let drawn = Number.NEGATIVE_INFINITY;
    let pitch = 5;
    let height = 20;

    const measure = () => {
      const cs = getComputedStyle(row);
      const bar = parseFloat(cs.getPropertyValue("--wave-bar")) || 3;
      const gap = parseFloat(cs.getPropertyValue("--wave-gap")) || 2;
      pitch = bar + gap;
      height = row.clientHeight || parseFloat(cs.getPropertyValue("--wave-height")) || 20;
    };

    const stopLevels = onCaptureLevel((e) => {
      if (e.meetingId !== source) return;
      const level = clamp(e.level);
      if (level > history[n]!) history[n] = level;
    });

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - drawn < FRAME_MS) return;
      drawn = now;
      const s = Math.floor(now / BAR_MS);
      if (slot < 0) slot = s;
      if (s > slot) {
        const steps = Math.min(s - slot, n + 1);
        history.copyWithin(0, steps);
        history.fill(0, n + 1 - steps);
        slot = s;
      }
      // The newest bar slides in from the right over its 100 ms.
      const frac = (now % BAR_MS) / BAR_MS;
      row.style.transform = `translateX(${((1 - frac) * pitch).toFixed(2)}px)`;
      for (let i = 0; i <= n; i++) {
        bars[i]!.style.height = `${(2 + history[i]! * (height - 2)).toFixed(1)}px`;
      }
    };

    const start = () => {
      if (frame === 0 && !document.hidden) {
        measure();
        frame = requestAnimationFrame(draw);
      }
    };
    const halt = () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
    };
    const onVisibility = () => (document.hidden ? halt() : start());
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      halt();
      stopLevels();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [n, source]);

  return (
    <span className={`sound-wave sound-wave--${size}`} data-state="listening" aria-hidden="true">
      <span className="sound-wave__row" ref={rowRef}>
        {Array.from({ length: n + 1 }, (_, i) => (
          <span key={i} className="sound-wave__bar" />
        ))}
      </span>
    </span>
  );
}

/** Reduced motion: a static horizontal level bar, updated at most 4 times a second, no transition. */
function LevelBar({ state, source, size }: { state: WaveState; source: string | null; size: WaveSize }) {
  const valueRef = useRef<HTMLSpanElement>(null);
  const listening = state === "listening";

  useEffect(() => {
    const el = valueRef.current;
    if (!el) return;
    el.style.width = "0%";
    if (!listening) return;
    let latest = 0;
    let shown = 0;
    const stop = onCaptureLevel((e) => {
      if (e.meetingId === source) latest = clamp(e.level);
    });
    const timer = setInterval(() => {
      if (latest !== shown) {
        shown = latest;
        el.style.width = `${Math.round(latest * 100)}%`;
      }
    }, REDUCED_EVERY_MS);
    return () => {
      stop();
      clearInterval(timer);
      el.style.width = "0%";
    };
  }, [listening, source]);

  return (
    <span
      className={`sound-wave sound-wave--${size} sound-wave--reduced`}
      data-state={state}
      aria-hidden="true"
    >
      <span className="sound-wave__track">
        <span className="sound-wave__value" ref={valueRef} />
      </span>
    </span>
  );
}
