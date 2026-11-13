import { describe, expect, it } from "vitest";

import { runChain } from "./continuous";
import { dayIndex } from "./dates";
import { effectiveRainMonth, PADDY, paddyIrrigation } from "./paddy";

describe("paddy rice (FAO Training Manual No. 3 §4.4, engine 1.3.0)", () => {
  it("uses the manual's effective-rain formula, never negative", () => {
    expect(effectiveRainMonth(200)).toBe(135);
    expect(effectiveRainMonth(50)).toBe(20);
    expect(effectiveRainMonth(10)).toBe(0);
  });
  it("reproduces the manual's April example: IN = 198 + 0 + 150 + 100 − 135 = 313 mm", () => {
    // ETo 6 mm/day × Kc 1.1 for 30 days; PERC 5 mm/day; WL 100 mm; April rain 200 mm (Pe 135). SAT falls in March.
    const etc = new Array(30).fill(6.6);
    const rain = [...new Array(30).fill(0), ...new Array(30).fill(200 / 30)];
    const r = paddyIrrigation(dayIndex("2020-04-01"), etc, rain, 5)!;
    const apr = r.months.find((m) => m.month === "2020-04")!;
    expect(apr.etcMm).toBeCloseTo(198, 9);
    expect(apr.percMm).toBe(150);
    expect(apr.layerMm).toBe(100);
    expect(apr.effectiveRainMm).toBeCloseTo(135, 9);
    expect(apr.irrigationMm).toBeCloseTo(313, 9);
    expect(r.months.find((m) => m.month === "2020-03")!.satMm).toBeCloseTo(PADDY.satMm, 9);
    expect(r.irrigationMm).toBeCloseTo(513, 9);
  });
  it("returns null when rain or ETc is missing (no guessing)", () => {
    expect(paddyIrrigation(dayIndex("2020-04-01"), [6, null], [...new Array(30).fill(0), 0, 0])).toBeNull();
  });
  it("runs inside the rotation chain and leaves the soil at field capacity for the next crop", () => {
    const L = 120;
    const n = 400;
    const et0 = new Array(n).fill(5), precip = new Array(n).fill(1);
    const period = { et0: et0.slice(60, 60 + L), precip: precip.slice(60, 60 + L), stages: { ini: 30, dev: 30, mid: 40, late: 20 }, kc: { ini: 1.05, mid: 1.2, end: 0.75 }, soil: null, irrigation: "full" as const };
    const next = { et0: et0.slice(200, 300), precip: precip.slice(200, 300), stages: { ini: 20, dev: 30, mid: 30, late: 20 }, kc: { ini: 0.3, mid: 1.15, end: 0.25 }, soil: { awcMmPerM: 150, rootMaxM: 1.5, p: 0.55 }, irrigation: "full" as const };
    const chain = runChain({ plantings: [{ start: 60, length: L, period, cropId: "rice", paddy: { rootMaxM: 1 } }, { start: 200, length: 100, period: next, cropId: "spring_wheat" }], from: 0, to: n, et0, precip, awcMmPerM: 150, hsg: null, initial: "field_capacity", startDay: dayIndex("2020-01-01") });
    const rice = chain.results[0]!;
    expect(rice.irrigationMm!).toBeGreaterThan(rice.etcMm! + PADDY.satMm);
    expect(rice.etaMm).toBe(rice.etcMm);
    expect(chain.chainBreaks).toBe(0);
    expect(chain.results[1]!.irrigationMm).not.toBeNull();
  });
});
