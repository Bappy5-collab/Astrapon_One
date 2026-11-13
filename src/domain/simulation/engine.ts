import { frozenSettingsV2, MAX_ROTATION_YEARS, type FrozenSettings } from "@/domain/scenario/settings";
import { evaporationParams, runChain, type ChainPlanting, type HydrologicGroup } from "./continuous";

import { type CropParams, isDeepRooted, isFallowName, isLegume, resolveCrop } from "./catalog";
import { chooseRain, type RainChoice } from "./rain";
import { applyTransformations, et0Method, et0Series, kcClimateAdjust, stageClimate, type DailyWeather, type Transformation, validateWeather, weatherFromSeries } from "./climate";
import { dayIndex, forwardDays, isoDate, mdOffset, monthDayIn, offsetMd, yearOf } from "./dates";
import { ENGINE_VERSION } from "./engine-version";
import { type EngineInput, engineInputSchema } from "./inputs";
import type { CalendarEntry } from "./nass";
import { abs, bareWindowFillers, type BareFill, cycleKey, longestGap, occupiedDays, type Planting, schedule, type ScheduledPlanting, type Slot, slotFromWindow, yearPatterns } from "./schedule";
import { type KcSet, type PeriodInput, runPeriod, type Stages } from "./waterbalance";

/**
 * Rotation and simulation engine (docs/scientific-methodology.md). Pure and deterministic: no
 * clock, no randomness, no I/O. Same input and engine version → identical output.
 */

// ------------------------------------------------------------------ limits ---
export const LIMITS = { maxCrops: 12, maxPerYear: 3, exhaustiveSequences: 50_000, beamWidth: 2_000, maxAlternatives: 3, minCompleteYearShare: 0.5 } as const;
const FROST_C = 0;
const HOT_C = 35;

// ------------------------------------------------------------------- types ---
export type RejectionCode = "excluded" | "no_market_access" | "unknown_crop" | "no_window" | "overlap" | "window_missed" | "return_interval" | "water_allocation" | "fallow_year";
export type CaseId = "base" | "dry_start" | "kc_low" | "kc_high" | "driest_third" | "wettest_third";
export type PriorityKey = "water_use" | "soil_health" | "diversification" | "weather_risk" | "workload" | "income_stability";

export type IndicatorValue = { value: number | null; unit: string; detail?: string };
export type PlantingView = { crop: string; cropId: string | null; family: string | null; start: string; end: string; months: string; days: number; source: string; sourceDetail: string; cycleYear: number };
export type StrategyView = {
  id: string;
  kind: "baseline" | "alternative";
  label: string;
  plantings: PlantingView[];
  violations: { code: RejectionCode; detail: string }[];
  indicators: Record<string, IndicatorValue>;
  completeness: { item: string; have: number; of: number; note?: string }[];
  /** 1.3.0: crops whose planting dates fit the longest bare window (dates only; not compared). */
  bareFill?: { gapStart: string; gapDays: number; crops: BareFill[] };
};
export type Comparison = {
  scores: Record<string, number>;
  ranking: string[];
  contributions: Record<string, Partial<Record<PriorityKey, number>>>;
  groupsUsed: PriorityKey[];
  indicatorsUsed: string[];
  indicatorsDropped: { key: string; reason: string }[];
  cases: { id: CaseId; label: string; ranking: string[]; top: string | null }[];
  stability: "stable" | "fragile" | "single_option";
  changedBy: CaseId[];
  ablation: { priority: PriorityKey; ranking: string[]; topChanged: boolean }[];
  tradeoffs: Record<string, string[]>;
};
/** How an indicator is scored. Shipped with every run so rankings can be explained and re-weighted with scoreOptions(). */
export type IndicatorDefinition = { key: string; group: PriorityKey; better: "high" | "low"; unit: string; label: string; scored: boolean };
/** Indicator values per option id, rounded exactly as displayed (roundIndicator). */
export type IndicatorTable = Record<string, Record<string, number | null>>;

/** One planting placed on real dates of the timeline window. Day numbers are relative to the window start. */
export type TimelinePlanting = { crop: string; cropId: string | null; start: number; end: number; source: string; potentialOnly: boolean; stages: Stages | null };
/** Daily state of one option; null on bare days or where it cannot be computed. */
export type TimelineStrategy = {
  id: string;
  plantings: TimelinePlanting[];
  kc: (number | null)[];
  etc: (number | null)[];
  rootM: (number | null)[];
  depletion: (number | null)[];
  ks: (number | null)[];
  eta: (number | null)[];
  irrigation: (number | null)[];
  drainage: (number | null)[];
  /** 1.2.0: runoff on every day (null when not modelled) and bare-soil evaporation on bare days. */
  runoff?: (number | null)[];
  evaporation?: (number | null)[];
};
export type TimelineView = {
  kind: "historical_replay" | "scenario";
  startDate: string;
  days: number;
  years: number[];
  irrigationMode: "rainfed" | "full";
  soilKnown: boolean;
  weather: { precip: (number | null)[]; tmax: (number | null)[]; tmin: (number | null)[]; et0: (number | null)[] };
  strategies: TimelineStrategy[];
};

export type RunView = {
  kind: "historical_replay" | "scenario";
  transformations: Transformation[];
  indicatorDefinitions: IndicatorDefinition[];
  /** Day-by-day replay of the compared options over the most recent complete rotation-length window. */
  timeline: TimelineView | null;
  timelineNote: string | null;
  baseline: StrategyView | null;
  alternatives: StrategyView[];
  comparison: Comparison | null;
  messages: string[];
};
/** Zone-level comparison (1.2.0). */
export type ZoneResult = {
  zoneId: string;
  name: string;
  historyBasis: "zone" | "field";
  soilBasis: "zone" | "field";
  /** True when the zone has no records of its own and shares the whole-field result. */
  sameAsField: boolean;
  status: "ok" | "insufficient";
  messages: string[];
  gaps: string[];
  runs: RunView[];
};

export type EngineResult = {
  engineVersion: string;
  status: "ok" | "insufficient";
  messages: string[];
  snapshot: { id: string; inputsSha256: string };
  datasets: { kind: string; id: string; name: string; version: number; sha256: string }[];
  /** rainSource/rainRetrievalId from 1.4.0: which daily rain the run used (absent in older results = NASA POWER). */
  evidence: { weatherRetrievalId: string | null; soilRetrievalId: string | null; rainSource?: "gpm-imerg-final" | "gpm-imerg-late" | "nasa-power-daily" | null; rainRetrievalId?: string | null };
  period: { fromYear: number; toYear: number; completeYears: number | null; totalYears: number };
  irrigationMode: "rainfed" | "full";
  soil: { awcMmPerM: number | null; source: string };
  priorities: Record<PriorityKey, number>;
  prioritiesDefaulted: boolean;
  search: {
    cropsConsidered: string[];
    cropRejections: { crop: string; code: RejectionCode; detail: string }[];
    slots: { crop: string; source: string; detail: string; plant: string; days: number }[];
    sequencesExamined: number;
    feasible: number;
    bounded: boolean;
    rejectionCounts: Partial<Record<RejectionCode, number>>;
    rejectedExamples: { label: string; code: RejectionCode; detail: string }[];
  };
  runs: RunView[];
  assumptions: string[];
  gaps: string[];
  reviewQuestions: string[];
  references: { key: string; citation: string; usedFor: string }[];
  /** 1.2.0: zone-level comparisons (absent in older results). */
  zones?: ZoneResult[];
};

export const PRIORITY_KEYS: PriorityKey[] = ["water_use", "soil_health", "diversification", "weather_risk", "workload", "income_stability"];
export const CASE_LABELS: Record<CaseId, string> = {
  base: "Base case",
  dry_start: "Dry soil at planting",
  kc_low: "Low end of FAO-56 Kc ranges",
  kc_high: "High end of FAO-56 Kc ranges",
  driest_third: "Driest third of replay years",
  wettest_third: "Wettest third of replay years",
};

export const REFERENCES = [
  { key: "fao56", citation: "Allen, R.G., Pereira, L.S., Raes, D., Smith, M. (1998). Crop evapotranspiration. FAO Irrigation and Drainage Paper 56.", usedFor: "Penman-Monteith ET0 (Eq. 6–8, 11–14, 37–42) or Hargreaves ET0 (Eq. 52) for older weather retrievals, Ra (Eq. 21–25), Kc (Table 12), stage lengths (Table 11), Zr and p (Table 22), water balance (Ch. 8)." },
  { key: "usda-plants", citation: "USDA NRCS PLANTS Database, PlantProfile API (accessed 2026-11-01).", usedFor: "Botanical family of each crop." },
  { key: "usda-nass-2010", citation: "USDA NASS (2010). Usual Planting and Harvesting Dates for U.S. Field Crops.", usedFor: "State planting and harvesting windows (US only, when selected)." },
  { key: "fao-crop-calendar", citation: "FAO Crop Calendar (cropcalendar.apps.fao.org), retrieved 2026-11-05.", usedFor: "Sowing and harvest windows by country and agro-ecological zone (57 countries, when selected)." },
  { key: "nrcs-neh630", citation: "USDA NRCS (2004). National Engineering Handbook Part 630 Hydrology, Ch. 9 (Table 9-1) and Ch. 10.", usedFor: "Daily runoff by the curve-number method, when the hydrologic soil group is given (1.2.0)." },
  { key: "fao56-ch7", citation: "Allen et al. (1998). FAO-56, Chapter 7 (Eq. 71–79) and Table 19.", usedFor: "Bare-soil evaporation between crops in the continuous soil-water balance (1.2.0)." },
  { key: "canola-council-rotation", citation: "Canola Council of Canada, Canola Watch (2021-01-13).", usedFor: "Canola return interval (at most once in three years)." },
  { key: "bowles-2020-rotation-resilience", citation: "Bowles, T.M. et al. (2020). One Earth 2:284–293.", usedFor: "Context for rotation diversity; no effect size is applied." },
  { key: "zhao-2022-legume-rotations", citation: "Zhao, J. et al. (2022). Nature Communications 13:4926.", usedFor: "Context for legumes in rotations; no nitrogen credit is applied." },
  { key: "isric-soilgrids", citation: "Poggio, L. et al. (2021). SoilGrids 2.0. SOIL 7, 217–240. doi:10.5194/soil-7-217-2021 (CC-BY 4.0).", usedFor: "Root-zone water capacity from water content at 33 and 1500 kPa, where no soil test or SSURGO survey exists (1.3.0)." },
  { key: "nasa-power", citation: "NASA POWER Daily API (Agroclimatology), pinned retrieval.", usedFor: "Daily Tmax, Tmin; dew point, 2 m wind and all-sky shortwave radiation for Penman-Monteith (1.3.0); precipitation when NASA IMERG rain does not cover the replay window (1.4.0)." },
  { key: "gpm-imerg", citation: "Huffman, G.J., E.F. Stocker, D.T. Bolvin, E.J. Nelkin, J. Tan (2023, 2024). GPM IMERG Final (doi:10.5067/GPM/IMERGDF/DAY/07) and Late (doi:10.5067/GPM/IMERGDL/DAY/07) Precipitation L3 1 day 0.1° × 0.1° V07. GES DISC.", usedFor: "Daily rain for the field's 0.1° cell: the gauge-calibrated Final Run, else the Late Run, when it covers every day of the replay window; one product per run, never mixed (1.4.0)." },
  { key: "pereira-2021-field-crops", citation: "Pereira, L.S. et al. (2021). Agric. Water Manag. 243:106466 (FAO56 update for field crops).", usedFor: "Mustard Kc mid and end (Table 12), rooting depth, height and p (Table 15) (1.3.1)." },
  { key: "crop-stage-studies", citation: "Gupta et al. (2017) Curr. Sci. 113(2); MPKV Rahuri PoCRA lysimeter report (2023); Garofalo et al. (2009) WIT Trans. 125; Sarma & Bharadwaj (2020) J. Agrometeorol. 22(2).", usedFor: "Stage lengths for mustard, chickpea and rapeseed, which FAO-56 Table 11 lacks (1.3.1)." },
  { key: "milla-2018-jute", citation: "Milla, A.J. et al. (2018). The Agriculturists 16(2):115–122 (BARI and BJRI, Gazipur).", usedFor: "Jute Kc and stage lengths measured in Bangladesh; water use only (1.3.1)." },
];

