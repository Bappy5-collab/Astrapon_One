import { describe, expect, it } from "vitest";

import { applyTransformation, et0Method, et0Series, extraterrestrialRadiation, penmanMonteithEt0, satVp, weatherFromSeries, type DailyWeather } from "./climate";

describe("FAO-56 Penman-Monteith (engine 1.3.0)", () => {
  it("reproduces FAO-56 Example 18 (Brussels, 6 July): ET0 ≈ 3.9 mm/day", () => {
    // Example 18: 50°48'N, 100 m, Tmax 21.5, Tmin 12.3, ea 1.409 kPa, u2 2.078 m/s, Rs 22.07 MJ m⁻² day⁻¹.
    const lat = 50 + 48 / 60;
    const tdew = (237.3 * Math.log(1.409 / 0.6108)) / (17.27 - Math.log(1.409 / 0.6108)); // Eq. 14 inverted
    expect(satVp(tdew)).toBeCloseTo(1.409, 6);
    expect(extraterrestrialRadiation(lat, 187)).toBeCloseTo(41.09, 1);
    expect(penmanMonteithEt0({ tmax: 21.5, tmin: 12.3, tdew, u2: 2.078, rs: 22.07 }, lat, 187, 100)!).toBeCloseTo(3.9, 1);
  });
  it("uses one method per series: Penman-Monteith when its inputs exist, Hargreaves otherwise", () => {
    const base = weatherFromSeries("2020-07-01", [30, 31], [20, 21], [0, 0]);
    const pm: DailyWeather = { ...base, pm: { tdew: [18, null], wind: [2, 2], rs: [20, 20], elevationM: 20 } };
    expect(et0Method(base)).toBe("hargreaves");
    expect(et0Method(pm)).toBe("penman_monteith");
    const e = et0Series(pm, 24.6);
    expect(e[0]).toBeGreaterThan(0);
    expect(e[1]).toBeNull(); // a missing dew point makes the day missing, never a Hargreaves stand-in
    expect(et0Series(base, 24.6).every((v) => v != null)).toBe(true);
  });
  it("moves the dew point with a temperature change", () => {
    const pm: DailyWeather = { ...weatherFromSeries("2020-07-01", [30], [20], [0]), pm: { tdew: [18], wind: [2], rs: [20], elevationM: 20 } };
    const t = applyTransformation(pm, { kind: "temperature_offset", celsius: 2 });
    expect(t.pm!.tdew[0]).toBe(20);
    expect(et0Series(t, 24.6)[0]!).toBeGreaterThan(et0Series(pm, 24.6)[0]!);
  });
});

describe("FAO-56 Eq. 62/65 Kc climate adjustment (engine 1.3.0)", async () => {
  const { kcClimateAdjust, stageClimate } = await import("./climate");
  it("leaves Table 12 values unchanged in the reference climate (u2 2 m/s, RHmin 45 %)", () => {
    expect(kcClimateAdjust(1.2, 2, 45, 2)).toBeCloseTo(1.2, 12);
  });
  it("raises Kc in dry, windy air and lowers it in humid, calm air, within FAO-56 limits", () => {
    // 1.15 + [0.04·2 − 0.004·(−20)]·(1/3)^0.3 = 1.15 + 0.16·0.7192
    expect(kcClimateAdjust(1.15, 4, 25, 1)).toBeCloseTo(1.15 + 0.16 * (1 / 3) ** 0.3, 10);
    expect(kcClimateAdjust(1.15, 1, 80, 1)).toBeLessThan(1.15);
    expect(kcClimateAdjust(1.15, 20, 5, 1)).toBeCloseTo(kcClimateAdjust(1.15, 6, 20, 1), 12); // clamped to the limits
  });
  it("computes stage means from POWER wind and dew point, or null when a day is missing", () => {
    const w = { ...weatherFromSeries("2020-03-01", [30, 30], [20, 20], [0, 0]), pm: { tdew: [10, 10], wind: [2, 4], rs: [20, 20], elevationM: 20 } };
    const c = stageClimate(w, 0, 2)!;
    expect(c.u2).toBe(3);
    expect(c.rhMin).toBeCloseTo((100 * satVp(10)) / satVp(30), 10);
    expect(stageClimate({ ...w, pm: { ...w.pm, wind: [2, null] } }, 0, 2)).toBeNull();
  });
});
