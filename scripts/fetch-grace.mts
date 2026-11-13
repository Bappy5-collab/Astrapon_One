/**
 * Builds data/reference/grace-mascon.json (read on the server only) from the newest JPL GRACE/GRACE-FO mascon file
 * (RL06.3Mv04, Coastline Resolution Improvement), for the regional water-storage context on the
 * Water & Energy page. Run monthly: pnpm grace:fetch [--file local.nc]
 *
 *  - CMR (no auth) names the newest granule of collection C3195527175-POCLOUD; the file (~46 MB)
 *    is downloaded from PO.DAAC with NASA_EARTHDATA_TOKEN (never printed) and cached in .cache/grace.
 *  - Only land cells (land_mask = 1) are kept. Values are per 3° equal-area mascon (the 0.5° grid
 *    repeats them), so the series are stored once per mascon; each land cell keeps its mascon id
 *    and its CRI land scale factor.
 *  - lwe_thickness is the equivalent water thickness anomaly (cm) relative to the 2004.000–2009.999
 *    mean, as JPL distributes it; uncertainty is per mascon. Nothing is interpolated.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import h5wasm from "h5wasm/node";

import { loadEnv } from "./db/connect.mts";

const COLLECTION = "C3195527175-POCLOUD";
const ROOT = path.resolve(import.meta.dirname, "..");
const CACHE = path.join(ROOT, ".cache", "grace");
const OUT = path.join(ROOT, "data", "reference", "grace-mascon.json");

loadEnv();
const fileArg = process.argv.indexOf("--file");
let file: string;
let granule: string;
let dateCreated: string | null = null;
const retrievedAt = new Date().toISOString();

if (fileArg > 0) {
  file = process.argv[fileArg + 1]!;
  granule = path.basename(file, ".nc");
} else {
  const cmr = await fetch(`https://cmr.earthdata.nasa.gov/search/granules.umm_json?collection_concept_id=${COLLECTION}&sort_key=-start_date&page_size=1`);
  if (!cmr.ok) throw new Error(`CMR answered HTTP ${cmr.status}`);
  const item = ((await cmr.json()) as { items: { umm: { GranuleUR: string; RelatedUrls: { URL: string; Type: string }[]; ProviderDates?: { Date: string; Type: string }[] } }[] }).items[0];
  if (!item) throw new Error("CMR returned no granule");
  granule = item.umm.GranuleUR;
  dateCreated = item.umm.ProviderDates?.find((d) => d.Type === "Create")?.Date ?? null;
  const url = item.umm.RelatedUrls.find((u) => u.Type === "GET DATA" && u.URL.endsWith(".nc"))?.URL;
  if (!url) throw new Error("No .nc download URL in CMR");
  mkdirSync(CACHE, { recursive: true });
  file = path.join(CACHE, `${granule}.nc`);
  if (!existsSync(file)) {
    const token = process.env.NASA_EARTHDATA_TOKEN;
    if (!token) throw new Error("NASA_EARTHDATA_TOKEN is not set");
    let u = url;
    let res: Response | null = null;
    for (let hop = 0; hop < 8; hop++) {
      // The token goes only to the Earthdata host; the signed redirect target gets no credentials.
      const auth = new URL(u).hostname.endsWith("earthdata.nasa.gov") ? { Authorization: `Bearer ${token}` } : undefined;
      res = await fetch(u, { headers: auth, redirect: "manual" });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { u = new URL(res.headers.get("location")!, u).href; continue; }
      break;
    }
    if (!res || !res.ok) throw new Error(`Download failed: HTTP ${res?.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
}
console.log(`granule ${granule}`);

await h5wasm.ready;
const f = new h5wasm.File(file, "r");
const get = (n: string) => f.get(n) as unknown as { value: ArrayLike<number>; shape: number[]; slice: (r: [number, number][]) => ArrayLike<number>; attrs: Record<string, { value: unknown }> };
const lat = Array.from(get("lat").value), lon = Array.from(get("lon").value), time = Array.from(get("time").value);
const nT = time.length, nLat = lat.length, nLon = lon.length;
if (nLat !== 360 || nLon !== 720 || Math.abs(lat[0]! + 89.75) > 1e-6 || Math.abs(lon[0]! - 0.25) > 1e-6) throw new Error("Unexpected grid");
const months = time.map((d) => new Date(Date.UTC(2002, 0, 1) + d * 86_400_000).toISOString().slice(0, 7));
const land = Array.from(get("land_mask").value);
const scale = Array.from(get("scale_factor").value);
const mascon = Array.from(get("mascon_ID").value);
const lweAll = get("lwe_thickness").value; // [time][lat][lon]
const uncAll = get("uncertainty").value;
const FILL = -99999;

// Land cells → runs per latitude row: [jStart, masconId, scale…] with consecutive cells of one mascon.
const rows: Record<number, [number, number, number[]][]> = {};
const seen = new Map<number, number>(); // mascon → a representative flat cell index
for (let i = 0; i < nLat; i++) {
  const runs: [number, number, number[]][] = [];
  for (let j = 0; j < nLon; j++) {
    const k = i * nLon + j;
    if (land[k] !== 1) continue;
    const m = mascon[k]!;
    if (!seen.has(m)) seen.set(m, k);
    const last = runs.at(-1);
    if (last && last[1] === m && last[0] + last[2].length === j) last[2].push(Math.round(scale[k]! * 1000) / 1000);
    else runs.push([j, m, [Math.round(scale[k]! * 1000) / 1000]]);
  }
  if (runs.length) rows[i] = runs;
}
const plane = nLat * nLon;
const series: Record<number, { lwe: (number | null)[]; unc: (number | null)[] }> = {};
for (const [m, k] of seen) {
  const lwe: (number | null)[] = [], unc: (number | null)[] = [];
  for (let t = 0; t < nT; t++) {
    const v = lweAll[t * plane + k]!, u = uncAll[t * plane + k]!;
    lwe.push(v <= FILL / 2 || !Number.isFinite(v) ? null : Math.round(v * 10));
    unc.push(u <= FILL / 2 || !Number.isFinite(u) ? null : Math.round(u * 10));
  }
  series[m] = { lwe, unc };
}
f.close();

const out = {
  source: "JPL GRACE and GRACE-FO Mascon Ocean, Ice, and Hydrology Equivalent Water Height Coastal Resolution Improvement (CRI) Filtered Release 06.3 Version 04",
  collection: COLLECTION,
  doi: "10.5067/TEMSC-3JC634",
  citation: "Watkins, M. M. et al. (2015), J. Geophys. Res. Solid Earth 120, 2648–2671; Wiese, D. N. et al. (2016), Water Resour. Res. 52, 7490–7502. Data: NASA JPL / PO.DAAC.",
  granule,
  dateCreated,
  retrievedAt,
  units: "mm equivalent water thickness (rounded to 1 mm; JPL distributes cm), anomaly from the 2004.000–2009.999 mean (unscaled; multiply by the cell's land scale factor for land hydrology)",
  nativeResolution: "3° equal-area mascons (about 300 km); the 0.5° grid repeats mascon values",
  grid: { lat0: -89.75, lon0: 0.25, step: 0.5, nLat, nLon },
  months,
  rows,
  series,
};
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
const size = readFileSync(OUT).length;
console.log(`${months[0]} → ${months.at(-1)} (${nT} months), ${seen.size} land mascons, ${Object.keys(rows).length} land rows; wrote ${OUT} (${(size / 1e6).toFixed(2)} MB)`);

// Verification artifact: grid and range checks plus two traceable sample cells.
const { graceCell, graceSummary } = await import("../src/domain/water/grace");
const samples = [["Rajshahi, Bangladesh (test square)", 24.62, 88.56], ["Near Ames, Iowa, USA (test point)", 42.03, -93.62]] as const;
const trace = samples.map(([name, la, lo]) => {
  const c = graceCell(out, la, lo)!;
  const s = series[c.masconId]!;
  return { name, latitude: la, longitude: lo, cell: c, firstValues: s.lwe.slice(0, 3), lastValues: s.lwe.slice(-3), summary: graceSummary(months, s.lwe, s.unc, c.scale) };
});
const values = Object.values(series).flatMap((s) => s.lwe).filter((v): v is number => v != null);
const checks = [
  { id: "grid", passed: nLat === 360 && nLon === 720, detail: `${nLat} × ${nLon}, lat0 ${lat[0]}, lon0 ${lon[0]}` },
  { id: "months", passed: nT >= 200 && months[0] === "2002-04", detail: `${months[0]} → ${months.at(-1)} (${nT})` },
  { id: "land-mascons", passed: seen.size > 1000, detail: `${seen.size} land mascons` },
  { id: "range", passed: values.every((v) => Math.abs(v) < 50_000), detail: `max |anomaly| ${values.reduce((a, v) => Math.max(a, Math.abs(v)), 0)} mm (ice-sheet mascons in Greenland and Antarctica exceed 20 m); limit 50 m` },
  { id: "samples", passed: trace.every((t) => t.summary != null), detail: "both sample cells summarised" },
];
writeFileSync(path.join(ROOT, "data", "verification", "grace-mascon.json"), JSON.stringify({ source: "grace-fo-jpl-mascon", outcome: checks.every((c) => c.passed) ? "implemented" : "failed", checkedAt: retrievedAt, granule, collection: COLLECTION, auth: "NASA Earthdata bearer token (not recorded)", checks, trace }, null, 2) + "\n");
console.log("verification:", checks.map((c) => `${c.passed ? "✓" : "✗"} ${c.id}`).join(" "));
