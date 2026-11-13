/**
 * Engine 1.2.0: continuous soil water across a rotation (docs/scientific-methodology.md §6.5).
 *
 * A chain of plantings is simulated day by day. During a planting the FAO-56 Ch. 8 root-zone
 * balance (waterbalance.ts) runs as before; between plantings the soil is bare:
 *  - the store is the soil down to the previous crop's final root depth;
 *  - rain enters after NRCS curve-number runoff for bare fallow; water above field capacity drains;
 *  - bare-soil evaporation follows FAO-56 Ch. 7 (Eq. 71–74, 77) with Kcb = 0 and few = 1:
 *    E = Kr · Kc,max · ET0, Kc,max = 1.20, Kr = 1 while De ≤ REW, (TEW − De)/(TEW − REW) after,
 *    with TEW and REW from FAO-56 Table 19 for the soil class implied by the soil's AWC (see
 *    evaporationParams) — an Astrapon assumption, stated in every result.
 * At every hand-over (harvest → bare → planting) the relative depletion is carried over, the
 * same assumption the engine already makes when roots deepen. A crop whose water balance is not
 * modelled (missing parameters) breaks the chain: the next planting starts again at the stated
 * initial storage, and the result says so.
 * 1.3.0: flooded (paddy) rice under full irrigation uses the FAO Training Manual No. 3 paddy
 * procedure (paddy.ts) instead of the root-zone balance; afterwards the soil is at field capacity.
 */

import { PADDY, paddyIrrigation } from "./paddy";
import { curveNumberRunoff, emptyTrace, runPeriod, type DayTrace, type PeriodInput, type PeriodResult } from "./waterbalance";

export const KC_MAX_BARE = 1.2;

export type HydrologicGroup = "A" | "B" | "C" | "D";
export type CoverClass = "row_crop" | "small_grain" | "close_seeded_legume" | "fallow";

/** NRCS NEH 630 Ch. 9 Table 9-1 (straight row, good hydrologic condition; fallow bare soil). */
export const CURVE_NUMBERS: Record<CoverClass, Record<HydrologicGroup, number>> = {
  fallow: { A: 77, B: 86, C: 91, D: 94 },
  row_crop: { A: 67, B: 78, C: 85, D: 89 },
  small_grain: { A: 63, B: 75, C: 83, D: 87 },
  close_seeded_legume: { A: 58, B: 72, C: 81, D: 85 },
};

/** Astrapon's mapping of catalogue crops to Table 9-1 cover types (stated assumption). */
const SMALL_GRAIN = new Set(["winter_wheat", "spring_wheat", "barley", "oats", "rye", "millet", "flax", "rapeseed", "mustard"]);
const CLOSE_SEEDED_LEGUME = new Set(["lentil", "pea_dry", "common_vetch", "red_clover"]);
export function coverClass(cropId: string | null): CoverClass {
  if (cropId && SMALL_GRAIN.has(cropId)) return "small_grain";
  if (cropId && CLOSE_SEEDED_LEGUME.has(cropId)) return "close_seeded_legume";
  return "row_crop";
}

/**
 * FAO-56 Table 19 evaporation parameters (Ze = 0.10 m) for the class implied by AWC (mm/m):
 * < 110 coarse (loamy sand: TEW 9–14, REW 4–8), 110–150 sandy loam (TEW 15–20, REW 6–10),
 * > 150 loam/silt (TEW 16–22, REW 8–10). Range midpoints are used.
 */
export function evaporationParams(awcMmPerM: number): { tew: number; rew: number; soilClass: string } {
  if (awcMmPerM < 110) return { tew: 11.5, rew: 6, soilClass: "coarse (loamy sand range)" };
  if (awcMmPerM <= 150) return { tew: 17.5, rew: 8, soilClass: "sandy loam range" };
  return { tew: 19, rew: 9, soilClass: "loam range" };
}

export type BareResult = { days: number; precipMm: number; runoffMm: number; evaporationMm: number; drainageMm: number; endRel: number; conservationErrorMm: number };