// ----------------------------------------------------------------- helpers ---
const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Rounding applied to every indicator before it is shown or scored. */
export const roundIndicator = (unit: string, v: number) => (unit === "ratio" || unit === "share" ? r3(v) : r1(v));
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
};
const norm = (s: string) => s.normalize("NFC").trim().toLowerCase();
const kcPick = (v: number | { low: number; high: number }, which: "mid" | "low" | "high") => (typeof v === "number" ? v : which === "low" ? v.low : which === "high" ? v.high : (v.low + v.high) / 2);

/** Table 11 example closest in total length, scaled to the local season length (last stage takes the remainder). */
export function stagesFor(crop: CropParams, length: number): Stages | null {
  const ex = crop.fao56?.stages ?? [];
  if (!ex.length || length <= 0) return null;
  let best = ex[0]!;
  for (const e of ex) if (Math.abs(e.ini + e.dev + e.mid + e.late - length) < Math.abs(best.ini + best.dev + best.mid + best.late - length)) best = e;
  const total = best.ini + best.dev + best.mid + best.late;
  const ini = Math.round((length * best.ini) / total);
  const dev = Math.round((length * best.dev) / total);
  const mid = Math.round((length * best.mid) / total);
  const late = length - ini - dev - mid;
  if (late < 0) return null;
  return { ini, dev, mid, late };
}

// --------------------------------------------------------------- context ---
type YearMetric = { temps: boolean; water: boolean; precip: number; etc: number | null; eta: number | null; irr: number | null; frost: number; hot: number };

type Ctx = {
  catalog: CropParams[];
  settings: FrozenSettings;
  latitude: number;
  years: number[];
  weather: DailyWeather | null;
  et0: (number | null)[] | null;
  awcMmPerM: number | null;
  irrigation: "rainfed" | "full";
  turnaround: number;
  cache: Map<string, YearMetric[]>;
  annualPrecip: Map<number, number>;
  /** NRCS hydrologic soil group for runoff (1.2.0); null = runoff not modelled. */
  hsg: HydrologicGroup | null;
  chainCache: Map<string, InstanceMetric[]>;
};

/** One rotation-cycle instance of the continuous simulation (1.2.0), labelled by its start year. */
type InstanceMetric = { start: number; water: boolean; precip: number; etc: number; eta: number | null; irr: number | null; byCycleYear: (number | null)[]; runoff: number };

/** FAO-56 inputs of one planting starting at weather index i0; null when the crop lacks parameters or ET0 is unknown. */
function periodFor(ctx: Ctx, slot: Slot, i0: number, caseId: CaseId): PeriodInput | null {
  const w = ctx.weather;
  const f = slot.crop?.fao56 ?? null;
  const stages = slot.crop ? stagesFor(slot.crop, slot.length) : null;
  if (!w || !f || !stages || !ctx.et0) return null;
  const L = slot.length;
  const tmin = w.tmin.slice(i0, i0 + L);
  const which = caseId === "kc_low" ? "low" : caseId === "kc_high" ? "high" : f.rainfedUsesLowKcMid && ctx.irrigation === "rainfed" ? "low" : "mid";
  let kcIni: number;
  if (typeof f.kcIni === "number") kcIni = f.kcIni;
  else {
    const iniTmin = tmin.slice(0, Math.max(1, stages.ini)).filter((v): v is number => v != null);
    const mt = iniTmin.length ? iniTmin.reduce((a, b) => a + b, 0) / iniTmin.length : 1;
    kcIni = mt <= 0 ? f.kcIni.frozen : f.kcIni.nonFrozen;
  }
  const kc: KcSet = { ini: kcIni, mid: kcPick(f.kcMid, which), end: kcPick(f.kcEnd, which) };
  // 1.3.0: FAO-56 Eq. 62 / Eq. 65 climate adjustment from POWER wind and humidity (Penman-Monteith weather only).
  const h = f.heightM == null ? null : typeof f.heightM === "number" ? f.heightM : (f.heightM[0] + f.heightM[1]) / 2;
  if (h != null && w.pm && !f.kcLocal) {
    const midFrom = i0 + stages.ini + stages.dev, lateFrom = midFrom + stages.mid;
    const mid = stageClimate(w, midFrom, lateFrom);
    if (mid) kc.mid = kcClimateAdjust(kc.mid, mid.u2, mid.rhMin, h);
    const late = stageClimate(w, lateFrom, i0 + L);
    if (late && kc.end >= 0.45) kc.end = kcClimateAdjust(kc.end, late.u2, late.rhMin, h);
  }
  const soil = f.waterBalance === "full" && ctx.awcMmPerM != null && f.rootDepthM && f.p != null ? { awcMmPerM: ctx.awcMmPerM, rootMaxM: f.rootDepthM[1], p: f.p } : null;
  return { et0: ctx.et0.slice(i0, i0 + L), precip: w.precip.slice(i0, i0 + L), stages, kc, soil, initial: caseId === "dry_start" ? "readily_available_depleted" : "field_capacity", irrigation: ctx.irrigation };
}

function slotYears(ctx: Ctx, slot: Slot, startOffset: number, caseId: CaseId): YearMetric[] {
  const key = `${slot.key}|${startOffset}|${slot.length}|${caseId === "dry_start" || caseId === "kc_low" || caseId === "kc_high" ? caseId : "base"}`;
  const hit = ctx.cache.get(key);
  if (hit) return hit;
  const out: YearMetric[] = [];
  for (const y of ctx.years) {
    const m: YearMetric = { temps: false, water: false, precip: 0, etc: null, eta: null, irr: null, frost: 0, hot: 0 };
    const w = ctx.weather;
    if (w) {
      const plant = monthDayIn(y, offsetMd(startOffset));
      const i0 = plant - w.startDay;
      const L = slot.length;
      if (i0 >= 0 && i0 + L <= w.tmax.length) {
        const tmax = w.tmax.slice(i0, i0 + L);
        const tmin = w.tmin.slice(i0, i0 + L);
        const precip = w.precip.slice(i0, i0 + L);
        if (tmax.every((v) => v != null) && tmin.every((v) => v != null)) {
          m.temps = true;
          m.frost = tmin.filter((v) => v! <= FROST_C).length;
          m.hot = tmax.filter((v) => v! >= HOT_C).length;
        }
        if (precip.every((v) => v != null)) m.precip = precip.reduce<number>((a, b) => a + b!, 0);
        const pin = periodFor(ctx, slot, i0, caseId);
        if (pin) {
          const res = runPeriod(pin);
          if (res.complete) {
            m.water = true;
            m.etc = res.etcMm;
            m.eta = res.etaMm;
            m.irr = res.irrigationMm;
          }
        }
      }
    }
    out.push(m);
  }
  ctx.cache.set(key, out);
  return out;
}

// ------------------------------------------------------------- chains (1.2.0) ---
/**
 * Continuous simulation of a strategy over the replay window (docs/scientific-methodology.md §6.5).
 * N phase-shifted chains (cycle starting in year y0, y0+1, … y0+N−1) each run day by day to the end
 * of the window, so every start year gets one cycle instance whose soil water carries over from
 * the previous crop and fallow. When a chain has three or more instances, its first is spin-up only.
 */
function chainInstances(ctx: Ctx, s: Strategy, caseId: CaseId): InstanceMetric[] {
  const w = ctx.weather;
  if (!w || !ctx.et0) return [];
  const kind: CaseId = caseId === "dry_start" || caseId === "kc_low" || caseId === "kc_high" ? caseId : "base";
  const key = `${s.plantings.map((p) => `${p.slot.key}@${p.start}`).join(",")}|${s.cycleYears}|${kind}`;
  const hit = ctx.chainCache.get(key);
  if (hit) return hit;
  const N = s.cycleYears;
  const sorted = [...s.plantings].sort((a, b) => a.start - b.start);
  const y0 = ctx.years[0]!, yLast = ctx.years.at(-1)!;
  const out: InstanceMetric[] = [];
  for (let k = 0; k < N; k++) {
    const starts: number[] = [];
    for (let y = y0 + k; y + N - 1 <= yLast; y += N) starts.push(y);
    if (!starts.length) continue;
    const placed: { inst: number; cycleYear: number; start: number; length: number; period: ReturnType<typeof periodFor>; cropId: string | null; paddy: { rootMaxM: number } | null }[] = [];
    starts.forEach((y, m) => {
      for (const pl of sorted) {
        const cy = Math.floor(pl.start / 365);
        const off = ((pl.start % 365) + 365) % 365;
        const a = monthDayIn(y + cy, offsetMd(off)) - w.startDay;
        const ok = a >= 0 && a + pl.slot.length <= w.tmax.length;
        const f = pl.slot.crop?.fao56;
        placed.push({ inst: m, cycleYear: pl.cycleYear, start: a, length: pl.slot.length, period: ok ? periodFor(ctx, pl.slot, a, kind) : null, cropId: pl.slot.crop?.id ?? null, paddy: f?.waterBalance === "paddy" && f.rootDepthM ? { rootMaxM: f.rootDepthM[1] } : null });
      }
    });
    placed.sort((a, b) => a.start - b.start);
    const from = Math.max(0, monthDayIn(starts[0]!, "01-01") - w.startDay);
    const to = Math.min(w.tmax.length, Math.max(...placed.map((x) => x.start + x.length)));
    const chain = runChain({
      plantings: placed.map((x): ChainPlanting => ({ start: x.start, length: x.length, period: x.period, cropId: x.cropId, paddy: x.paddy })),
      from, to, et0: ctx.et0, precip: w.precip, awcMmPerM: ctx.awcMmPerM, hsg: ctx.hsg, startDay: w.startDay,
      initial: kind === "dry_start" ? "readily_available_depleted" : "field_capacity",
    });
    starts.forEach((y, m) => {
      if (starts.length >= 3 && m === 0) return;
      const mine = placed.map((x, i) => ({ x, r: chain.results[i] ?? null })).filter(({ x }) => x.inst === m);
      const water = mine.length > 0 && mine.every(({ r }) => r?.complete);
      const sum = (f: (r: NonNullable<(typeof mine)[number]["r"]>) => number | null) => {
        let t = 0;
        for (const { r } of mine) { const v = r ? f(r) : null; if (v == null) return null; t += v; }
        return t;
      };
      const byCycleYear = Array.from({ length: N }, (_, c) => {
        const ofYear = mine.filter(({ x }) => x.cycleYear === c);
        let t = 0;
        for (const { r } of ofYear) { if (r?.irrigationMm == null) return null; t += r.irrigationMm; }
        return t;
      });
      out.push({ start: y, water, precip: water ? sum((r) => r.precipMm)! : 0, etc: water ? sum((r) => r.etcMm)! : 0, eta: water ? sum((r) => r.etaMm) : null, irr: water ? sum((r) => r.irrigationMm) : null, byCycleYear, runoff: water ? (sum((r) => r.runoffMm) ?? 0) : 0 });
    });
  }
  out.sort((a, b) => a.start - b.start);
  ctx.chainCache.set(key, out);
  return out;
}

