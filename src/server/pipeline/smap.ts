import { round } from "@/domain/evidence/aggregate";
import { PROCESSING_VERSION } from "@/domain/evidence/catalog";
import { check, type Check } from "@/server/providers/http";
import { ease2Cell, fetchSmapDay, listSmapGranules, recommended, type SmapDay } from "@/server/providers/smap";

import { cacheKey, combinedSha } from "./cache";
import { lastCompleteMonthEnd } from "./power";
import { PipelineError, type FieldContext, type PipelineOutput, type Progress } from "./types";

/** Years of daily files read on a fetch (one request per day; ≈ 4–6 minutes for two years). */
export const SMAP_YEARS = 2;
const PARALLEL = 8;

export type SmapMonth = { month: string; days: number; recommendedDays: number; anyDays: number; recommendedMean: number | null; anyMean: number | null };

/**
 * Monthly means of daily SMAP surface soil moisture. A day's value is the mean of its AM and PM
 * retrievals; "recommended" uses only retrievals whose quality flag bit 0 is 0, "any" uses every
 * valid retrieval. Missing days stay missing (no interpolation).
 */
export function smapMonthly(days: SmapDay[]): SmapMonth[] {
  const by = new Map<string, SmapDay[]>();
  for (const d of days) by.set(d.date.slice(0, 7), [...(by.get(d.date.slice(0, 7)) ?? []), d]);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, ds]) => {
    const rec = ds.map((d) => mean([...(recommended(d.amQual) && d.am != null ? [d.am] : []), ...(recommended(d.pmQual) && d.pm != null ? [d.pm] : [])])).filter((v): v is number => v != null);
    const any = ds.map((d) => mean([...(d.am != null ? [d.am] : []), ...(d.pm != null ? [d.pm] : [])])).filter((v): v is number => v != null);
    const [y, m] = month.split("-").map(Number) as [number, number];
    const r = mean(rec), a = mean(any);
    return { month, days: new Date(Date.UTC(y, m, 0)).getUTCDate(), recommendedDays: rec.length, anyDays: any.length, recommendedMean: r == null ? null : round(r, 3), anyMean: a == null ? null : round(a, 3) };
  });
}

/**
 * NASA SMAP L3 Enhanced (SPL3SMP_E v006) surface soil moisture for the 9 km EASE-Grid 2.0 cell
 * containing the field, last two years, as monthly evidence (optional source; never used by the
 * engine). Needs the Earthdata token, given by the worker.
 */
