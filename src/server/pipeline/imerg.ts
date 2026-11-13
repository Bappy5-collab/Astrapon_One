import { monthly } from "@/domain/evidence/aggregate";
import { PROCESSING_VERSION } from "@/domain/evidence/catalog";
import { check, type Check } from "@/server/providers/http";
import { fetchImergSeries, IMERG_RUNS, IMERG_START, IMERG_VERSION, imergCell, imergRecordEnd, parseImergCsv, type ImergCell, type ImergRun, type ImergSeries } from "@/server/providers/imerg";

import { cacheKey, chunkMaxAge, combinedSha, readChunk, writeChunk } from "./cache";
import { lastCompleteMonthEnd } from "./power";
import { PipelineError, type AggregateRow, type DailySeriesRow, type FieldContext, type PipelineOutput, type Progress } from "./types";

const VARIABLE: Record<ImergRun, "IMERG_FINAL_PRECIP" | "IMERG_LATE_PRECIP"> = { final: "IMERG_FINAL_PRECIP", late: "IMERG_LATE_PRECIP" };

type RunOut = { run: ImergRun; series: ImergSeries; sha: string; bytes: number; retrievedAt: string; jobId: string | null; url: string | null };

async function one(run: ImergRun, cell: ImergCell, end: string, token: string, now: Date, progress: Progress): Promise<RunOut> {
  const key = cacheKey({ product: `${IMERG_RUNS[run].shortName}.${IMERG_VERSION}/harmony/area-average`, location: cell.key, start: IMERG_START, end, variable: IMERG_RUNS[run].variable });
  let chunk = await readChunk(key, chunkMaxAge(end, now));
  let jobId: string | null = null, url: string | null = null;
  if (!chunk) {
    const r = await fetchImergSeries(run, cell, IMERG_START, end, token, { onWait: (s) => progress({ step: `Waiting for NASA Harmony (${run === "final" ? "Final" : "Late"} Run, ${s} s)`, done: 0, total: 2 }) });
    if (!r.ok) throw new PipelineError(`IMERG ${run === "final" ? "Final" : "Late"} Run: ${r.error}`, "unavailable");
    await writeChunk(key, r.retrieval, r.csv);
    chunk = { key, retrieval: r.retrieval, body: r.csv, cachedAt: new Date().toISOString() };
    jobId = r.jobId;
    url = r.submitUrl;
  }
  const series = parseImergCsv(chunk.body, run, IMERG_START, end, cell);
  const shape = series.checks.filter((c) => !c.id.endsWith(":values"));
  if (shape.some((c) => !c.passed)) throw new PipelineError(`NASA IMERG ${run} answer failed validation: ${shape.filter((c) => !c.passed).map((c) => `${c.id} (${c.detail})`).join("; ")}`, "invalid");
  if (!series.values.some((v) => v != null)) throw new PipelineError(`NASA IMERG ${run} returned no rain values for this cell.`, "invalid");
  return { run, series, sha: chunk.retrieval.bodySha256, bytes: chunk.retrieval.bodyBytes, retrievedAt: chunk.retrieval.retrievedAt, jobId, url };
}

/**
 * NASA GPM IMERG V07 daily rain for the 0.1° cell containing the field, both runs, from the start
 * of the record (1998-01-01): the gauge-calibrated Final Run to its last day (2025-09-30 for V07)
 * and the Late Run to the end of the last complete month. Each run is stored as its own daily
 * series beside the POWER series; the engine uses one of them for a whole run only when it covers
 * the whole replay window (Final first), and never mixes products. Needs the Earthdata token.
 */