// --------------------------------------------------------------- slots ---
function buildSlots(ctx: Ctx, cropKeys: { key: string; name: string; crop: CropParams | null }[], history: EngineInput["snapshot"]["inputs"]["crop_history"], calendar: CalendarEntry[]): { slots: Slot[]; missing: string[] } {
  const slots: Slot[] = [];
  const missing: string[] = [];
  for (const c of cropKeys) {
    const own: Slot[] = [];
    // 1. Farmer windows.
    ctx.settings.plantingWindows.forEach((w, i) => {
      const r = resolveCrop(w.crop, ctx.catalog);
      if ((c.crop && r?.id === c.crop.id) || (!c.crop && norm(w.crop) === norm(c.name)))
        own.push(slotFromWindow(`${c.key}:w${i}`, c.crop, c.name, "farmer_window", `Your window ${w.plantFrom} to ${w.plantTo}, ${w.lengthDays} days`, w.plantFrom, w.plantTo, w.lengthDays));
    });
    // 2. Farmer history with both dates, grouped by the farmer's season label.
    if (!own.length) {
      const groups = new Map<string, { plant: number[]; len: number[] }>();
      for (const h of history) {
        if (h.zone_id !== null || !h.planted_on || !h.harvested_on) continue;
        const r = resolveCrop(h.crop_name, ctx.catalog);
        if (!((c.crop && r?.id === c.crop.id) || (!c.crop && norm(h.crop_name) === norm(c.name)))) continue;
        const pd = dayIndex(h.planted_on);
        const len = dayIndex(h.harvested_on) - pd;
        if (len < 20 || len > 330) continue;
        const g = groups.get(h.season) ?? { plant: [], len: [] };
        g.plant.push(mdOffset(isoDate(pd).slice(5) === "02-29" ? "02-28" : isoDate(pd).slice(5)));
        g.len.push(len);
        groups.set(h.season, g);
      }
      for (const [season, g] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        // Circular handling: express offsets relative to the first and wrap.
        const base = g.plant[0]!;
        const rel = g.plant.map((o) => { const d = forwardDays(base, o); return d > 182 ? d - 365 : d; });
        const lo = Math.min(...rel);
        const hi = Math.max(...rel);
        const pref = (((base + Math.round(median(rel)!)) % 365) + 365) % 365;
        own.push({
          key: `${c.key}:h:${season}`, crop: c.crop, cropName: c.name, source: "history",
          sourceDetail: `Your records (${g.plant.length} season${g.plant.length === 1 ? "" : "s"}, "${season}")`,
          preferred: pref, windowStart: (((base + lo) % 365) + 365) % 365, windowSpan: hi - lo, length: Math.round(median(g.len)!),
        });
      }
    }
    // 3. NASS calendar for the selected US state.
    if (!own.length && c.crop && ctx.settings.calendarRegion) {
      for (const e of calendar.filter((x) => x.region === ctx.settings.calendarRegion && x.cropId === c.crop!.id)) {
        const pA = mdOffset(e.plant.activeStart);
        const pB = mdOffset(e.plant.activeEnd);
        const hA = mdOffset(e.harvest.activeStart);
        const hB = mdOffset(e.harvest.activeEnd);
        const pref = (pA + Math.floor(forwardDays(pA, pB) / 2)) % 365;
        const harvest = (hA + Math.floor(forwardDays(hA, hB) / 2)) % 365;
        const length = forwardDays(pref, harvest);
        if (length < 20) continue;
        const begin = mdOffset(e.plant.begin);
        let span = forwardDays(begin, mdOffset(e.plant.end));
        // Keep the preferred date inside the window even when the source's begin/end are irregular.
        if (forwardDays(begin, pref) > span) span = forwardDays(begin, pref);
        own.push({
          key: `${c.key}:n:${norm(e.sourceCrop)}`, crop: c.crop, cropName: c.name, source: "calendar",
          sourceDetail: e.region.startsWith("FAO · ") ? `FAO Crop Calendar, ${e.region.slice(6)}, "${e.sourceCrop}"` : `USDA NASS 2010, ${e.region}, "${e.sourceCrop}"`, preferred: pref, windowStart: begin, windowSpan: span, length,
        });
      }
    }
    if (!own.length) missing.push(c.name);
    slots.push(...own);
  }
  return { slots, missing };
}

// --------------------------------------------------------------- strategy ---
type Strategy = { id: string; kind: "baseline" | "alternative"; plantings: ScheduledPlanting[]; cycleYears: number; violations: { code: RejectionCode; detail: string }[] };

function labelOf(plantings: ScheduledPlanting[], cycleYears: number): string {
  if (!plantings.length) return "Nothing planted";
  const byYear: string[][] = Array.from({ length: cycleYears }, () => []);
  for (const p of plantings) byYear[Math.max(0, Math.min(cycleYears - 1, p.cycleYear))]!.push(p.slot.cropName);
  return byYear.map((y) => (y.length ? y.join(" + ") : "(no new planting)")).join(" → ");
}

