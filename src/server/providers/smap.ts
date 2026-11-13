import { fetchText } from "./http";

/**
 * NASA SMAP L3 Enhanced Radiometer Global Daily 9 km EASE-Grid Soil Moisture, V006 (SPL3SMP_E,
 * NSIDC DAAC, CMR C2938664763-NSIDC_CPRD), read one grid cell per daily file through Earthdata
 * Cloud OPeNDAP (Hyrax, DAP4). Satellite retrieval (DCA), about 0–5 cm, m³/m³ (= cm³/cm³), valid
 * 0.02–0.5, fill −9999; AM (descending, ≈ 6 a.m.) and PM (ascending, ≈ 6 p.m.) passes.
 * Requires a NASA Earthdata bearer token (passed in; never logged). Verified 2026-11-06.
 */
export const SMAP_COLLECTION = "C2938664763-NSIDC_CPRD";
const CMR = "https://cmr.earthdata.nasa.gov/search/granules.umm_json";

/** EASE-Grid 2.0 global 9 km (EPSG:6933): Lambert cylindrical equal-area on WGS84, standard parallel 30°. */
export const EASE2_9KM = { cols: 3856, rows: 1624, cellM: 9008.055210146, a: 6378137, e: 0.0818191908426, phi1: 30 } as const;

export function ease2Cell(lat: number, lon: number): { row: number; col: number } {
  const { a, e, phi1, cellM, cols, rows } = EASE2_9KM;
  const rad = Math.PI / 180;
  const s1 = Math.sin(phi1 * rad);
  const k0 = Math.cos(phi1 * rad) / Math.sqrt(1 - e * e * s1 * s1);
  const s = Math.sin(lat * rad);
  const q = (1 - e * e) * (s / (1 - e * e * s * s) - (1 / (2 * e)) * Math.log((1 - e * s) / (1 + e * s)));
  const x = a * k0 * lon * rad;
  const y = (a * q) / (2 * k0);
  return { row: Math.floor(rows / 2 - y / cellM), col: Math.floor(x / cellM + cols / 2) };
}

export type SmapGranule = { date: string; name: string; opendap: string };

/** Daily files between two dates (inclusive), one per date (highest processing number kept). */
export async function listSmapGranules(start: string, end: string): Promise<{ ok: true; granules: SmapGranule[] } | { ok: false; error: string }> {
  const out = new Map<string, SmapGranule>();
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const url = `${CMR}?collection_concept_id=${SMAP_COLLECTION}&temporal=${start}T00:00:00Z,${end}T23:59:59Z&page_size=2000&sort_key=start_date`;
    const res = await fetchText(url, { timeoutMs: 60_000, headers: after ? { "CMR-Search-After": after } : {} });
    if (!res.ok) return { ok: false, error: `CMR: ${res.error}` };
    const body = JSON.parse(res.body) as { items: { umm: { GranuleUR: string; RelatedUrls?: { URL: string }[]; TemporalExtent?: { RangeDateTime?: { BeginningDateTime: string } } } }[] };
    for (const it of body.items) {
      const opendap = it.umm.RelatedUrls?.find((u) => u.URL.includes("opendap"))?.URL;
      const date = it.umm.TemporalExtent?.RangeDateTime?.BeginningDateTime?.slice(0, 10) ?? it.umm.GranuleUR.match(/_(\d{8})_/)?.[1]?.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
      if (!opendap || !date) continue;
      const prev = out.get(date);
      if (!prev || it.umm.GranuleUR > prev.name) out.set(date, { date, name: it.umm.GranuleUR, opendap });
    }
    // CMR returns the next cursor in a response header; fetchText exposes only the body, so page by date instead.
    if (body.items.length < 2000) break;
    after = null;
    const last = [...out.keys()].sort().at(-1);
    if (!last) break;
    start = last;
  }
  return { ok: true, granules: [...out.values()].sort((x, y) => x.date.localeCompare(y.date)) };
}

export type SmapDay = { date: string; am: number | null; amQual: number | null; amSurface: number | null; pm: number | null; pmQual: number | null; pmSurface: number | null };

const AM = "/Soil_Moisture_Retrieval_Data_AM/";
const PM = "/Soil_Moisture_Retrieval_Data_PM/";
const VARS = [`${AM}soil_moisture`, `${AM}retrieval_qual_flag`, `${AM}surface_flag`, `${PM}soil_moisture_pm`, `${PM}retrieval_qual_flag_pm`, `${PM}surface_flag_pm`];

/** Parses the DAP4 CSV lines ("/group/var[0], v0, v1") and keeps the first column (two are requested: single-cell subsets come back empty). */
export function parseSmapCsv(text: string, date: string): SmapDay {
  const val = (name: string) => {
    const line = text.split(/\r?\n/).find((l) => l.startsWith(`${name}[`));
    if (!line) return null;
    const v = Number(line.split(",")[1]);
    return Number.isFinite(v) ? v : null;
  };
  const sm = (v: number | null) => (v == null || v < 0.02 || v > 0.5 ? null : v);
  return { date, am: sm(val(VARS[0]!)), amQual: val(VARS[1]!), amSurface: val(VARS[2]!), pm: sm(val(VARS[3]!)), pmQual: val(VARS[4]!), pmSurface: val(VARS[5]!) };
}

export async function fetchSmapDay(g: SmapGranule, cell: { row: number; col: number }, token: string): Promise<{ ok: true; day: SmapDay; sha256: string; bytes: number } | { ok: false; error: string }> {
  const sel = `[${cell.row}:1:${cell.row}][${cell.col}:1:${cell.col + 1}]`;
  const ce = VARS.map((v) => `${v}${sel}`).join(";");
  const url = `${g.opendap}.dap.csv?dap4.ce=${encodeURIComponent(ce)}`;
  const res = await fetchText(url, { timeoutMs: 60_000, headers: { Authorization: `Bearer ${token}` }, attempts: 3 });
  if (!res.ok) return { ok: false, error: res.status === 401 || res.status === 403 ? "NASA Earthdata rejected the token" : res.error };
  return { ok: true, day: parseSmapCsv(res.body, g.date), sha256: res.retrieval.bodySha256, bytes: res.retrieval.bodyBytes };
}

/** Bit 0 of retrieval_qual_flag = 0 means "retrieval recommended" (SMAP L3 product specification). */
export const recommended = (q: number | null) => q != null && (q & 1) === 0;