/** One bare period. `rel` is the starting relative depletion of a store `zoneM` deep. */
export function runBare(input: {
  et0: number[];
  precip: number[];
  awcMmPerM: number;
  zoneM: number;
  rel: number;
  cn: number | null;
  trace?: { depletion: (number | null)[]; evaporation: (number | null)[]; drainage: (number | null)[]; runoff: (number | null)[] };
}): BareResult {
  const { tew, rew } = evaporationParams(input.awcMmPerM);
  const taw = input.awcMmPerM * input.zoneM;
  let dr = Math.min(1, Math.max(0, input.rel)) * taw;
  let de = Math.min(1, Math.max(0, input.rel)) * tew;
  const start = taw - dr;
  let P = 0, RO = 0, E = 0, DP = 0;
  for (let d = 0; d < input.et0.length; d++) {
    const p = input.precip[d]!;
    const ro = input.cn ? curveNumberRunoff(p, input.cn) : 0;
    const inf = p - ro;
    P += p;
    RO += ro;
    de = Math.max(0, de - inf);
    dr -= inf;
    let dp = 0;
    if (dr < 0) { dp = -dr; dr = 0; }
    const kr = de <= rew ? 1 : Math.max(0, (tew - de) / (tew - rew));
    const e = Math.max(0, Math.min(kr * KC_MAX_BARE * input.et0[d]!, tew - de, taw - dr));
    de += e;
    dr += e;
    E += e;
    DP += dp;
    if (input.trace) {
      input.trace.depletion.push(taw > 0 ? dr / taw : 0);
      input.trace.evaporation.push(e);
      input.trace.drainage.push(dp);
      input.trace.runoff.push(ro);
    }
  }
  const err = P - RO - E - DP - (taw - dr - start);
  if (Math.abs(err) > 1e-6 * Math.max(1, P)) throw new Error(`Bare-soil balance not conserved (${err} mm)`);
  return { days: input.et0.length, precipMm: P, runoffMm: RO, evaporationMm: E, drainageMm: DP, endRel: taw > 0 ? dr / taw : 0, conservationErrorMm: err };
}

export type ChainPlanting = {
  /** Absolute weather index of planting. */
  start: number;
  length: number;
  /** null when the crop has no water balance (potential only) or weather is incomplete. */
  period: Omit<PeriodInput, "initial" | "runoffCn" | "trace"> | null;
  cropId: string | null;
  /** 1.3.0: flooded rice (FAO TM3 paddy procedure); `rootMaxM` is the store left for the next crop. */
  paddy?: { rootMaxM: number } | null;
};

/** Daily values over a window; null where not modelled or (kc, etc, ks, root) on bare days. */
export type ChainTrace = { [K in keyof DayTrace | "evaporation"]: (number | null)[] };

/**
 * Runs plantings in order from weather index `from` to `to` (exclusive). Plantings must not overlap.
 * Returns one PeriodResult per planting (null where not modelled) and the bare-period totals.
 */
