import { describe, expect, it } from "vitest";
import { placePicker } from "./LineSpeaker";

const rect = (top: number, left = 20, height = 28) =>
  ({ top, bottom: top + height, left, right: left + 120, width: 120, height, x: left, y: top }) as DOMRect;

describe("UI rework: the Who said this? picker stays inside the window", () => {
  const desk = { width: 1280, height: 800 };
  const phone = { width: 375, height: 812 };

  it("opens below its line when it fits", () => {
    expect(placePicker(rect(100), 400, desk)).toEqual({
      top: 136,
      left: 20,
      width: 300,
      maxHeight: 656,
      above: false,
    });
  });

  it("opens above a line near the bottom, ending just above it", () => {
    const p = placePicker(rect(600), 400, desk);
    expect(p.above).toBe(true);
    expect(p.top).toBe(600 - 8 - 400);
    expect(p.top + 400).toBeLessThanOrEqual(600);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });

  it("scrolls inside when neither side has room, on the side with more room", () => {
    const p = placePicker(rect(340), 900, { width: 1280, height: 640 });
    expect(p.above).toBe(true);
    expect(p.top).toBe(8);
    expect(p.maxHeight).toBe(340 - 16);
    const q = placePicker(rect(200), 900, { width: 1280, height: 640 });
    expect(q.above).toBe(false);
    expect(q.top + q.maxHeight).toBeLessThanOrEqual(640 - 8);
  });

  it("never runs past the left or right edge of a narrow window", () => {
    const p = placePicker(rect(100, 200), 300, phone);
    expect(p.width).toBe(300);
    expect(p.left + p.width).toBeLessThanOrEqual(375 - 8);
    const tiny = placePicker(rect(100, 0), 300, { width: 280, height: 600 });
    expect(tiny.left).toBe(8);
    expect(tiny.width).toBe(264);
  });
});