export async function runSmap(ctx: FieldContext, progress: Progress, now = new Date()): Promise<PipelineOutput> {
  if (!ctx.earthdataToken) throw new PipelineError("SMAP needs a NASA Earthdata token on the worker (NASA_EARTHDATA_TOKEN).", "unavailable");
  const end = lastCompleteMonthEnd(now);
  const start = `${Number(end.slice(0, 4)) - SMAP_YEARS}-${String(Number(end.slice(5, 7)) % 12 + 1).padStart(2, "0")}-01`;
  const cell = ease2Cell(ctx.centroid.lat, ctx.centroid.lon);
  await progress({ step: "Listing SMAP daily files (NASA CMR)", done: 0, total: 1 });
  const list = await listSmapGranules(start, end);
  if (!list.ok) throw new PipelineError(`NASA CMR did not answer: ${list.error}`, "unavailable");
  if (!list.granules.length) throw new PipelineError(`No SMAP files listed for ${start} to ${end}.`, "unavailable");
  const days: SmapDay[] = [];
  const shas: string[] = [];
  let bytes = 0, failed = 0, done = 0;
  const queue = [...list.granules];
  let lastError = "";
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      for (let g = queue.shift(); g; g = queue.shift()) {
        const r = await fetchSmapDay(g, cell, ctx.earthdataToken!);
        if (r.ok) { days.push(r.day); shas.push(r.sha256); bytes += r.bytes; }
        else { failed++; lastError = r.error; if (/rejected the token/.test(r.error)) queue.length = 0; }
        if (++done % 20 === 0) await progress({ step: "Reading SMAP daily files", done, total: list.granules.length });
      }
    }),
  );
  if (/rejected the token/.test(lastError)) throw new PipelineError("NASA Earthdata rejected the token (expired or not approved for NSIDC data).", "unavailable");
  if (!days.length) throw new PipelineError(`SMAP files could not be read: ${lastError}`, "unavailable");
  days.sort((a, b) => a.date.localeCompare(b.date));
  const months = smapMonthly(days);
  const observed = days.filter((d) => d.am != null || d.pm != null);
  const rec = days.filter((d) => (recommended(d.amQual) && d.am != null) || (recommended(d.pmQual) && d.pm != null));
  // Surface flags of the passes that produced a retrieval only (a pass without data carries 2047, every bit).
  const flagged = (bit: number) => observed.filter((d) => ((d.am != null ? d.amSurface ?? 0 : 0) | (d.pm != null ? d.pmSurface ?? 0 : 0)) & bit).length;
  const checks: Check[] = [
    check("files-read", failed <= list.granules.length * 0.05, `${days.length}/${list.granules.length} daily files read, ${failed} failed`),
    check("has-retrievals", observed.length > 0, `${observed.length} days with a retrieval, ${rec.length} recommended`),
    check("range", observed.every((d) => [d.am, d.pm].every((v) => v == null || (v >= 0.02 && v <= 0.5))), "values within 0.02–0.5 m³/m³"),
  ];
  return {
    retrieval: {
      sourceId: "smap-l3-enhanced",
      productId: "SPL3SMP_E",
      productVersion: "006",
      evidenceClass: "satellite_observation",
      spatialSupport: `One 9 km EASE-Grid 2.0 cell (row ${cell.row}, column ${cell.col}); value describes the whole cell`,
      request: { endpoint: "Earthdata Cloud OPeNDAP (DAP4 CSV), one cell per daily file", collection: "C2938664763-NSIDC_CPRD", cell, start, end, files: list.granules.length },
      retrievedAt: now.toISOString(),
      responseSha256: combinedSha(shas.sort()),
      responseBytes: bytes,
      outcome: checks.every((c) => c.passed) ? "valid" : "partial",
      checks,
      provenance: {
        evidenceClass: "satellite_observation",
        source: "NASA SMAP L3 Radiometer Global Daily 9 km EASE-Grid Soil Moisture, Enhanced, V006 (NSIDC DAAC); O'Neill, P. E. et al. (2023), doi:10.5067/M20OXIZHY3RJ",
        depth: "about 0–5 cm",
        passes: "AM descending (≈ 6 a.m.), PM ascending (≈ 6 p.m.); day value = mean of the day's retrievals",
        quality: "recommended = retrieval_qual_flag bit 0 is 0",
        days: days.length,
        observedDays: observed.length,
        recommendedDays: rec.length,
        surfaceFlags: { urban: flagged(8), precipitation: flagged(16), frozenRadiometer: flagged(128), staticWater: flagged(1) },
      },
      cacheKey: cacheKey({ source: "smap-l3-enhanced", row: cell.row, col: cell.col, start, end, processing: PROCESSING_VERSION }),
      processingVersion: PROCESSING_VERSION,
      observationStart: days[0]!.date,
      observationEnd: days.at(-1)!.date,
    },
    aggregates: months.flatMap((m) => [
      { variable: "smap_sm", unit: "m³/m³", aggregation: "mean" as const, periodStart: `${m.month}-01`, periodEnd: `${m.month}-${String(m.days).padStart(2, "0")}`, value: m.recommendedMean, validCount: m.recommendedDays, expectedCount: m.days, pixel: "" },
      { variable: "smap_sm_any", unit: "m³/m³", aggregation: "mean" as const, periodStart: `${m.month}-01`, periodEnd: `${m.month}-${String(m.days).padStart(2, "0")}`, value: m.anyMean, validCount: m.anyDays, expectedCount: m.days, pixel: "" },
    ]),
  };
}
