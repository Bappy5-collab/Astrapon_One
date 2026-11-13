/**
 * Weather-based dry-season outlook for surface water (water-energy 1.2.0). Pure and deterministic.
 *
 * From the field's pinned NASA POWER daily series (precipitation, Tmax, Tmin) it computes, for each
 * calendar month, the median monthly rainfall P and reference evapotranspiration ET0 (FAO-56
 * Eq. 52, Hargreaves, the same ET0 as the engine) over the complete months of the record.
 *
 * A month is DRY when P < 0.5 × ET0: the threshold FAO uses to bound the growing period in its
 * Agro-ecological Zones method (FAO 1978, World Soil Resources Report 48/1; Higgins & Kassam 1981).
 * Consecutive dry months form the dry season. Rain refills ponds and small streams; evaporation
 * and use draw them down, so the water-balance deficit Σ(ET0 − P) accumulated since the last wet
 * month is reported for each dry month, and the month where it peaks is where surface water is
 * most likely to be lowest.
 *
 * This is a CLIMATE INDICATOR, not an observation of any pond or river: it ignores upstream inflow,
 * groundwater exchange, canal releases, pond size and depth, and other users. Large rivers fed from
 * far upstream can behave very differently. Nothing here is a forecast.
 */

import { dayIndex, dayOfYear, isoDate } from "../simulation/dates";
import { hargreavesEt0 } from "../simulation/climate";

/** 1.1.0: rain from NASA IMERG (0.1°) when stored for the field, else NASA POWER; never mixed. */
export const DRY_SEASON_METHOD_VERSION = "1.1.0";
/** FAO AEZ growing-period threshold: rainfall below half of potential evapotranspiration. */
export const DRY_RATIO = 0.5;

export type DryMonth = {
  month: number;
  /** Years with a complete record of this month. */
  years: number;
  medianPrecipMm: number | null;
  medianEt0Mm: number | null;
  /** Years in which this month itself was dry (P < 0.5 ET0). */
  dryYears: number;
  dry: boolean;
  /** Σ(ET0 − P) of the median months since the last wet month (mm); null for wet months. */
  cumulativeDeficitMm: number | null;
};

