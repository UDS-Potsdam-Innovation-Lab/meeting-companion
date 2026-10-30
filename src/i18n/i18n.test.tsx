import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import de from "./de.json";
import en from "./en.json";
import { renderApp } from "../test/backend";
import { filledMeeting } from "../features/agenda/fixtures";
import { initials } from "../features/agenda/model";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("AC6 catalogues", () => {
  it("every key exists in both locales", () => {
    const deKeys = Object.keys(de).sort();
    const enKeys = Object.keys(en).sort();
    expect(deKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
    expect(enKeys.filter((k) => !deKeys.includes(k))).toEqual([]);
  });

  it("no message is empty and both locales use the same placeholders", () => {
    for (const [key, text] of Object.entries(de)) {
      const other = (en as Record<string, string>)[key]!;
      expect(text.trim(), key).not.toBe("");
      expect(other.trim(), key).not.toBe("");
      expect(placeholders(other), key).toEqual(placeholders(text));
    }
  });
});

describe("AC6 no literal user-facing strings", () => {
  // With keyMode every catalogue string renders as ⟦key⟧. Anything else that is visible text must be
  // user data from the meeting, initials derived from it, or numbers.
  it("every visible text and accessible label comes from a key", async () => {
    const user = userEvent.setup();
    const meeting = filledMeeting();
    const { container } = await renderApp({ meeting, error: "corrupt" }, { keyMode: true });
    // Open an editor and trigger validation messages so those strings are covered as well.
    await user.click(screen.getByRole("button", { name: /Check-in & goals/ }));
    await user.clear(screen.getByLabelText("⟦editor.title⟧"));
    await user.clear(screen.getByLabelText("⟦meeting.title⟧"));
    await user.click(screen.getByRole("button", { name: "⟦meeting.participants.add⟧" }));

    const userData = new Set<string>([
      meeting.title,
      ...meeting.participants.flatMap((p) => [p.name, initials(p.name)]),
      ...meeting.items.flatMap((i) => [i.title, i.outcome]),
    ]);
    const allowed = (s: string) => {
      const text = s.trim();
      if (text === "") return true;
      if (/^(⟦[\w.]+⟧\s*)+$/.test(text)) return true;
      if (/^[\d\s:.\-–·]+$/.test(text)) return true;
      return userData.has(text);
    };

    const offenders: string[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!allowed(n.textContent ?? "")) offenders.push(`text: ${n.textContent}`);
    }
    for (const el of container.querySelectorAll("*")) {
      for (const attr of ["aria-label", "title", "placeholder", "alt"]) {
        const v = el.getAttribute(attr);
        if (v !== null && !allowed(v)) offenders.push(`${attr}: ${v}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
