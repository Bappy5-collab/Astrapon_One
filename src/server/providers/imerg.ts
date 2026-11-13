import { check, fetchText, type Check, type Retrieval } from "./http";

/**
 * NASA GPM IMERG daily precipitation, V07, for the one 0.1° grid cell that contains a field, as a
 * daily time series. Two runs of the same algorithm are read and kept apart:
 *  - Final Run (GPM_3IMERGDF, CMR C2723754864-GES_DISC): calibrated to monthly rain-gauge analyses;
 *    the V07 record stops on 2025-09-30 while NASA moves to V08.
 *  - Late Run (GPM_3IMERGDL, CMR C2723754859-GES_DISC): climatological calibration only; current.
 *
 * Route: NASA Earthdata Harmony with the Giovanni area-average time-series service. One request per
 * run returns every day of the record for the cell as CSV, so no daily files are downloaded. The
 * request box sits inside a single IMERG cell, so the "area average" is that cell's value (checked
 * against an OPeNDAP read of the same cell by `pnpm verify:sources imerg`). Units mm/day (daily file
 * "precipitation": daily mean rate of the combined microwave-IR estimate, formerly precipitationCal);
 * IMERG days are UTC days. Fill −9999.9 → null, never 0. Requires a NASA Earthdata bearer token
 * (passed in; never logged) whose account has authorised the NASA GESDISC DATA ARCHIVE application.
 * Verified 2026-11-13.
 */
export type ImergRun = "final" | "late";
export const IMERG_RUNS: Record<ImergRun, { collection: string; shortName: string; variable: string; doi: string }> = {
  final: { collection: "C2723754864-GES_DISC", shortName: "GPM_3IMERGDF", variable: "GPM_3IMERGDF_07_precipitation", doi: "10.5067/GPM/IMERGDF/DAY/07" },
  late: { collection: "C2723754859-GES_DISC", shortName: "GPM_3IMERGDL", variable: "GPM_3IMERGDL_07_precipitation", doi: "10.5067/GPM/IMERGDL/DAY/07" },
};
export const IMERG_VERSION = "07";
/** First day of both V07 daily records (CMR temporal extents, checked 2026-11-13). */
export const IMERG_START = "1998-01-01";
const HARMONY = "https://harmony.earthdata.nasa.gov";
const CMR = "https://cmr.earthdata.nasa.gov/search/granules.json";
/** Largest daily total accepted as plausible (mm). The world record is about 1,825 mm in a day. */
export const IMERG_MAX_MM_DAY = 2000;

/** The 0.1° IMERG cell containing a point. Cell edges sit on multiples of 0.1° from −180 and −90. */
export type ImergCell = { key: string; row: number; col: number; centre: { lat: number; lon: number }; box: { south: number; north: number; west: number; east: number } };

export function imergCell(lat: number, lon: number): ImergCell {
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) throw new RangeError("Location outside the IMERG grid");
  const row = Math.min(1799, Math.floor((lat + 90) * 10 + 1e-9));
  const col = Math.min(3599, Math.floor((lon + 180) * 10 + 1e-9));
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  const centre = { lat: r(-90 + (row + 0.5) / 10), lon: r(-180 + (col + 0.5) / 10) };
  // A box well inside the cell (±0.025°), so no neighbouring cell enters the average.
  const box = { south: r(centre.lat - 0.025), north: r(centre.lat + 0.025), west: r(centre.lon - 0.025), east: r(centre.lon + 0.025) };
  return { key: `imerg0.1:r${row}c${col}`, row, col, centre, box };
}

export function imergSubmitUrl(run: ImergRun, cell: ImergCell, start: string, end: string): string {
  const { collection, variable } = IMERG_RUNS[run];
  const q = [
    `subset=lat(${cell.box.south}:${cell.box.north})`,
    `subset=lon(${cell.box.west}:${cell.box.east})`,
    `subset=time(${encodeURIComponent(`"${start}T00:00:00Z":"${end}T00:00:00Z"`)})`,
    "format=text%2Fcsv",
    "average=area",
  ].join("&");
  return `${HARMONY}/${collection}/ogc-api-coverages/1.0.0/collections/${variable}/coverage/rangeset?${q}`;
}