export type DrySeasonOutlook = {
  methodVersion: string;
  status: "ok" | "insufficient";
  reason: string | null;
  period: { from: string; to: string; completeYears: number } | null;
  months: DryMonth[];
  /** Dry months in season order (starting after the last wet month). */
  dryMonths: number[];
  /** Dry month with the largest accumulated deficit: surface water most likely lowest. */
  lowestMonth: number | null;
  /** Dry season with the largest total deficit in the record; a season crossing New Year spans two years. */
  hardestSeason: { startYear: number; endYear: number; deficitMm: number } | null;
  /** Year-round wet climate: no month is dry. */
  noDrySeason: boolean;
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Minimum complete years per calendar month for a usable outlook. */
export const MIN_YEARS = 5;

export function drySeasonOutlook(series: { start: string; tmax: (number | null)[]; tmin: (number | null)[]; precip: (number | null)[] }, latitudeDeg: number): DrySeasonOutlook {
  const n = series.precip.length;
  const empty = (reason: string): DrySeasonOutlook => ({ methodVersion: DRY_SEASON_METHOD_VERSION, status: "insufficient", reason, period: null, months: [], dryMonths: [], lowestMonth: null, hardestSeason: null, noDrySeason: false });
  if (series.tmax.length !== n || series.tmin.length !== n) return empty("The daily weather series are not aligned.");
  if (!Number.isFinite(latitudeDeg) || Math.abs(latitudeDeg) > 90) return empty("The field location is invalid.");
  const start = dayIndex(series.start);

  // Monthly totals per (year, month); a month counts only when every day has P, Tmax and Tmin.
  const totals = new Map<string, { y: number; m: number; p: number; e: number; days: number; ok: boolean }>();
  for (let i = 0; i < n; i++) {
    const day = start + i;
    const iso = isoDate(day);
    const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7));
    const key = `${y}-${m}`;
    const t = totals.get(key) ?? { y, m, p: 0, e: 0, days: 0, ok: true };
    const p = series.precip[i], hi = series.tmax[i], lo = series.tmin[i];
    if (p == null || hi == null || lo == null || hi < lo) t.ok = false;
    else {
      t.p += p;
      t.e += hargreavesEt0(hi, lo, latitudeDeg, dayOfYear(day));
    }
    t.days++;
    totals.set(key, t);
  }
  const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const complete = [...totals.values()].filter((t) => t.ok && t.days === daysIn(t.y, t.m));
  if (!complete.length) return empty("No complete month of stored NASA weather (rain and temperature) exists for this field.");

  const months: DryMonth[] = Array.from({ length: 12 }, (_, i) => {
    const rows = complete.filter((t) => t.m === i + 1);
    const p = median(rows.map((t) => t.p)), e = median(rows.map((t) => t.e));
    return {
      month: i + 1,
      years: rows.length,
      medianPrecipMm: p == null ? null : r1(p),
      medianEt0Mm: e == null ? null : r1(e),
      dryYears: rows.filter((t) => t.p < DRY_RATIO * t.e).length,
      dry: p != null && e != null && p < DRY_RATIO * e,
      cumulativeDeficitMm: null,
    };
  });
  const thin = months.filter((m) => m.years < MIN_YEARS);
  if (thin.length) return empty(`Fewer than ${MIN_YEARS} complete years of weather for ${thin.length} month(s); refresh the field's weather to get a longer record.`);

  const years = [...new Set(complete.map((t) => t.y))].sort((a, b) => a - b);
  const completeYears = years.filter((y) => complete.filter((t) => t.y === y).length === 12).length;
  // The span of the complete months actually used (1.1.0): with IMERG rain this starts in 1998, not
  // at the start of the POWER series, and ends where the rain record ends.
  const pad = (v: number) => String(v).padStart(2, "0");
  const firstMonth = complete.reduce((a, t) => (t.y * 12 + t.m < a.y * 12 + a.m ? t : a));
  const lastMonth = complete.reduce((a, t) => (t.y * 12 + t.m > a.y * 12 + a.m ? t : a));
  const period = { from: `${firstMonth.y}-${pad(firstMonth.m)}-01`, to: `${lastMonth.y}-${pad(lastMonth.m)}-${pad(daysIn(lastMonth.y, lastMonth.m))}`, completeYears };
  const dryCount = months.filter((m) => m.dry).length;
  if (dryCount === 0) return { methodVersion: DRY_SEASON_METHOD_VERSION, status: "ok", reason: null, period, months, dryMonths: [], lowestMonth: null, hardestSeason: null, noDrySeason: true };

  // Season order: start after the last wet month (wrapping the year); every month dry → start in January.
  const lastWet = (() => {
    for (let k = 11; k >= 0; k--) if (!months[k]!.dry) return k;
    return -1;
  })();
  const order = Array.from({ length: 12 }, (_, i) => (lastWet + 1 + i) % 12);
  const dryMonths: number[] = [];
  let acc = 0;
  let lowest: { month: number; acc: number } | null = null;
  for (const k of order) {
    const m = months[k]!;
    if (!m.dry) { acc = 0; continue; }
    acc += (m.medianEt0Mm ?? 0) - (m.medianPrecipMm ?? 0);
    m.cumulativeDeficitMm = r1(acc);
    dryMonths.push(m.month);
    if (!lowest || acc > lowest.acc) lowest = { month: m.month, acc };
  }

  // Hardest dry season: Σ(ET0 − P) over the climatological dry months of one season. A season that
  // crosses New Year (e.g. Nov → Apr) takes the months after the wrap from the next year.
  // Only seasons with every dry month complete are compared.
  let hardest: { startYear: number; endYear: number; deficitMm: number } | null = null;
  const first = dryMonths[0]!;
  for (const y of years) {
    const rows = dryMonths.map((m) => complete.find((t) => t.y === (m >= first ? y : y + 1) && t.m === m));
    if (rows.some((t) => !t)) continue;
    const d = rows.reduce((a, t) => a + (t!.e - t!.p), 0);
    const endYear = dryMonths.some((m) => m < first) ? y + 1 : y;
    if (!hardest || d > hardest.deficitMm) hardest = { startYear: y, endYear, deficitMm: r1(d) };
  }
  return { methodVersion: DRY_SEASON_METHOD_VERSION, status: "ok", reason: null, period, months, dryMonths, lowestMonth: lowest?.month ?? null, hardestSeason: hardest, noDrySeason: false };
}

/** Gross water a demand option needs in the given calendar months, per year (m³/yr). */
export function needInMonths(months: { key: string; grossM3: number | null }[], calendarMonths: number[], years: number): number | null {
  const sel = months.filter((m) => calendarMonths.includes(Number(m.key.slice(5, 7))));
  if (sel.some((m) => m.grossM3 == null)) return null;
  return Math.round((sel.reduce((a, m) => a + (m.grossM3 ?? 0), 0) / Math.max(1, years)) * 10) / 10;
}