function plantingViews(s: Strategy): PlantingView[] {
  return s.plantings.map((p) => {
    const so = ((p.start % 365) + 365) % 365;
    const eo = ((p.end % 365) + 365) % 365;
    const a = monthDayIn(2001, offsetMd(so));
    return {
      crop: p.slot.cropName, cropId: p.slot.crop?.id ?? null, family: p.slot.crop?.family ?? null,
      start: offsetMd(so), end: offsetMd(eo), months: `${isoMonth(a)}–${isoMonth(a + Math.max(0, p.slot.length - 1))}`, days: p.slot.length,
      source: p.slot.source, sourceDetail: p.slot.sourceDetail, cycleYear: p.cycleYear,
    };
  });
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const isoMonth = (day: number) => MONTHS[Number(isoDate(day).slice(5, 7)) - 1]!;

type Raw = {
  bare: number; distinct: number | null; families: number | null; repeats: number | null; legumes: number | null; deep: number | null; ops: number;
  marketFit: number | null; frost: number | null; hot: number | null;
  relMedian: number | null; relDry: number | null; irrMedian: number | null; irrP80: number | null; climMedian: number | null; climDry: number | null;
  gapDays: number; gapStart: number; waterYears: number; tempYears: number;
};

function evaluate(ctx: Ctx, s: Strategy, caseId: CaseId, market: Map<string, string>): Raw {
  const N = s.cycleYears;
  const ps = s.plantings;
  const known = ps.every((p) => p.slot.crop);
  const bare = (N * 365 - occupiedDays(ps, N)) / N;
  const gap = longestGap(ps, N);
  const crops = new Set(ps.map((p) => p.slot.crop?.id ?? `?${p.slot.cropName}`));
  const fams = known ? new Set(ps.map((p) => p.slot.crop!.family)) : null;
  let repeats: number | null = null;
  if (known && ps.length > 1) {
    repeats = 0;
    for (let i = 0; i < ps.length; i++) if (ps[i]!.slot.crop!.family === ps[(i + 1) % ps.length]!.slot.crop!.family) repeats++;
  } else if (known) repeats = 0;
  const legumes = known ? ps.filter((p) => isLegume(p.slot.crop!)).length / N : null;
  const deep = known && ps.every((p) => p.slot.crop!.fao56?.rootDepthM) ? ps.filter((p) => isDeepRooted(p.slot.crop!)).length / N : null;
  // Market fit: share of plantings whose crop has a stated preferred/acceptable/contract market, among crops with any statement.
  const stated = ps.filter((p) => market.has(norm(p.slot.cropName)) || (p.slot.crop && market.has(p.slot.crop.id)));
  const marketFit = stated.length === ps.length && ps.length > 0
    ? stated.filter((p) => { const v = market.get(norm(p.slot.cropName)) ?? market.get(p.slot.crop?.id ?? ""); return v === "preferred" || v === "acceptable" || v === "contract"; }).length / ps.length
    : null;

  // Years in this case.
  let years = ctx.years;
  if (caseId === "driest_third" || caseId === "wettest_third") {
    const ranked = ctx.years.filter((y) => ctx.annualPrecip.has(y)).sort((a, b) => ctx.annualPrecip.get(a)! - ctx.annualPrecip.get(b)! || a - b);
    const k = Math.max(1, Math.floor(ranked.length / 3));
    years = caseId === "driest_third" ? ranked.slice(0, k) : ranked.slice(-k);
  }
  const idx = years.map((y) => ctx.years.indexOf(y));
  const metrics = ps.map((p) => slotYears(ctx, p.slot, ((p.start % 365) + 365) % 365, caseId));
  const frostY: number[] = [];
  const hotY: number[] = [];
  const rel: { y: number; v: number }[] = [];
  const irr: { y: number; v: number }[] = [];
  const clim: { y: number; v: number }[] = [];
  const etcKnown = known && ps.every((p) => p.slot.crop!.fao56 && stagesFor(p.slot.crop!, p.slot.length));
  // 1.3.0: paddy rice under full irrigation needs no soil value; upland crops do.
  const paddyOk = (p: (typeof ps)[number]) => p.slot.crop!.fao56!.waterBalance === "paddy" && ctx.irrigation === "full";
  const soilKnown = etcKnown && ps.every((p) => paddyOk(p) || (p.slot.crop!.fao56!.waterBalance === "full" && ctx.awcMmPerM != null));
  for (const i of idx) {
    const ms = metrics.map((m) => m[i]!);
    if (ms.every((m) => m.temps)) {
      frostY.push(ms.reduce((a, m) => a + m.frost, 0) / N);
      hotY.push(ms.reduce((a, m) => a + m.hot, 0) / N);
    }
  }
  // Water (1.2.0): continuous cycle instances that start in this case's years.
  const inCase = new Set(years);
  for (const m of chainInstances(ctx, s, caseId)) {
    if (!inCase.has(m.start) || !etcKnown || !m.water) continue;
    clim.push({ y: m.start, v: (m.precip - m.etc) / N });
    if (soilKnown) {
      if (ctx.irrigation === "rainfed" && m.eta != null) rel.push({ y: m.start, v: m.etc > 0 ? m.eta / m.etc : 1 });
      else if (ctx.irrigation === "full" && m.irr != null) irr.push({ y: m.start, v: m.irr / N });
    }
  }
  const enough = (n: number) => n >= Math.max(1, Math.ceil(years.length * LIMITS.minCompleteYearShare));
  const dryThird = (xs: { y: number; v: number }[]) => {
    const ranked = xs.filter((x) => ctx.annualPrecip.has(x.y)).sort((a, b) => ctx.annualPrecip.get(a.y)! - ctx.annualPrecip.get(b.y)! || a.y - b.y);
    return mean(ranked.slice(0, Math.max(1, Math.floor(ranked.length / 3))).map((x) => x.v));
  };
  const vals = (xs: { v: number }[]) => xs.map((x) => x.v);
  const waterYears = Math.max(rel.length, irr.length, clim.length);
  return {
    bare, distinct: known ? crops.size : null, families: fams ? fams.size : null, repeats, legumes, deep, ops: ps.length / N, marketFit,
    frost: enough(frostY.length) ? mean(frostY) : null, hot: enough(hotY.length) ? mean(hotY) : null,
    relMedian: enough(rel.length) ? median(vals(rel)) : null, relDry: enough(rel.length) ? dryThird(rel) : null,
    irrMedian: enough(irr.length) ? median(vals(irr)) : null, irrP80: enough(irr.length) ? quantile(vals(irr), 0.8) : null,
    climMedian: enough(clim.length) ? median(vals(clim)) : null, climDry: enough(clim.length) ? dryThird(clim) : null,
    gapDays: gap.days, gapStart: gap.start, waterYears, tempYears: frostY.length,
  };
}

/** Median-year net irrigation per cycle year (for the allocation constraint). null if not computable. */
function irrigationPerCycleYear(ctx: Ctx, s: Strategy): number[] | null {
  if (ctx.irrigation !== "full") return null;
  if (s.plantings.some((p) => !p.slot.crop?.fao56 || !stagesFor(p.slot.crop, p.slot.length) || !(p.slot.crop.fao56.waterBalance === "paddy" || (p.slot.crop.fao56.waterBalance === "full" && ctx.awcMmPerM != null)))) return null;
  const inst = chainInstances(ctx, s, "base").filter((m) => m.water && m.byCycleYear.every((v) => v != null));
  if (inst.length < Math.max(1, Math.ceil(ctx.years.length * LIMITS.minCompleteYearShare))) return null;
  return Array.from({ length: s.cycleYears }, (_, k) => median(inst.map((m) => m.byCycleYear[k]!))!);
}

// ---------------------------------------------------------------- scoring ---
/** `scored: false`: reported as context but not used in the ranking (no sourced crop-specific threshold). */
type Ind = { key: string; group: PriorityKey; better: "high" | "low"; unit: string; label: string; get: (r: Raw) => number | null; scored?: false };

function indicatorSet(ctx: Ctx): Ind[] {
  const water: Ind[] =
    ctx.awcMmPerM != null && ctx.irrigation === "rainfed"
      ? [{ key: "relative_water_supply", group: "water_use", better: "high", unit: "ratio", label: "Relative water supply (rainfed, median year)", get: (r) => r.relMedian }]
      : ctx.awcMmPerM != null
        ? [{ key: "irrigation_requirement", group: "water_use", better: "low", unit: "mm/year", label: "Net irrigation requirement (median year)", get: (r) => r.irrMedian }]
        : [];
  const clim: Ind = { key: "climatic_water_balance", group: "water_use", better: "high", unit: "mm/year", label: "Climatic water balance during crops (no soil storage)", get: (r) => r.climMedian };
  const gap: Ind =
    ctx.awcMmPerM != null && ctx.irrigation === "rainfed"
      ? { key: "water_supply_dry_gap", group: "weather_risk", better: "low", unit: "ratio", label: "Drop in water supply in the driest third of years", get: (r) => (r.relMedian != null && r.relDry != null ? r.relMedian - r.relDry : null) }
      : ctx.awcMmPerM != null
        ? { key: "irrigation_dry_gap", group: "weather_risk", better: "low", unit: "mm/year", label: "Extra irrigation in dry years (80th percentile − median)", get: (r) => (r.irrMedian != null && r.irrP80 != null ? r.irrP80 - r.irrMedian : null) }
        : { key: "climatic_dry_gap", group: "weather_risk", better: "low", unit: "mm/year", label: "Drop in climatic water balance in the driest third", get: (r) => (r.climMedian != null && r.climDry != null ? r.climMedian - r.climDry : null) };
  return [
    ...water,
    ...(water.length ? [] : [clim]),
    { key: "bare_days", group: "soil_health", better: "low", unit: "days/year", label: "Scheduled bare-field days", get: (r) => r.bare },
    { key: "family_repeats", group: "soil_health", better: "low", unit: "per cycle", label: "Same-family plantings in a row", get: (r) => r.repeats },
    { key: "legume_plantings", group: "soil_health", better: "high", unit: "per year", label: "Legume plantings", get: (r) => r.legumes },
    { key: "deep_rooted_plantings", group: "soil_health", better: "high", unit: "per year", label: "Deep-rooted plantings (FAO-56 max root ≥ 1.5 m)", get: (r) => r.deep },
    { key: "crop_diversity", group: "diversification", better: "high", unit: "crops", label: "Distinct crops", get: (r) => r.distinct },
    { key: "family_diversity", group: "diversification", better: "high", unit: "families", label: "Distinct plant families", get: (r) => r.families },
    { key: "frost_days", group: "weather_risk", better: "low", unit: "days/year", label: "Frost days during crops (Tmin ≤ 0 °C; exposure, not scored)", get: (r) => r.frost, scored: false },
    { key: "hot_days", group: "weather_risk", better: "low", unit: "days/year", label: "Hot days during crops (Tmax ≥ 35 °C; exposure, not scored)", get: (r) => r.hot, scored: false },
    gap,
    { key: "field_operations", group: "workload", better: "low", unit: "plantings/year", label: "Field operations (plantings per year; workload proxy)", get: (r) => r.ops },
    { key: "market_fit", group: "income_stability", better: "high", unit: "share", label: "Market fit (your stated preferences; not income)", get: (r) => r.marketFit },
  ];
}

const definitions = (inds: Ind[]): IndicatorDefinition[] => inds.map((i) => ({ key: i.key, group: i.group, better: i.better, unit: i.unit, label: i.label, scored: i.scored !== false }));

function tableOf(inds: Ind[], ids: string[], raws: Map<string, Raw>): IndicatorTable {
  return Object.fromEntries(ids.map((id) => [id, Object.fromEntries(inds.map((i) => { const v = i.get(raws.get(id)!); return [i.key, v == null ? null : roundIndicator(i.unit, v)]; }))]));
}

function score(inds: Ind[], ids: string[], raws: Map<string, Raw>, weights: Record<PriorityKey, number>) {
  return scoreOptions(definitions(inds), ids, tableOf(inds, ids, raws), weights);
}

/**
 * Relative scores among the given options (docs/scientific-methodology.md §8): each scored indicator
 * available for every option is min–max normalised among them, averaged within its priority group,
 * and groups are weighted by the farmer's priorities. Pure; the UI uses it to preview other weights.
 */
export function scoreOptions(defs: IndicatorDefinition[], ids: string[], table: IndicatorTable, weights: Record<PriorityKey, number>) {
  const used: IndicatorDefinition[] = [];
  const dropped: { key: string; reason: string }[] = [];
  const val = (id: string, key: string) => table[id]?.[key] ?? null;
  for (const ind of defs) {
    if (!ind.scored) continue;
    if (ids.some((id) => val(id, ind.key) == null)) dropped.push({ key: ind.key, reason: "Not available for every option compared" });
    else used.push(ind);
  }
  const group: Record<string, Partial<Record<PriorityKey, number>>> = Object.fromEntries(ids.map((id) => [id, {}]));
  for (const g of PRIORITY_KEYS) {
    const gi = used.filter((i) => i.group === g);
    if (!gi.length) continue;
    for (const id of ids) {
      let sum = 0;
      for (const ind of gi) {
        const vs = ids.map((x) => val(x, ind.key)!);
        const lo = Math.min(...vs);
        const hi = Math.max(...vs);
        const v = val(id, ind.key)!;
        const s = hi === lo ? 0.5 : (v - lo) / (hi - lo);
        sum += ind.better === "high" ? s : 1 - s;
      }
      group[id]![g] = sum / gi.length;
    }
  }
  const groupsUsed = PRIORITY_KEYS.filter((g) => used.some((i) => i.group === g));
  let wsum = groupsUsed.reduce((a, g) => a + weights[g], 0);
  const w = { ...weights };
  if (wsum === 0) {
    for (const g of groupsUsed) w[g] = 1;
    wsum = groupsUsed.length;
  }
  const scores: Record<string, number> = {};
  const contributions: Record<string, Partial<Record<PriorityKey, number>>> = {};
  for (const id of ids) {
    let total = 0;
    contributions[id] = {};
    for (const g of groupsUsed) {
      const c = wsum > 0 ? (w[g] * (group[id]![g] ?? 0)) / wsum : 0;
      contributions[id]![g] = r3(c);
      total += c;
    }
    scores[id] = r3(total);
  }
  const ranking = [...ids].sort((a, b) => scores[b]! - scores[a]! || a.localeCompare(b));
  return { scores, ranking, contributions, groupsUsed, used, dropped };
}

// --------------------------------------------------------------- timeline ---
/**
 * Day-by-day replay of the compared options (docs/scientific-methodology.md §10). The window is the
 * most recent run of rotation-length calendar years inside the replay period with complete daily
 * weather. Each planting is placed on real dates (its cycle-year offset in those years, plus the
 * previous and next repetition where they overlap the window) and run through the same FAO-56
 * balance as the indicators, from field capacity. Display data only: it never feeds the ranking.
 */
function buildTimeline(ctx: Ctx, strategies: Strategy[], kind: RunView["kind"], cycleYears: number): { timeline: TimelineView | null; note: string | null } {
  const w = ctx.weather;
  if (!w || !ctx.et0) return { timeline: null, note: "No daily weather series is pinned, so there is no day-by-day replay." };
  const complete = (a: number, b: number) => {
    const i = a - w.startDay;
    const j = b - w.startDay;
    if (i < 0 || j > w.tmax.length) return false;
    for (let k = i; k < j; k++) if (w.tmax[k] == null || w.tmin[k] == null || w.precip[k] == null) return false;
    return true;
  };
  let first: number | null = null;
  for (let y = ctx.years.at(-1)!; y - cycleYears + 1 >= ctx.years[0]!; y--) {
    if (complete(dayIndex(`${y - cycleYears + 1}-01-01`), dayIndex(`${y + 1}-01-01`))) { first = y - cycleYears + 1; break; }
  }
  if (first == null) return { timeline: null, note: `No ${cycleYears} consecutive replay year(s) have complete daily weather, so there is no day-by-day replay.` };
  const start = dayIndex(`${first}-01-01`);
  const end = dayIndex(`${first + cycleYears}-01-01`);
  const days = end - start;
  const i0 = start - w.startDay;
  const round = (xs: (number | null)[]) => xs.map((v) => (v == null ? null : r1(v)));
  const out: TimelineStrategy[] = [];
  for (const st of strategies) {
    const plantings: TimelinePlanting[] = [];
    const chainList: ChainPlanting[] = [];
    const placed = [...st.plantings].sort((x, y) => x.start - y.start);
    // 1.2.0: one continuous chain with a spin-up cycle before the window, so the window's first crop
    // inherits the soil water left by the previous cycle's crops and fallow.
    for (const p of placed) {
      const k = Math.floor(p.start / 365);
      const off = p.start - k * 365;
      const kk = ((k % cycleYears) + cycleYears) % cycleYears;
      for (const rep of [-2, -1, 0, 1]) {
        const a = monthDayIn(first + kk + rep * cycleYears, offsetMd(off));
        const b = a + p.slot.length;
        if (b <= start - cycleYears * 365 || a >= end) continue;
        const wi = a - w.startDay;
        const ok = wi >= 0 && wi + p.slot.length <= w.tmax.length;
        const pf = p.slot.crop?.fao56;
        chainList.push({ start: wi, length: p.slot.length, period: ok ? periodFor(ctx, p.slot, wi, "base") : null, cropId: p.slot.crop?.id ?? null, paddy: pf?.waterBalance === "paddy" && pf.rootDepthM ? { rootMaxM: pf.rootDepthM[1] } : null });
        if (b <= start || a >= end) continue;
        const crop = p.slot.crop;
        const stages = crop ? stagesFor(crop, p.slot.length) : null;
        const potentialOnly = !crop?.fao56 || crop.fao56.waterBalance !== "full" || ctx.awcMmPerM == null;
        plantings.push({ crop: p.slot.cropName, cropId: crop?.id ?? null, start: a - start, end: b - start, source: p.slot.source, potentialOnly, stages });
      }
    }
    chainList.sort((x, y) => x.start - y.start);
    const from = Math.max(0, start - cycleYears * 365 - w.startDay);
    const chain = runChain({
      plantings: chainList.filter((c, i) => i === 0 || c.start >= chainList[i - 1]!.start + chainList[i - 1]!.length),
      from, to: Math.min(w.tmax.length, end - w.startDay), et0: ctx.et0!, precip: w.precip, awcMmPerM: ctx.awcMmPerM, hsg: ctx.hsg, startDay: w.startDay,
      initial: "field_capacity", traceWindow: { from: start - w.startDay, to: end - w.startDay },
    });
    const t = chain.trace!;
    const round = (xs: (number | null)[], f: (v: number) => number) => xs.map((v) => (v == null ? null : f(v)));
    plantings.sort((x, y) => x.start - y.start || x.crop.localeCompare(y.crop));
    out.push({
      id: st.id, plantings,
      kc: round(t.kc, r2), etc: round(t.etc, r1), rootM: round(t.rootM, r2), depletion: round(t.depletion, r3), ks: round(t.ks, r2), eta: round(t.eta, r1),
      irrigation: round(t.irrigation, r1), drainage: round(t.drainage, r1), runoff: round(t.runoff, r1), evaporation: round(t.evaporation, r1),
    });
  }
  const sl = <T,>(xs: T[]) => xs.slice(i0, i0 + days);
  return {
    timeline: {
      kind, startDate: isoDate(start), days, years: Array.from({ length: cycleYears }, (_, i) => first + i), irrigationMode: ctx.irrigation, soilKnown: ctx.awcMmPerM != null,
      weather: { precip: round(sl(w.precip)), tmax: round(sl(w.tmax)), tmin: round(sl(w.tmin)), et0: round(sl(ctx.et0)) },
      strategies: out,
    },
    note: null,
  };
}

// ----------------------------------------------------------------- engine ---
export function runEngine(rawInput: unknown): EngineResult {
  const input = engineInputSchema.parse(rawInput);
  const result = runEngineCore(input);
  if (result.status !== "ok") return result;
  const zones = zoneResults(input);
  return zones.length ? { ...result, zones } : result;
}

const MAX_ZONE_RUNS = 6;

/**
 * Zone-level rotations (1.2.0, docs/scientific-methodology.md §1). Each zone is compared on its own
 * records: its own dated history when it has any (else the whole-field history), and its own soil
 * test when it has one (else the field's soil value). Weather, candidates, settings and priorities
 * are shared. A zone with neither its own history nor its own soil test would repeat the
 * whole-field result, so it is listed without a separate run.
 */
function zoneResults(input: EngineInput): ZoneResult[] {
  const inputs = input.snapshot.inputs;
  const out: ZoneResult[] = [];
  for (const z of inputs.zones.slice(0, MAX_ZONE_RUNS)) {
    const ownHistory = inputs.crop_history.filter((h) => h.zone_id === z.id);
    const ownSoil = inputs.soil_observations.filter((o) => o.zone_id === z.id && o.property === "available_water_capacity" && o.value_numeric != null);
    const historyBasis = ownHistory.length ? "zone" : "field";
    const soilBasis = ownSoil.length ? "zone" : "field";
    if (!ownHistory.length && !ownSoil.length) {
      out.push({ zoneId: z.id, name: z.name, historyBasis, soilBasis, sameAsField: true, status: "ok", messages: ["This zone has no records of its own, so it shares the whole-field comparison."], gaps: [], runs: [] });
      continue;
    }
    const zoneInputs = {
      ...inputs,
      crop_history: (ownHistory.length ? ownHistory : inputs.crop_history.filter((h) => h.zone_id === null)).map((h) => ({ ...h, zone_id: null })),
      soil_observations: ownSoil.length ? ownSoil.map((o) => ({ ...o, zone_id: null })) : inputs.soil_observations.filter((o) => o.zone_id === null),
      zones: [],
    };
    const r = runEngineCore({ ...input, snapshot: { ...input.snapshot, inputs: zoneInputs } });
    out.push({
      zoneId: z.id, name: z.name, historyBasis, soilBasis, sameAsField: false, status: r.status, messages: r.messages, gaps: r.gaps,
      // Zone results keep the comparison and indicators; the day-by-day timeline stays with the whole field.
      runs: r.runs.map((v) => ({ ...v, timeline: null, timelineNote: "Day-by-day replay is shown for the whole field." })),
    });
  }
  if (inputs.zones.length > MAX_ZONE_RUNS) out.push({ zoneId: "", name: `${inputs.zones.length - MAX_ZONE_RUNS} more zone(s)`, historyBasis: "field", soilBasis: "field", sameAsField: true, status: "insufficient", messages: [`Only the first ${MAX_ZONE_RUNS} zones are compared separately.`], gaps: [], runs: [] });
  return out;
}

function runEngineCore(input: EngineInput): EngineResult {
  const inputs = input.snapshot.inputs;
  const calendarSets = [...(input.calendarDatasets ?? []), ...(input.calendarDataset ? [input.calendarDataset] : [])];
  const messages: string[] = [];
  const gaps: string[] = [];
  const assumptions: string[] = [];
  const questions: string[] = [];

  const parsed = frozenSettingsV2.safeParse(inputs.scenario.settings);
  const datasets = [
    ...(input.cropDataset ? [{ kind: "crop_parameters", id: input.cropDataset.id, name: input.cropDataset.name, version: input.cropDataset.version, sha256: input.cropDataset.sha256 }] : []),
    ...calendarSets.map((d) => ({ kind: "crop_calendar", id: d.id, name: d.name, version: d.version, sha256: d.sha256 })),
  ];
  const priorities: Record<PriorityKey, number> = inputs.priorities
    ? { water_use: inputs.priorities.water_use, soil_health: inputs.priorities.soil_health, diversification: inputs.priorities.diversification, weather_risk: inputs.priorities.weather_risk, workload: inputs.priorities.workload, income_stability: inputs.priorities.income_stability }
    : { water_use: 3, soil_health: 3, diversification: 3, weather_risk: 3, workload: 3, income_stability: 3 };
  const base = {
    engineVersion: ENGINE_VERSION, snapshot: { id: input.snapshot.id, inputsSha256: input.snapshot.inputsSha256 }, datasets,
    evidence: { weatherRetrievalId: input.weather?.retrievalId ?? null, soilRetrievalId: input.soilSurvey?.retrievalId ?? null },
    priorities, prioritiesDefaulted: !inputs.priorities, references: REFERENCES,
  };
  const insufficient = (why: string, period: EngineResult["period"] = { fromYear: 0, toYear: 0, completeYears: null, totalYears: 0 }): EngineResult => ({
    ...base, status: "insufficient", messages: [why], period, irrigationMode: "rainfed", soil: { awcMmPerM: null, source: "unknown" },
    search: { cropsConsidered: [], cropRejections: [], slots: [], sequencesExamined: 0, feasible: 0, bounded: false, rejectionCounts: {}, rejectedExamples: [] },
    runs: [], assumptions: [], gaps: [why], reviewQuestions: [],
  });
  if (input.engineVersion !== ENGINE_VERSION) return insufficient(`This input was prepared for engine ${input.engineVersion}; this is engine ${ENGINE_VERSION}.`);
  if (!parsed.success) return insufficient("The scenario settings in this snapshot could not be read. Save the scenario again and take a new snapshot.");
  const settings = parsed.data;
  if (!inputs.field.centroid) return insufficient("The field has no saved boundary, so its location is unknown. Draw the boundary first.");
  if (!input.cropDataset) return insufficient("No crop-parameter reference dataset was pinned in this snapshot.");
  const latitude = inputs.field.centroid.coordinates[1];
  const rotationYears = Math.min(settings.rotationYears, MAX_ROTATION_YEARS);
  if (settings.rotationYears > MAX_ROTATION_YEARS) messages.push(`Rotation length ${settings.rotationYears} was reduced to ${MAX_ROTATION_YEARS} years, the longest the engine compares.`);
  const years: number[] = [];
  for (let y = settings.replayFromYear; y <= settings.replayToYear; y++) years.push(y);
  const period = { fromYear: settings.replayFromYear, toYear: settings.replayToYear, completeYears: null as number | null, totalYears: years.length };
  if (years.length === 0 || years.length > 45) return insufficient("The replay window must cover 1 to 45 years.", period);

  // Weather.
  let historical: DailyWeather | null = null;
  let rainChoice: RainChoice | null = null;
  if (input.weather) {
    // Days where the provider reports Tmax below Tmin are treated as missing (excluded, not repaired).
    const tmax = [...input.weather.tmax];
    const tmin = [...input.weather.tmin];
    let inconsistent = 0;
    for (let i = 0; i < tmax.length; i++)
      if (tmax[i] != null && tmin[i] != null && tmax[i]! < tmin[i]!) {
        tmax[i] = null;
        tmin[i] = null;
        inconsistent++;
      }
    if (inconsistent) messages.push(`${inconsistent} day(s) with maximum temperature below minimum were treated as missing.`);
    // 1.4.0: rain from NASA IMERG when it covers the whole replay window, else POWER (one source per run).
    rainChoice = chooseRain({ retrievalId: input.weather.retrievalId, start: input.weather.start, precip: input.weather.precip }, input.rain, { fromYear: settings.replayFromYear, toYear: settings.replayToYear });
    if (rainChoice.fallback) gaps.push(rainChoice.fallback);
    historical = weatherFromSeries(input.weather.start, tmax, tmin, rainChoice.precip);
    const iw = input.weather;
    if (iw.tdew && iw.wind && iw.rs && iw.elevationM != null && iw.tdew.length === tmax.length && iw.wind.length === tmax.length && iw.rs.length === tmax.length) {
      historical = { ...historical, pm: { tdew: iw.tdew, wind: iw.wind, rs: iw.rs, elevationM: iw.elevationM } };
      validateWeather(historical);
    }
  }
  else gaps.push("No pinned NASA POWER daily series: water and temperature-exposure indicators are insufficient evidence. Refresh the field's evidence, then take a new snapshot.");
  const transformations: Transformation[] = [];
  if (settings.precipitationChangePct !== 0) transformations.push({ kind: "precipitation_scale", percent: settings.precipitationChangePct });
  if (settings.temperatureChangeC !== 0) transformations.push({ kind: "temperature_offset", celsius: settings.temperatureChangeC });

  // Soil water capacity: field lab value first, then SSURGO, then (1.3.0) the SoilGrids 2.0 model estimate.
  let awcMmPerM: number | null = null;
  let soilSource = "unknown";
  const lab = inputs.soil_observations.filter((s) => s.property === "available_water_capacity" && s.zone_id === null && s.value_numeric != null && s.depth_bottom_cm > s.depth_top_cm);
  if (lab.length) {
    const latest = lab.map((s) => s.observed_on).sort().at(-1)!;
    const rows = lab.filter((s) => s.observed_on === latest);
    const thick = rows.reduce((a, s) => a + (s.depth_bottom_cm - s.depth_top_cm), 0);
    awcMmPerM = rows.reduce((a, s) => a + s.value_numeric! * (s.depth_bottom_cm - s.depth_top_cm), 0) / thick * 1000;
    soilSource = `Your soil test (${latest}, ${rows.length} depth${rows.length === 1 ? "" : "s"}, ${rows[0]!.evidence_class === "ground_measurement" ? "lab or survey" : "your assessment"})`;
    if (awcMmPerM <= 0 || awcMmPerM > 700) { awcMmPerM = null; soilSource = "unknown"; gaps.push("Your recorded available water capacity is outside 0–0.7 cm/cm and was not used."); }
  }
  if (awcMmPerM == null && input.soilSurvey?.awcMm0to100 != null && input.soilSurvey.awcMm0to100 > 0) {
    awcMmPerM = input.soilSurvey.awcMm0to100; // mm in 0–100 cm → mm per metre
    soilSource = input.soilSurvey.source === "isric-soilgrids-v2" ? "ISRIC SoilGrids 2.0 model estimate (250 m), 0–100 cm" : "USDA SSURGO survey, 0–100 cm";
    if (input.soilSurvey.source === "isric-soilgrids-v2") gaps.push("Soil water capacity comes from the SoilGrids 2.0 global soil model (a 250 m machine-learning estimate, not a measurement). A soil test of your field would be more reliable and takes precedence when entered.");
  }
  if (awcMmPerM == null) gaps.push("Soil water capacity is unknown (no soil test value, no SSURGO survey and no SoilGrids estimate here): only potential water demand is shown, not water-limited uptake or irrigation need.");

  // Irrigation mode.
  const cons = inputs.constraints;
  let irrigation: "rainfed" | "full" = "rainfed";
  if (settings.irrigationAssumption === "full_irrigation") irrigation = "full";
  else if (settings.irrigationAssumption === "as_recorded") {
    if (!cons || !cons.irrigation || cons.irrigation === "unknown") { gaps.push("Irrigation availability is not recorded; the field is treated as rainfed."); questions.push("Can this field be irrigated, and how much water is available per season?"); }
    else if (cons.irrigation !== "none") irrigation = "full";
  }
  const allocation = settings.irrigationAssumption === "as_recorded" && irrigation === "full" ? cons?.seasonal_water_allocation_mm ?? null : null;
  if (settings.irrigationAssumption === "as_recorded" && irrigation === "full" && allocation == null) gaps.push("No seasonal water allocation is recorded, so irrigation need is not checked against a limit.");

  const turnaround = settings.turnaroundDays ?? 0;
  if (settings.turnaroundDays == null) { assumptions.push("Turnaround between harvest and the next planting: 0 days (not stated)."); questions.push("How many days do you need between a harvest and the next planting?"); }

  const catalog = input.cropDataset.items;
  const calendar = calendarSets.flatMap((d) => d.items);
  if (settings.calendarRegion && !calendar.some((e) => e.region === settings.calendarRegion)) gaps.push(`No planting calendar was found for "${settings.calendarRegion}".`);

  // Crops considered: candidates + whole-field history crops.
  const wholeHistory = inputs.crop_history.filter((h) => h.zone_id === null);
  if (inputs.zones.length) messages.push("This is the whole-field comparison; zones with their own records are also compared separately (see “By zone”).");
  const excluded = new Set((inputs.priorities?.excluded_crops ?? []).map(norm));
  const market = new Map<string, string>();
  for (const m of inputs.market_preferences) {
    const v = m.has_contract ? "contract" : m.preference;
    market.set(norm(m.crop_name), v);
    const r = resolveCrop(m.crop_name, catalog);
    if (r) market.set(r.id, v);
  }
  const fallowAllowed = settings.candidateCrops.some(isFallowName) || wholeHistory.some((h) => isFallowName(h.crop_name));
  const names = [...settings.candidateCrops, ...wholeHistory.map((h) => h.crop_name)].filter((n) => !isFallowName(n));
  const cropKeys: { key: string; name: string; crop: CropParams | null }[] = [];
  for (const n of names) {
    const crop = resolveCrop(n, catalog);
    const key = crop ? crop.id : `x_${norm(n).replace(/[^a-z0-9]+/g, "_")}`;
    if (!cropKeys.some((c) => c.key === key)) cropKeys.push({ key, name: crop ? crop.label : n.trim(), crop });
  }
  if (cropKeys.length > LIMITS.maxCrops) { messages.push(`Only the first ${LIMITS.maxCrops} crops were considered.`); cropKeys.length = LIMITS.maxCrops; }

  const cropRejections: { crop: string; code: RejectionCode; detail: string }[] = [];
  const isExcluded = (c: { name: string; crop: CropParams | null }) => excluded.has(norm(c.name)) || (c.crop != null && (excluded.has(c.crop.id) || c.crop.aliases.some((a) => excluded.has(norm(a)))));
  const noMarket = (c: { name: string; crop: CropParams | null }) => market.get(norm(c.name)) === "no_market_access" || (c.crop != null && market.get(c.crop.id) === "no_market_access");

  const ctx: Ctx = { catalog, settings, latitude, years, weather: historical, et0: historical ? et0Series(historical, latitude) : null, awcMmPerM, irrigation, turnaround, cache: new Map(), annualPrecip: new Map(), hsg: settings.runoffSoilGroup ?? null, chainCache: new Map() };
  const setAnnual = (w: DailyWeather | null) => {
    ctx.annualPrecip = new Map();
    if (!w) return;
    for (const y of years) {
      const a = dayIndex(`${y}-01-01`) - w.startDay;
      const b = dayIndex(`${y + 1}-01-01`) - w.startDay;
      if (a < 0 || b > w.precip.length) continue;
      const slice = w.precip.slice(a, b);
      if (slice.every((v) => v != null)) ctx.annualPrecip.set(y, slice.reduce<number>((s, v) => s + v!, 0));
    }
  };
  setAnnual(historical);
  period.completeYears = historical ? ctx.annualPrecip.size : null;

  const { slots: allSlots, missing } = buildSlots(ctx, cropKeys, wholeHistory, calendar);
  // 1.3.0: every catalogue crop's own window (same sources), for the bare-window suggestions only.
  const fillSlots = buildSlots(ctx, catalog.filter((c) => c.fao56).map((c) => ({ key: `fill:${c.id}`, name: c.label, crop: c })), wholeHistory, calendar).slots;
  const candidateSlots: Slot[] = [];
  for (const c of cropKeys) {
    if (isExcluded(c)) { cropRejections.push({ crop: c.name, code: "excluded", detail: "You excluded this crop." }); continue; }
    if (noMarket(c)) { cropRejections.push({ crop: c.name, code: "no_market_access", detail: "You recorded no market access for this crop." }); continue; }
    if (!c.crop) { cropRejections.push({ crop: c.name, code: "unknown_crop", detail: "Not in the crop catalogue, so it is not offered as an alternative." }); continue; }
    if (missing.includes(c.name)) {
      cropRejections.push({ crop: c.name, code: "no_window", detail: settings.calendarRegion ? `No planting window: not in your records, not in your windows, and not in the ${settings.calendarRegion} calendar.` : "No planting window: add your usual planting dates for this crop, or record past seasons with dates." });
      questions.push(`When do you usually plant ${c.name}, and how many days until harvest?`);
      continue;
    }
    candidateSlots.push(...allSlots.filter((s) => s.key.startsWith(`${c.key}:`)));
  }

  // Baseline from the last N years of whole-field history.
  let baseline: Strategy | null = null;
  const baselineMsgs: string[] = [];
  const recYears = [...new Set(wholeHistory.map((h) => h.season_year))].sort((a, b) => a - b);
  if (!recYears.length) {
    baselineMsgs.push("Existing practice is unknown: no whole-field crop history is recorded. Add the crops you grew in recent years (with planting and harvest dates if you can) to compare against them.");
  } else {
    const last = recYears.at(-1)!;
    const first = last - rotationYears + 1;
    const span = Array.from({ length: rotationYears }, (_, i) => first + i);
    const missingYears = span.filter((y) => !wholeHistory.some((h) => h.season_year === y));
    if (missingYears.length) baselineMsgs.push(`Existing practice is incomplete: no crop is recorded for ${missingYears.join(", ")}. Record those seasons (or "fallow") to compare.`);
    else {
      const plantings: Planting[] = [];
      const gapsHere: string[] = [];
      for (const h of wholeHistory.filter((x) => x.season_year >= first && x.season_year <= last)) {
        if (isFallowName(h.crop_name)) continue;
        const crop = resolveCrop(h.crop_name, catalog);
        const name = crop ? crop.label : h.crop_name.trim();
        if (h.planted_on && h.harvested_on) {
          const pd = dayIndex(h.planted_on);
          const len = dayIndex(h.harvested_on) - pd;
          const md = isoDate(pd).slice(5) === "02-29" ? "02-28" : isoDate(pd).slice(5);
          const off = mdOffset(md);
          plantings.push({ slot: { key: `base:${h.id}`, crop, cropName: name, source: "history_record", sourceDetail: `Your record ${h.planted_on} to ${h.harvested_on}`, preferred: off, windowStart: off, windowSpan: 0, length: len }, cycleYear: yearOf(pd) - first });
        } else {
          const key = crop ? crop.id : `x_${norm(h.crop_name).replace(/[^a-z0-9]+/g, "_")}`;
          const s = allSlots.find((x) => x.key.startsWith(`${key}:`) && (x.source !== "history" || x.key.endsWith(`:h:${h.season}`))) ?? allSlots.find((x) => x.key.startsWith(`${key}:`));
          if (!s) gapsHere.push(`${h.season_year} ${h.crop_name}`);
          else plantings.push({ slot: s, cycleYear: h.season_year - first });
        }
      }
      if (gapsHere.length) baselineMsgs.push(`Existing practice could not be scheduled: no dates for ${gapsHere.join(", ")}. Add planting and harvest dates to those records.`);
      else {
        const sch = schedule(plantings, rotationYears, 0, false);
        const violations: { code: RejectionCode; detail: string }[] = [];
        const placed = sch.ok ? sch.plantings : [...plantings].map((p) => ({ ...p, start: abs(p.cycleYear, p.slot.preferred), end: abs(p.cycleYear, p.slot.preferred) + p.slot.length }));
        if (!sch.ok) violations.push({ code: sch.failure.code, detail: `As recorded: ${sch.failure.detail}` });
        for (const p of placed) {
          const c = { name: p.slot.cropName, crop: p.slot.crop };
          if (isExcluded(c)) violations.push({ code: "excluded", detail: `${p.slot.cropName} is now on your excluded list.` });
          if (noMarket(c)) violations.push({ code: "no_market_access", detail: `${p.slot.cropName} has no market access recorded.` });
        }
        baseline = { id: "baseline", kind: "baseline", plantings: placed, cycleYears: rotationYears, violations };
      }
    }
  }
  gaps.push(...baselineMsgs);

  // Enumerate alternatives.
  const patterns = yearPatterns(candidateSlots, turnaround, LIMITS.maxPerYear);
  const rejectionCounts: Partial<Record<RejectionCode, number>> = {};
  const rejectedExamples: { label: string; code: RejectionCode; detail: string }[] = [];
  const feasible: Strategy[] = [];
  const seen = new Set<string>();
  let examined = 0;
  const total = patterns.length ** rotationYears;
  const bounded = total > LIMITS.exhaustiveSequences;
  const reject = (label: string, code: RejectionCode, detail: string) => {
    rejectionCounts[code] = (rejectionCounts[code] ?? 0) + 1;
    if (rejectedExamples.filter((e) => e.code === code).length < 3) rejectedExamples.push({ label, code, detail });
  };
  const consider = (sel: Slot[][]) => {
    if (sel.every((y) => y.length === 0)) return;
    // Show the cycle starting from a year with a planting (rotations of a cycle are the same rotation).
    const first = sel.findIndex((y) => y.length > 0);
    const yearsSel = [...sel.slice(first), ...sel.slice(0, first)];
    const k = cycleKey(yearsSel);
    if (seen.has(k)) return;
    seen.add(k);
    examined++;
    const plantings: Planting[] = yearsSel.flatMap((y, i) => y.map((slot) => ({ slot, cycleYear: i })));
    const sch = schedule(plantings, rotationYears, turnaround, true);
    const label = labelOf(plantings.map((p) => ({ ...p, start: 0, end: 0 })), rotationYears);
    if (!sch.ok) return reject(label, sch.failure.code, sch.failure.detail);
    // Canola: at most once in any three consecutive years of the repeating cycle.
    const canola = yearsSel.map((y) => y.some((s) => s.crop?.id === "rapeseed"));
    for (let i = 0; i < rotationYears; i++)
      if ([0, 1, 2].filter((d) => canola[(i + d) % rotationYears]).length > 1)
        return reject(label, "return_interval", "Rapeseed/canola more than once in three years (Canola Council of Canada).");
    if (!fallowAllowed && longestGap(sch.plantings, rotationYears).days >= 365) return reject(label, "fallow_year", "A whole year without any crop; add \"fallow\" to the candidate crops if you want to consider fallow years.");
    const s: Strategy = { id: `alt-${k}`, kind: "alternative", plantings: sch.plantings, cycleYears: rotationYears, violations: [] };
    if (allocation != null) {
      const need = irrigationPerCycleYear(ctx, s);
      if (need && need.some((v) => v > allocation)) return reject(label, "water_allocation", `Median-year irrigation need (${Math.round(Math.max(...need))} mm) exceeds your allocation (${allocation} mm).`);
    }
    feasible.push(s);
  };
  const quickScore = (yearsSel: Slot[][]) => {
    // Fixed-scale proxy for the bounded search only: diversity and cover, weighted by priorities.
    const flat = yearsSel.flat();
    const crops = new Set(flat.map((s) => s.crop?.id)).size;
    const fams = new Set(flat.map((s) => s.crop?.family)).size;
    const days = flat.reduce((a, s) => a + s.length, 0) / (365 * yearsSel.length);
    return priorities.diversification * (crops + fams) / 6 + priorities.soil_health * Math.min(1, days) - priorities.workload * flat.length / (3 * yearsSel.length);
  };
  if (!bounded) {
    const rec = (prefix: Slot[][]) => {
      if (prefix.length === rotationYears) return consider(prefix);
      for (const p of patterns) rec([...prefix, p]);
    };
    if (patterns.length) rec([]);
  } else {
    // Partial sequences that already overlap (non-cyclic check) cannot become feasible and are dropped.
    let beam: Slot[][][] = [[]];
    for (let d = 0; d < rotationYears; d++) {
      const next: Slot[][][] = [];
      for (const b of beam)
        for (const p of patterns) {
          const cand = [...b, p];
          const pl = cand.flatMap((y, i) => y.map((slot) => ({ slot, cycleYear: i })));
          if (pl.length && !schedule(pl, d + 1, turnaround, false).ok) continue;
          next.push(cand);
        }
      next.sort((a, b) => quickScore(b) - quickScore(a) || cycleKey(a).localeCompare(cycleKey(b)));
      beam = next.slice(0, LIMITS.beamWidth);
    }
    for (const b of beam) consider(b);
  }
  if (bounded) messages.push(`The search was bounded: ${total.toLocaleString("en-US")} combinations exceed ${LIMITS.exhaustiveSequences.toLocaleString("en-US")}, so a beam search kept the ${LIMITS.beamWidth.toLocaleString("en-US")} most promising per year. Some feasible sequences were not examined.`);

  // ------------------------------------------------------------ one run ---
  const runOnce = (kind: RunView["kind"], w: DailyWeather | null, ts: Transformation[]): RunView => {
    ctx.weather = w;
    ctx.et0 = w ? et0Series(w, latitude) : null;
    ctx.cache = new Map();
    ctx.chainCache = new Map();
    setAnnual(w);
    const runMsgs: string[] = [];
    const inds = indicatorSet(ctx);
    const raws = new Map<string, Raw>();
    const all = [...(baseline ? [baseline] : []), ...feasible];
    for (const s of all) raws.set(s.id, evaluate(ctx, s, "base", market));
    // Choose alternatives by the farmer's priorities, ranked among all feasible options (+ baseline).
    const ranked = all.length ? score(inds, all.map((s) => s.id), raws, priorities).ranking : [];
    const chosen: Strategy[] = [];
    const cropSet = (s: Strategy) => [...new Set(s.plantings.map((p) => p.slot.crop?.id ?? p.slot.cropName))].sort().join(",");
    const taken = new Set<string>(baseline ? [cropSet(baseline)] : []);
    for (const id of ranked) {
      if (chosen.length >= LIMITS.maxAlternatives) break;
      const s = feasible.find((x) => x.id === id);
      if (!s) continue;
      // A multi-year alternative must be a rotation: at least two different crops.
      if (rotationYears >= 2 && new Set(s.plantings.map((p) => p.slot.crop?.id ?? p.slot.cropName)).size < 2) continue;
      const cs = cropSet(s);
      if (taken.has(cs)) continue;
      taken.add(cs);
      chosen.push({ ...s, id: `alternative-${chosen.length + 1}` });
    }
    if (chosen.length < 2) runMsgs.push(chosen.length === 0 ? "No feasible alternative was found. The rejections below show which constraints removed the options; adding crops, planting windows or a calendar region may help." : "Only one agronomically distinct feasible alternative was found (the target is at least two). The rejections below show which constraints removed the others.");
    const compared = [...(baseline ? [baseline] : []), ...chosen];
    for (const s of chosen) raws.set(s.id, evaluate(ctx, s, "base", market));

    const view = (s: Strategy, caseRaw: Raw): StrategyView => {
      const plantings = plantingViews(s);
      const crops = s.plantings.length;
      const withParams = s.plantings.filter((p) => p.slot.crop?.fao56).length;
      const withStages = s.plantings.filter((p) => p.slot.crop && stagesFor(p.slot.crop, p.slot.length)).length;
      const indicators: Record<string, IndicatorValue> = {};
      for (const ind of inds) {
        const v = ind.get(caseRaw);
        indicators[ind.key] = { value: v == null ? null : roundIndicator(ind.unit, v), unit: ind.unit, detail: ind.label };
      }
      indicators.longest_bare_window = { value: caseRaw.gapDays, unit: "days", detail: `Longest scheduled bare window, starting ${isoMonth(monthDayIn(2001, offsetMd(caseRaw.gapStart % 365)))}` };
      const fill = bareWindowFillers({ days: Math.min(caseRaw.gapDays, 365), start: caseRaw.gapStart % 365 }, fillSlots, turnaround, new Set(s.plantings.map((p) => p.slot.crop?.id).filter((x): x is string => !!x)));
      return {
        id: s.id, kind: s.kind, label: labelOf(s.plantings, s.cycleYears), plantings, violations: s.violations, indicators,
        ...(fill.length ? { bareFill: { gapStart: offsetMd(caseRaw.gapStart % 365), gapDays: caseRaw.gapDays, crops: fill } } : {}),
        completeness: [
          { item: "Crops in the catalogue", have: s.plantings.filter((p) => p.slot.crop).length, of: crops },
          { item: "FAO-56 crop coefficients", have: withParams, of: crops },
          { item: "FAO-56 stage lengths", have: withStages, of: crops },
          { item: "Soil water capacity", have: awcMmPerM != null ? 1 : 0, of: 1, note: soilSource },
          { item: "Replay years with complete weather for these crops", have: caseRaw.waterYears || caseRaw.tempYears, of: years.length },
        ],
      };
    };

    let comparison: Comparison | null = null;
    if (compared.length) {
      const ids = compared.map((s) => s.id);
      const baseScore = score(inds, ids, raws, priorities);
      const cases: Comparison["cases"] = [];
      const changedBy: CaseId[] = [];
      for (const c of ["dry_start", "kc_low", "kc_high", "driest_third", "wettest_third"] as CaseId[]) {
        if ((c === "dry_start" && awcMmPerM == null) || ((c === "kc_low" || c === "kc_high") && !compared.some((s) => s.plantings.some((p) => p.slot.crop?.fao56 && (typeof p.slot.crop.fao56.kcMid !== "number" || typeof p.slot.crop.fao56.kcEnd !== "number"))))) continue;
        if ((c === "driest_third" || c === "wettest_third") && ctx.annualPrecip.size < 3) continue;
        const cr = new Map<string, Raw>();
        for (const s of compared) cr.set(s.id, evaluate(ctx, s, c, market));
        const sc = score(inds, ids, cr, priorities);
        cases.push({ id: c, label: CASE_LABELS[c], ranking: sc.ranking, top: sc.ranking[0] ?? null });
        if (sc.ranking[0] !== baseScore.ranking[0]) changedBy.push(c);
      }
      const ablation = baseScore.groupsUsed.filter((g) => priorities[g] > 0).map((g) => {
        const sc = score(inds, ids, raws, { ...priorities, [g]: 0 });
        return { priority: g, ranking: sc.ranking, topChanged: sc.ranking[0] !== baseScore.ranking[0] };
      });
      const tradeoffs: Record<string, string[]> = {};
      if (baseline) {
        const table = tableOf(inds, ids, raws);
        for (const s of chosen) {
          const lines: string[] = [];
          for (const ind of baseScore.used) {
            const vb = table.baseline![ind.key] ?? null;
            const va = table[s.id]![ind.key] ?? null;
            if (vb == null || va == null || Math.abs(va - vb) < 1e-9) continue;
            const better = ind.better === "high" ? va > vb : va < vb;
            const fmt = (v: number) => (ind.unit === "ratio" || ind.unit === "share" ? v.toFixed(3) : r1(v).toString());
            if (fmt(va) === fmt(vb)) continue;
            lines.push(`${better ? "Better" : "Worse"}: ${ind.label} ${fmt(vb)} → ${fmt(va)} ${ind.unit}`);
          }
          tradeoffs[s.id] = lines;
        }
      }
      comparison = {
        scores: baseScore.scores, ranking: baseScore.ranking, contributions: baseScore.contributions, groupsUsed: baseScore.groupsUsed,
        indicatorsUsed: baseScore.used.map((i) => i.key), indicatorsDropped: baseScore.dropped, cases,
        stability: compared.length < 2 ? "single_option" : changedBy.length ? "fragile" : "stable", changedBy, ablation, tradeoffs,
      };
    }
    const tl = buildTimeline(ctx, compared, kind, rotationYears);
    return {
      kind, transformations: ts, indicatorDefinitions: definitions(inds), timeline: tl.timeline, timelineNote: tl.note,
      baseline: baseline ? view(baseline, raws.get("baseline")!) : null,
      alternatives: chosen.map((s) => view(s, raws.get(s.id)!)),
      comparison, messages: runMsgs,
    };
  };

  const runs: RunView[] = [runOnce("historical_replay", historical, [])];
  if (transformations.length) {
    if (historical) runs.push(runOnce("scenario", applyTransformations(historical, transformations), transformations));
    else gaps.push("Weather transformations were set, but there is no weather series to transform.");
  }

  if (rainChoice) {
    const lon = inputs.field.centroid!.coordinates[0];
    assumptions.push(
      rainChoice.source !== "nasa-power-daily"
        ? `Rain: NASA GPM IMERG ${rainChoice.source === "gpm-imerg-final" ? "Final Run V07 (merged multi-satellite estimate calibrated to monthly rain-gauge analyses)" : `Late Run V07 (merged multi-satellite estimate with climatological, not rain-gauge, calibration; in single years it can differ from the gauge-calibrated Final Run by a third${rainChoice.note ? `. The Final Run was not used: ${rainChoice.note}` : ""})`} for the field's 0.1° cell (about 11 km), present on every day of ${settings.replayFromYear}–${settings.replayToYear}. Temperature, humidity, wind and radiation: NASA POWER (½° × ⅝° cell). IMERG days run midnight to midnight UTC and POWER days in local solar time, about ${Math.round(Math.abs(lon) / 15)} h apart at this longitude.`
        : `Rain: NASA POWER daily precipitation (MERRA-2 bias-corrected reanalysis, ½° × ⅝° cell)${input.rain ? "" : "; NASA IMERG satellite rain was not stored for this field when the snapshot was taken"}.`,
    );
  }
  assumptions.push(
    historical && et0Method(historical) === "penman_monteith"
      ? `ET0 by FAO-56 Penman-Monteith (Eq. 6) from NASA POWER daily Tmax, Tmin, dew point, 2 m wind and all-sky shortwave radiation, site elevation ${Math.round(historical.pm!.elevationM)} m (POWER cell); G = 0. Days missing any input are missing, never filled.`
      : "ET0 from temperature only (FAO-56 Eq. 52, Hargreaves), not calibrated locally: this weather retrieval has no humidity, wind or radiation series. Refresh the field's weather to use Penman-Monteith.",
    historical?.pm
      ? "Kc mid and Kc end adjusted for climate by FAO-56 Eq. 62 and Eq. 65 with each planting's stage-mean POWER wind (u2) and RHmin (from dew point and Tmax), kept within FAO-56 limits (u2 1–6 m/s, RHmin 20–80 %), and the Table 12 crop height (midpoint of a printed range); Kc end below 0.45 is not adjusted; crops without a printed height (winter wheat on non-frozen soil) keep the table values."
      : "Kc from FAO-56 Table 12 without climate adjustment (RHmin ≈ 45%, u2 ≈ 2 m/s assumed): this weather retrieval has no wind or humidity series.",
    ctx.hsg
      ? `Runoff by the NRCS curve-number method (NEH 630 Table 9-1, good condition, straight rows; bare fallow between crops) for hydrologic soil group ${ctx.hsg}, average antecedent moisture; no capillary rise; water above field capacity drains the same day.`
      : "No surface runoff (hydrologic soil group not given) and no capillary rise; water above field capacity drains the same day.",
    awcMmPerM != null
      ? `Soil water carries over from crop to crop through fallow periods (continuous daily balance). Bare-soil evaporation by FAO-56 Ch. 7 with Kc,max 1.20 and TEW/REW from Table 19 for the ${evaporationParams(awcMmPerM).soilClass} implied by the soil's water capacity. Each chain of cycles starts at field capacity (a dry-start case is shown as sensitivity); with three or more cycles in a chain the first is spin-up only.`
      : "Soil water capacity is unknown, so no carry-over between crops is modelled.",
    "Roots grow from 0.15 m at planting to the FAO-56 Table 22 upper depth by the end of development.",
    ...([...(baseline ? [baseline] : []), ...feasible].some((st) => st.plantings.some((pl) => pl.slot.crop?.fao56?.waterBalance === "paddy"))
      ? [irrigation === "full"
          ? "Flooded (paddy) rice: irrigation need by FAO Irrigation Water Management Training Manual No. 3 §4.4 — ETc (FAO-56 rice Kc) + 200 mm land soaking in the 30 days before planting + percolation and seepage 6 mm/day (the manual's average; heavy clay 4, sandy soil 8) + 100 mm water layer at transplanting − effective rain (0.8P − 25 above 75 mm/month, else 0.6P − 10), per calendar month. No water stress under ponding; the next crop starts at field capacity after draining. Nursery water is not included."
          : "Rainfed rice: potential water use only (the paddy procedure needs irrigation)."]
      : []),
    "Stage proportions from the FAO-56 Table 11 example closest in total length, scaled to the local season length.",
    "Whole field; frost and hot days use coarse-cell air temperature (exposure, not crop damage).",
  );
  if (!inputs.priorities) assumptions.push("Priorities not recorded: all six weighted equally (3).");
  if (!ctx.hsg) { gaps.push("Runoff is not modelled because the field's hydrologic soil group was not chosen; rain is fully counted, which overstates water on slopes and in heavy storms."); questions.push("Does water soak in quickly (sandy), moderately, slowly, or very slowly (heavy clay) on this field? Choose the soil group in the comparison settings to model runoff."); }
  questions.push("Do you have the equipment and labour to plant and harvest each crop shown?", "Is there a market for each alternative crop near you?", "Do these planting dates match what is practical on this field?");
  if (cropKeys.some((c) => c.crop?.id === "spring_wheat")) questions.push("Is your wheat a winter (vernalising) type? If so, record it as \"winter wheat\".");

  const slotsView = allSlots.map((s) => ({ crop: s.cropName, source: s.source, detail: s.sourceDetail, plant: offsetMd(s.preferred), days: s.length }));
  return {
    ...base,
    evidence: { ...base.evidence, rainSource: rainChoice?.source ?? null, rainRetrievalId: rainChoice?.retrievalId ?? null },
    status: "ok",
    messages,
    period,
    irrigationMode: irrigation,
    soil: { awcMmPerM: awcMmPerM == null ? null : r1(awcMmPerM), source: soilSource },
    search: { cropsConsidered: cropKeys.map((c) => c.name), cropRejections, slots: slotsView, sequencesExamined: examined, feasible: feasible.length, bounded, rejectionCounts, rejectedExamples },
    runs,
    assumptions,
    gaps: [...new Set(gaps)],
    reviewQuestions: [...new Set(questions)],
  };
}

