import { describe, expect, it } from "vitest";

import { graceCell, graceSummary } from "./grace";

/** Synthetic monthly series (TEST ONLY): a linear decline of −60 mm/yr plus a seasonal cycle low in April. */
function synthetic(years: number) {
  const months: string[] = [], lwe: (number | null)[] = [], unc: (number | null)[] = [];
  for (let y = 0; y < years; y++)
    for (let m = 1; m <= 12; m++) {
      months.push(`${2003 + y}-${String(m).padStart(2, "0")}`);
      const t = y + (m - 0.5) / 12;
      lwe.push(Math.round(-60 * t + 200 * Math.cos(((m - 10) / 12) * 2 * Math.PI)));
      unc.push(50);
    }
  return { months, lwe, unc };
}

describe("GRACE regional water storage", () => {
  it("finds the land cell's mascon and scale factor, and nothing over the ocean", () => {
    const file = { grid: { lat0: -89.75, lon0: 0.25, step: 0.5, nLat: 360, nLon: 720 }, rows: { "229": [[177, 1320, [1.1, 1.09]]] as [number, number, number[]][] } };
    // 24.62 N → row 229 (24.75); 88.56 E → column 177 (88.75).
    expect(graceCell(file, 24.62, 88.56)).toMatchObject({ masconId: 1320, scale: 1.1, cellLat: 24.75, cellLon: 88.75 });
    expect(graceCell(file, 0, -150)).toBeNull();
  });
  it("removes the seasonal cycle before the trend and names the low month", () => {
    const s = synthetic(12);
    const r = graceSummary(s.months, s.lwe, s.unc, 1)!;
    expect(r.trendMmPerYear!).toBeCloseTo(-60, 0);
    expect(r.seasonal).toMatchObject({ lowMonth: 4, highMonth: 10 });
    expect(r.change!.mm).toBeCloseTo(-540, -1); // 9 years apart × −60 mm
  });
  it("applies the land scale factor and leaves missing months out", () => {
    const s = synthetic(10);
    s.lwe[5] = null;
    const r = graceSummary(s.months, s.lwe, s.unc, 2)!;
    expect(r.validMonths).toBe(119);
    expect(Math.abs(r.trendMmPerYear! + 120)).toBeLessThan(3); // one missing month shifts the climatology slightly
    expect(r.latest.uncertaintyMm).toBe(100);
  });
  it("refuses a record that is too short", () => {
    const s = synthetic(1);
    expect(graceSummary(s.months, s.lwe, s.unc, 1)).toBeNull();
  });
});
