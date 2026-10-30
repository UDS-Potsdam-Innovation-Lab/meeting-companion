import { initials } from "../features/agenda/model";

// White initials on each of these meet WCAG AA contrast (4.5:1).
const PALETTE = ["#4338CA", "#0B6E72", "#8F5600", "#B42318", "#0E7040", "#6D28D9", "#1D4ED8", "#4A4D55"];

export function avatarColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

interface Props {
  name: string;
  size?: number;
  /** Accessible name; without it the avatar is decorative. */
  label?: string;
}

export function Avatar({ name, size = 28, label }: Props) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: avatarColor(name) }}
      {...(label ? { role: "img", "aria-label": label, title: label } : { "aria-hidden": true })}
    >
      {initials(name)}
    </span>
  );
}