/** Last day of a run's record (newest granule in CMR), or an error. */
export async function imergRecordEnd(run: ImergRun): Promise<{ ok: true; end: string } | { ok: false; error: string }> {
  const res = await fetchText(`${CMR}?collection_concept_id=${IMERG_RUNS[run].collection}&sort_key=-start_date&page_size=1`, { timeoutMs: 30_000 });
  if (!res.ok) return { ok: false, error: `CMR: ${res.error}` };
  const t = (JSON.parse(res.body) as { feed?: { entry?: { time_start?: string }[] } }).feed?.entry?.[0]?.time_start?.slice(0, 10);
  return t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? { ok: true, end: t } : { ok: false, error: "CMR listed no granule" };
}

export type ImergSeries = { start: string; end: string; dates: string[]; values: (number | null)[]; fill: number | null; checks: Check[] };

const dayMs = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Parses and validates the Giovanni CSV: header block ("User Start Date:", …, "Fill Value:"), a
 * line with a single comma, then "time,mean_<variable>" and one row per day. Every expected day
 * must appear exactly once, in order. Fill, empty, negative or implausible values become null.
 */
export function parseImergCsv(text: string, run: ImergRun, start: string, end: string, cell: ImergCell): ImergSeries {
  const lines = text.replace(/\r/g, "").split("\n");
  const header = new Map<string, string>();
  let i = 0;
  for (; i < lines.length && lines[i]!.trim() !== ","; i++) {
    const [k, ...v] = lines[i]!.split(",");
    if (k) header.set(k.trim(), v.join(",").replace(/^"|"$/g, "").trim());
  }
  const head = (lines[i + 1] ?? "").trim();
  const fillRaw = Number(header.get("Fill Value:"));
  const fill = Number.isFinite(fillRaw) ? fillRaw : null;
  const box = (header.get("User Bounding Box:") ?? "").split(",").map((s) => Number(s.trim()));
  const inside = box.length === 4 && box.every(Number.isFinite) && box[0]! >= cell.box.west - 1e-6 && box[2]! <= cell.box.east + 1e-6 && box[1]! >= cell.box.south - 1e-6 && box[3]! <= cell.box.north + 1e-6;

  const expected = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / dayMs) + 1;
  const dates: string[] = [];
  const values: (number | null)[] = [];
  let fills = 0, negative = 0, implausible = 0, order = true;
  for (const line of lines.slice(i + 2)) {
    if (!line.trim()) continue;
    const [t, v] = line.split(",");
    const d = (t ?? "").slice(0, 10);
    if (d !== iso(Date.parse(`${start}T00:00:00Z`) + dates.length * dayMs)) order = false;
    dates.push(d);
    const n = v == null || v.trim() === "" ? NaN : Number(v);
    if (!Number.isFinite(n) || (fill != null && Math.abs(n - fill) < 0.01)) { fills++; values.push(null); }
    else if (n < 0) { negative++; values.push(null); }
    else if (n > IMERG_MAX_MM_DAY) { implausible++; values.push(null); }
    else values.push(Math.round(n * 100) / 100);
  }
  const checks: Check[] = [
    check("variable", head === `time,mean_${IMERG_RUNS[run].variable}`, `column header "${head.slice(0, 80)}"`),
    check("location", inside, `box ${box.join(", ")} inside cell ${cell.key}`),
    check("period", header.get("User Start Date:")?.slice(0, 10) === start && header.get("User End Date:")?.slice(0, 10) === end, `${header.get("User Start Date:") ?? "?"} → ${header.get("User End Date:") ?? "?"}`),
    check("days", order && dates.length === expected, `${dates.length} of ${expected} days, ${order ? "consecutive" : "out of order or with gaps"}`),
    check("fill", fill != null, `fill value ${fill ?? "missing"}`),
    check("values", negative === 0 && implausible === 0, `${fills} missing, ${negative} negative, ${implausible} above ${IMERG_MAX_MM_DAY} mm`),
  ].map((c) => ({ ...c, id: `${run}:${c.id}` }));
  return { start, end, dates, values, fill, checks };
}

