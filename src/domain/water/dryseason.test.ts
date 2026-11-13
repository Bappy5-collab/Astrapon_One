import { describe, expect, it } from "vitest";

import { dayIndex, isoDate } from "../simulation/dates";
import { DRY_RATIO, drySeasonOutlook, needInMonths } from "./dryseason";

/** Synthetic years (TEST ONLY): constant temperatures, rain only in the given months at mm/day. */
function series(years: number, rainByMonth: Record<number, number>, from = "2010-01-01") {
  const start = dayIndex(from);
  const end = dayIndex(`${2010 + years}-01-01`);
  const tmax: (number | null)[] = [], tmin: (number | null)[] = [], precip: (number | null)[] = [];
  for (let d = start; d < end; d++) {
    const m = Number(isoDate(d).slice(5, 7));
    tmax.push(32);
    tmin.push(20);
    precip.push(rainByMonth[m] ?? 0);
  }
  return { start: from, tmax, tmin, precip };
}
const monsoon = { 5: 6, 6: 12, 7: 14, 8: 12, 9: 9, 10: 5 };

describe("dry-season outlook (weather-based indicator)", () => {
  it("finds the dry months in season order and the month with the largest deficit", () => {
    const o = drySeasonOutlook(series(8, monsoon), 24.6);
    expect(o.status).toBe("ok");
    expect(o.dryMonths).toEqual([11, 12, 1, 2, 3, 4]);
    expect(o.lowestMonth).toBe(4);
    const apr = o.months[3]!, nov = o.months[10]!;
    expect(apr.cumulativeDeficitMm!).toBeGreaterThan(nov.cumulativeDeficitMm!);
    expect(o.months[6]!.dry).toBe(false);
    expect(o.months[6]!.cumulativeDeficitMm).toBeNull();
    expect(apr.dryYears).toBe(8);
    expect(o.period!.completeYears).toBe(8);
    expect(o.period).toMatchObject({ from: "2010-01-01", to: "2017-12-31" });
  });
  it("reports the span of the complete months used, not the whole temperature series (rain from a shorter record)", () => {
    const s = series(8, monsoon);
    // Rain missing for the first two years and the last six months, as with IMERG on a longer POWER series.
    const cut = dayIndex("2012-01-01") - dayIndex("2010-01-01"), tail = dayIndex("2017-07-01") - dayIndex("2010-01-01");
    s.precip = s.precip.map((v, i) => (i < cut || i >= tail ? null : v));
    const o = drySeasonOutlook(s, 24.6);
    expect(o.period).toMatchObject({ from: "2012-01-01", to: "2017-06-30", completeYears: 5 });
  });
  it("uses rain < 0.5 × ET0 as the dry test", () => {
    expect(DRY_RATIO).toBe(0.5);
    const o = drySeasonOutlook(series(6, monsoon), 24.6);
    for (const m of o.months) if (m.medianPrecipMm != null && m.medianEt0Mm != null) expect(m.dry).toBe(m.medianPrecipMm < 0.5 * m.medianEt0Mm);
  });
  it("reports no dry season when it rains enough every month", () => {
    const wet = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 10]));
    const o = drySeasonOutlook(series(6, wet), 24.6);
    expect(o.noDrySeason).toBe(true);
    expect(o.dryMonths).toEqual([]);
  });
  it("names the hardest dry season", () => {
    const s = series(6, monsoon);
    // A hotter April 2013 raises that year's evaporation demand in the dry months.
    const start = dayIndex(s.start);
    for (let d = dayIndex("2013-04-01"); d <= dayIndex("2013-04-30"); d++) s.tmax[d - start] = 38;
    // April 2013 belongs to the season Nov 2012 → Apr 2013.
    expect(drySeasonOutlook(s, 24.6).hardestSeason).toMatchObject({ startYear: 2012, endYear: 2013 });
  });
  it("refuses a short or gappy record instead of guessing", () => {
    expect(drySeasonOutlook(series(3, monsoon), 24.6).status).toBe("insufficient");
    const s = series(6, monsoon);
    for (let i = 0; i < s.precip.length; i += 20) s.precip[i] = null; // a gap in every month
    const o = drySeasonOutlook(s, 24.6);
    expect(o.status).toBe("insufficient");
    expect(o.reason).toMatch(/complete/);
  });
  it("is deterministic", () => {
    const s = series(6, monsoon);
    expect(JSON.stringify(drySeasonOutlook(s, 24.6))).toBe(JSON.stringify(drySeasonOutlook(s, 24.6)));
  });
  it("sums an option's need in given calendar months per year", () => {
    const months = [
      { key: "2020-03", grossM3: 100 },
      { key: "2020-04", grossM3: 200 },
      { key: "2021-03", grossM3: 300 },
      { key: "2021-07", grossM3: 999 },
    ];
    expect(needInMonths(months, [3, 4], 2)).toBe(300);
    expect(needInMonths([{ key: "2020-03", grossM3: null }], [3], 1)).toBeNull();
  });
});
