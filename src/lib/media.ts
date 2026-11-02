import { useEffect, useState } from "react";

/** Below 1200 px the captures move into the centre card as a second tab (job 018). */
export const NARROW_LIVE_QUERY = "(max-width: 1199px)";

const query = (q: string) =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(q) : null;

/** Whether the media query matches now, following changes (false where matchMedia is missing). */
export function useMediaQuery(q: string): boolean {
  const [matches, setMatches] = useState(() => query(q)?.matches ?? false);
  useEffect(() => {
    const mql = query(q);
    if (!mql) return;
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, [q]);
  return matches;
}