export function runChain(opts: {
  plantings: ChainPlanting[];
  from: number;
  to: number;
  et0: (number | null)[];
  precip: (number | null)[];
  awcMmPerM: number | null;
  hsg: HydrologicGroup | null;
  initial: "field_capacity" | "readily_available_depleted";
  /** Absolute day index of weather index 0 (needed for paddy months, 1.3.0). */
  startDay?: number;
  /** Optional daily trace for weather indices [from, to) of this window (display only). */
  traceWindow?: { from: number; to: number };
}): { results: (PeriodResult | null)[]; bare: { runoffMm: number; evaporationMm: number; drainageMm: number; days: number; unknownDays: number }; chainBreaks: number; trace: ChainTrace | null } {
  const { plantings, awcMmPerM, hsg } = opts;
  const tw = opts.traceWindow;
  const len = tw ? tw.to - tw.from : 0;
  const blank = () => new Array<number | null>(len).fill(null);
  const trace: ChainTrace | null = tw ? { kc: blank(), etc: blank(), rootM: blank(), depletion: blank(), ks: blank(), eta: blank(), irrigation: blank(), drainage: blank(), runoff: blank(), evaporation: blank() } : null;
  const put = (key: keyof ChainTrace, abs: number, v: number | null | undefined) => {
    if (!trace || !tw || v == null) return;
    const i = abs - tw.from;
    if (i >= 0 && i < len) trace[key][i] = v;
  };
  const results: (PeriodResult | null)[] = [];
  const bare = { runoffMm: 0, evaporationMm: 0, drainageMm: 0, days: 0, unknownDays: 0 };
  // State: relative depletion and store depth; null = unknown (start of chain or after an unmodelled crop).
  let rel: number | null = null;
  let zoneM = 0.15;
  let chainBreaks = 0;
  let cursor = opts.from;
  function copyTrace(t: DayTrace, start: number, withRunoff = false) {
    for (const k of ["kc", "etc", "rootM", "depletion", "ks", "eta", "irrigation", "drainage"] as const) t[k].forEach((v, d) => put(k, start + d, v));
    if (withRunoff) t.runoff.forEach((v, d) => put("runoff", start + d, v));
  }
  const bareRun = (a: number, b: number) => {
    if (b <= a) return;
    bare.days += b - a;
    if (rel == null || awcMmPerM == null) { bare.unknownDays += b - a; return; }
    const et0 = opts.et0.slice(a, b), precip = opts.precip.slice(a, b);
    if (et0.some((v) => v == null) || precip.some((v) => v == null)) { rel = null; bare.unknownDays += b - a; return; }
    const bt = trace ? { depletion: [] as (number | null)[], evaporation: [] as (number | null)[], drainage: [] as (number | null)[], runoff: [] as (number | null)[] } : undefined;
    const r = runBare({ et0: et0 as number[], precip: precip as number[], awcMmPerM, zoneM, rel, cn: hsg ? CURVE_NUMBERS.fallow[hsg] : null, trace: bt });
    if (bt) for (let d = 0; d < b - a; d++) {
      put("depletion", a + d, bt.depletion[d]);
      put("evaporation", a + d, bt.evaporation[d]);
      put("drainage", a + d, bt.drainage[d]);
      if (hsg) put("runoff", a + d, bt.runoff[d]);
    }
    bare.runoffMm += r.runoffMm;
    bare.evaporationMm += r.evaporationMm;
    bare.drainageMm += r.drainageMm;
    rel = r.endRel;
  };
  for (const p of plantings) {
    bareRun(cursor, p.start);
    if (p.paddy && p.period && p.period.irrigation === "full" && opts.startDay != null) {
      const t = emptyTrace();
      const r = runPeriod({ ...p.period, soil: null, initial: "field_capacity", trace: t });
      const pre = p.start - PADDY.satDays;
      const rain = pre >= 0 ? opts.precip.slice(pre, p.start + p.length) : null;
      const pd = r.complete && rain && rain.length === PADDY.satDays + p.length ? paddyIrrigation(opts.startDay + p.start, t.etc, rain) : null;
      if (trace) {
        copyTrace(t, p.start);
        // Monthly irrigation shown spread evenly over that month's days (display only).
        if (pd) {
          let day = pre;
          for (const m of pd.months) for (let d = 0; d < m.days; d++, day++) put("irrigation", day, m.irrigationMm / m.days);
        }
      }
      if (pd) {
        results.push({ ...r, etaMm: r.etcMm, irrigationMm: pd.irrigationMm, drainageMm: pd.percolationMm, stressDays: 0, endRel: 0, endRootM: p.paddy.rootMaxM });
        rel = awcMmPerM != null ? 0 : null;
        zoneM = p.paddy.rootMaxM;
      } else {
        results.push(r);
        if (rel != null) chainBreaks++;
        rel = null;
      }
      cursor = p.start + p.length;
      continue;
    }
    if (!p.period || !p.period.soil) {
      if (p.period && !p.period.soil) {
        const t = trace ? emptyTrace() : undefined;
        results.push(runPeriod({ ...p.period, initial: "field_capacity", trace: t }));
        if (t) copyTrace(t, p.start);
      } else results.push(null);
      if (rel != null) chainBreaks++;
      rel = null;
    } else {
      const initial: PeriodInput["initial"] = rel == null ? opts.initial : { rel };
      const t = trace ? emptyTrace() : undefined;
      const r = runPeriod({ ...p.period, initial, runoffCn: hsg ? CURVE_NUMBERS[coverClass(p.cropId)][hsg] : null, trace: t });
      if (t) copyTrace(t, p.start, hsg != null);
      results.push(r);
      if (r.complete && r.endRel != null && r.endRootM != null) { rel = r.endRel; zoneM = r.endRootM; }
      else rel = null;
    }
    cursor = p.start + p.length;
  }
  bareRun(cursor, opts.to);
  return { results, bare, chainBreaks, trace };
}