export async function runImerg(ctx: FieldContext, progress: Progress, now = new Date()): Promise<PipelineOutput> {
  if (!ctx.earthdataToken) throw new PipelineError("NASA IMERG rain needs a NASA Earthdata token on the worker (NASA_EARTHDATA_TOKEN).", "unavailable");
  const cell = imergCell(ctx.centroid.lat, ctx.centroid.lon);
  const lateEnd = lastCompleteMonthEnd(now);
  await progress({ step: "Asking NASA for the IMERG record (Final and Late Run)", done: 0, total: 2 });
  const fe = await imergRecordEnd("final");
  const finalEnd = fe.ok ? (fe.end < lateEnd ? fe.end : lateEnd) : null;

  // Both runs at once (two Harmony jobs). The Late Run is required; the Final Run is best effort.
  const [late, final] = await Promise.all([
    one("late", cell, lateEnd, ctx.earthdataToken, now, progress),
    finalEnd ? one("final", cell, finalEnd, ctx.earthdataToken, now, progress).catch((e: unknown) => e as Error) : Promise.resolve(new Error(`CMR did not give the Final Run's last day: ${fe.ok ? "" : fe.error}`)),
  ]);
  await progress({ step: "Aggregating", done: 2, total: 2 });
  const runs: RunOut[] = [late, ...(final instanceof Error ? [] : [final])];

  const valid = (s: ImergSeries) => s.values.filter((v) => v != null).length;
  const checks: Check[] = [
    ...runs.flatMap((r) => r.series.checks),
    ...runs.map((r) => check(`${r.run}:coverage`, valid(r.series) >= r.series.values.length * 0.99, `${valid(r.series)} of ${r.series.values.length} days have a value`)),
    check("final:available", !(final instanceof Error), final instanceof Error ? final.message.slice(0, 300) : `Final Run to ${finalEnd}`),
  ];
  // Monthly totals of complete months, per run (evidence page: last 12 months from the Late Run).
  const aggregates: AggregateRow[] = runs.flatMap((r) =>
    monthly({ variable: r.run === "late" ? "imerg_precip" : "imerg_final_precip", unit: "mm/day", dates: r.series.dates, values: r.series.values }, "sum", 1).map((m) => ({ ...m, unit: "mm", pixel: "" })),
  );
  const daily: DailySeriesRow[] = runs.map((r) => ({ variable: VARIABLE[r.run], unit: "mm/day", startDate: r.series.dates[0]!, values: r.series.values }));
  const fetched = runs.map((r) => r.retrievedAt).sort();

  return {
    retrieval: {
      sourceId: "gpm-imerg-daily",
      productId: runs.map((r) => IMERG_RUNS[r.run].shortName).join("+"),
      productVersion: IMERG_VERSION,
      evidenceClass: "satellite_observation",
      spatialSupport: `One 0.1° IMERG grid cell (${cell.key}, centre ${cell.centre.lat}, ${cell.centre.lon}); value describes the whole cell`,
      request: {
        endpoint: "NASA Earthdata Harmony → Giovanni area-average time series (CSV), one job per run",
        cell: cell.key,
        box: cell.box,
        runs: runs.map((r) => ({ run: r.run, collection: IMERG_RUNS[r.run].collection, variable: IMERG_RUNS[r.run].variable, start: r.series.start, end: r.series.end, ...(r.jobId ? { jobId: r.jobId } : {}), ...(r.url ? { url: r.url } : {}) })),
      },
      retrievedAt: fetched[0]!,
      responseSha256: combinedSha(runs.map((r) => r.sha)),
      responseBytes: runs.reduce((a, r) => a + r.bytes, 0),
      outcome: checks.every((c) => c.passed) ? "valid" : "partial",
      checks,
      provenance: {
        evidenceClass: "satellite_observation",
        source: "NASA GPM IMERG L3 1 day 0.1° × 0.1° V07 (GES DISC): Final Run (GPM_3IMERGDF, doi:10.5067/GPM/IMERGDF/DAY/07) and Late Run (GPM_3IMERGDL, doi:10.5067/GPM/IMERGDL/DAY/07); Huffman, G.J. et al.",
        algorithm: "Merged multi-satellite estimate (passive microwave + infrared, morphed between overpasses). Final Run: calibrated to monthly rain-gauge analyses. Late Run: climatological calibration only.",
        units: "mm/day (daily total)",
        dayBoundary: "UTC days",
        cell: { key: cell.key, centre: cell.centre, box: cell.box },
        runs: runs.map((r) => ({ run: r.run, variable: VARIABLE[r.run], start: r.series.start, end: r.series.end, days: r.series.values.length, daysWithValue: valid(r.series), responseSha256: r.sha, fetchedAt: r.retrievedAt })),
      },
      cacheKey: cacheKey({ source: "gpm-imerg-daily", location: cell.key, start: IMERG_START, lateEnd, finalEnd: finalEnd ?? "none", processing: PROCESSING_VERSION }),
      processingVersion: PROCESSING_VERSION,
      observationStart: IMERG_START,
      observationEnd: late.series.end,
    },
    aggregates,
    daily,
  };
}
