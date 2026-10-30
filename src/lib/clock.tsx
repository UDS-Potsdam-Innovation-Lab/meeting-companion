// Where the UI gets the time from. Timekeeping never counts ticks: it reads `now()` and computes
// every value from stored timestamps, so a hidden window or a sleeping machine causes no drift.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
  /** Calls `onTick` about every `ms` milliseconds until the returned function is called. */
  every(ms: number, onTick: () => void): () => void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  every(ms, onTick) {
    const id = setInterval(onTick, ms);
    return () => clearInterval(id);
  },
};

/** A clock for tests: time moves only when the test says so, and every move ticks all listeners. */
export class FakeClock implements Clock {
  private time: number;
  private listeners = new Set<() => void>();

  constructor(time: number) {
    this.time = time;
  }

  now() {
    return this.time;
  }

  every(_ms: number, onTick: () => void) {
    this.listeners.add(onTick);
    return () => {
      this.listeners.delete(onTick);
    };
  }

  set(time: number) {
    this.time = time;
    for (const l of [...this.listeners]) l();
  }

  advance(ms: number) {
    this.set(this.time + ms);
  }
}

const ClockContext = createContext<Clock>(systemClock);

export function ClockProvider({ clock, children }: { clock: Clock; children: ReactNode }) {
  return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
}

export function useClock(): Clock {
  return useContext(ClockContext);
}

/**
 * The current time, refreshed every `ms` and at once when the window becomes visible again (a hidden
 * window may get no timer ticks for a while).
 */
export function useNow(ms = 1000): number {
  const clock = useClock();
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    const tick = () => setNow(clock.now());
    tick();
    const stop = clock.every(ms, tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", tick);
    };
  }, [clock, ms]);
  return now;
}