type Job = { jobID?: string; status?: string; message?: string; links?: { href: string; rel?: string }[] };

/**
 * Submits the request, waits for the Harmony job (normally 20–60 s for the whole record) and
 * downloads its CSV. The token is sent only to harmony.earthdata.nasa.gov and is never logged.
 */
export async function fetchImergSeries(
  run: ImergRun,
  cell: ImergCell,
  start: string,
  end: string,
  token: string,
  opts: { pollMs?: number; maxWaitMs?: number; onWait?: (seconds: number) => void | Promise<void> } = {},
): Promise<{ ok: true; csv: string; retrieval: Retrieval; jobId: string; submitUrl: string } | { ok: false; error: string; auth?: boolean }> {
  const auth = { Authorization: `Bearer ${token}` };
  const submitUrl = imergSubmitUrl(run, cell, start, end);
  // The rangeset request answers 303 to the job; fetch follows it on the same host.
  const sub = await fetchText(submitUrl, { timeoutMs: 60_000, headers: auth, attempts: 2 });
  if (!sub.ok) {
    const denied = sub.status === 401 || sub.status === 403;
    return { ok: false, error: denied ? "NASA Earthdata rejected the token (expired, or the NASA GESDISC DATA ARCHIVE application is not authorised for this account)" : `Harmony did not accept the request: ${sub.error}`, auth: denied };
  }
  let job: Job;
  try { job = JSON.parse(sub.body) as Job; } catch { return { ok: false, error: "Harmony answered with something other than a job" }; }
  if (!job.jobID) return { ok: false, error: "Harmony did not return a job id" };
  const jobUrl = `${HARMONY}/jobs/${encodeURIComponent(job.jobID)}`;
  const started = Date.now();
  const pollMs = opts.pollMs ?? 4000, maxWaitMs = opts.maxWaitMs ?? 6 * 60_000;
  while (job.status !== "successful") {
    if (job.status === "failed" || job.status === "canceled" || job.status === "complete_with_errors") return { ok: false, error: `Harmony job ${job.status}: ${(job.message ?? "").slice(0, 200)}` };
    if (Date.now() - started > maxWaitMs) return { ok: false, error: `Harmony job still ${job.status ?? "unknown"} after ${Math.round(maxWaitMs / 1000)} s` };
    await new Promise((r) => setTimeout(r, pollMs));
    await opts.onWait?.(Math.round((Date.now() - started) / 1000));
    const p = await fetchText(jobUrl, { timeoutMs: 30_000, headers: auth, attempts: 3 });
    if (!p.ok) return { ok: false, error: `Harmony job status: ${p.error}` };
    try { job = JSON.parse(p.body) as Job; } catch { return { ok: false, error: "Harmony job status was unreadable" }; }
  }
  const data = (job.links ?? []).filter((l) => l.rel === "data" && /\.csv$/i.test(l.href));
  if (data.length !== 1) return { ok: false, error: `Harmony job produced ${data.length} CSV files, expected 1` };
  const href = data[0]!.href;
  if (!href.startsWith(`${HARMONY}/`)) return { ok: false, error: "Harmony result link is not on harmony.earthdata.nasa.gov" };
  const res = await fetchText(href, { timeoutMs: 120_000, headers: auth, attempts: 3 });
  if (!res.ok) return { ok: false, error: `Harmony result download: ${res.error}` };
  return { ok: true, csv: res.body, retrieval: res.retrieval, jobId: job.jobID!, submitUrl };
}
