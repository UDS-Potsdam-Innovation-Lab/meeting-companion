/** Shape of the 12 bars at full level, as in the frame. */
const SHAPE = [0.35, 0.6, 0.45, 0.9, 0.55, 1, 0.7, 0.4, 0.8, 0.5, 0.65, 0.3];

/**
 * Frame 02 footer: 12 bars in the accent colour, driven by the input level (0..1). Flat when paused.
 * Decorative: the text next to it ("Listening" / "Paused") carries the meaning.
 */
export function LevelMeter({ level, active }: { level: number; active: boolean }) {
  const l = active ? Math.min(1, Math.max(0, level)) : 0;
  return (
    <span className={`level-meter${active ? "" : " level-meter--flat"}`} aria-hidden="true">
      {SHAPE.map((s, i) => (
        <span
          key={i}
          className="level-meter__bar"
          style={{ height: `${Math.round(3 + 15 * s * Math.max(0.15, l))}px` }}
        />
      ))}
    </span>
  );
}
