import { describe, expect, it } from "vitest";

import { CROP_CATALOG } from "./catalog";
import { bareWindowFillers, type Slot } from "./schedule";

const crop = (id: string) => CROP_CATALOG.find((c) => c.id === id)!;
const slot = (id: string, windowStart: number, windowSpan: number, length: number): Slot => ({ key: id, crop: crop(id), cropName: crop(id).label, source: "calendar", sourceDetail: `test window for ${id}`, preferred: windowStart, windowStart, windowSpan, length });

describe("bare-window fillers (engine 1.3.0)", () => {
  // Bare from day 130 (≈ 11 May) for 80 days.
  const gap = { start: 130, days: 80 };
  it("lists crops whose dates fit inside the gap with turnaround, legumes first", () => {
    const fits = bareWindowFillers(gap, [slot("green_gram_cowpea", 120, 30, 65), slot("sesame", 135, 10, 60), slot("maize", 130, 10, 120)], 5, new Set());
    expect(fits.map((f) => f.cropId)).toEqual(["green_gram_cowpea", "sesame"]); // maize (120 days) does not fit
    expect(fits[0]).toMatchObject({ legume: true, plant: 135, length: 65 });
  });
  it("skips crops already in the option and short gaps", () => {
    expect(bareWindowFillers(gap, [slot("sesame", 135, 10, 60)], 5, new Set(["sesame"]))).toEqual([]);
    expect(bareWindowFillers({ start: 0, days: 30 }, [slot("sesame", 0, 10, 20)], 0, new Set())).toEqual([]);
  });
  it("handles a gap that wraps New Year", () => {
    const fits = bareWindowFillers({ start: 340, days: 90 }, [slot("lentil", 350, 10, 70)], 5, new Set());
    expect(fits[0]?.plant).toBe(350);
  });
});
