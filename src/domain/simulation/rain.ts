/**
 * Which daily rain a run uses (engine 1.4.0). Pure and deterministic.
 *
 * In order, the first product with a value on every day of the replay window is used for the whole
 * run:
 *   1. NASA GPM IMERG Final Run V07 (satellite, 0.1° cell, calibrated to monthly rain gauges;
 *      the V07 record ends 2025-09-30),
 *   2. NASA GPM IMERG Late Run V07 (satellite, 0.1° cell, climatological calibration only),
 *   3. NASA POWER (MERRA-2 bias-corrected reanalysis, ½° × ⅝° cell).
 * The products are never mixed, day by day or year by year. Temperature, humidity, wind and
 * radiation always come from POWER.
 */

export type RainSource = "gpm-imerg-final" | "gpm-imerg-late" | "nasa-power-daily";

export type RainSeries = { start: string; values: (number | null)[] };
export type ImergRain = { retrievalId: string; productVersion: string | null; final: RainSeries | null; late: RainSeries | null };

export type RainChoice = {
  source: RainSource;
  retrievalId: string | null;
  /** Rain aligned to the POWER day index (same start and length as the POWER series). */
  precip: (number | null)[];
  /** Why IMERG was not used although it was pinned; null otherwise. */
  fallback: string | null;
  /** Why the gauge-calibrated Final Run was passed over for the Late Run; null otherwise. */
  note: string | null;
};

const DAY = 86_400_000;
const dayIndex = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
const isoOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

/** Null when the series has a value on every day of [w0, w1]; otherwise the reason. */
function gap(s: RainSeries, w0: number, w1: number, label: string): string | null {
  const i0 = dayIndex(s.start), i1 = i0 + s.values.length - 1;
  if (i0 > w0 || i1 < w1) return `the ${label} covers ${s.start} to ${isoOf(i1)}`;
  let missing = 0;
  for (let d = w0; d <= w1; d++) if (s.values[d - i0] == null) missing++;
  return missing ? `the ${label} has ${missing} missing day(s)` : null;
}

/** IMERG on the POWER day index; days outside the IMERG record stay missing (never filled from POWER). */
function align(s: RainSeries, powerStart: string, n: number): (number | null)[] {
  const off = dayIndex(powerStart) - dayIndex(s.start);
  return Array.from({ length: n }, (_, k) => s.values[k + off] ?? null);
}

/**
 * @param power   POWER start date and rain (the series every other variable is aligned to)
 * @param imerg   the pinned IMERG series, if any
 * @param window  replay window in calendar years (inclusive)
 */
export function chooseRain(power: { retrievalId: string; start: string; precip: (number | null)[] }, imerg: ImergRain | null | undefined, window: { fromYear: number; toYear: number }): RainChoice {
  const fromPower = (fallback: string | null): RainChoice => ({ source: "nasa-power-daily", retrievalId: power.retrievalId, precip: power.precip, fallback, note: null });
  if (!imerg || (!imerg.final && !imerg.late)) return fromPower(null);
  const w0 = dayIndex(`${window.fromYear}-01-01`), w1 = dayIndex(`${window.toYear}-12-31`);
  const reasons: string[] = [];
  for (const [run, s, label] of [["gpm-imerg-final", imerg.final, "IMERG Final Run"], ["gpm-imerg-late", imerg.late, "IMERG Late Run"]] as const) {
    if (!s) { reasons.push(`the ${label} is not stored`); continue; }
    const why = gap(s, w0, w1, label);
    if (why) { reasons.push(why); continue; }
    return { source: run, retrievalId: imerg.retrievalId, precip: align(s, power.start, power.precip.length), fallback: null, note: reasons.length ? reasons.join("; ") : null };
  }
  return fromPower(`NASA IMERG satellite rain does not cover every day of ${window.fromYear}–${window.toYear} (${reasons.join("; ")}), so NASA POWER rain is used for the whole run (rain products are never mixed).`);
}
