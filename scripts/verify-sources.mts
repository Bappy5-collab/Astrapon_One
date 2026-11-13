/**
 * Live verification of Astrapon data sources.
 *
 *   pnpm verify:sources                 # all sources
 *   pnpm verify:sources power modis     # subset
 *   pnpm verify:sources --write-fixtures  # also refresh labelled test fixtures
 *
 * Writes data/verification/<source-id>.json: what was requested, a hash of the
 * exact response, every validation check, and one traceable sample value.
 * Exit code 1 if a source expected to be live (no credentials needed) fails.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { checkCollection, type CollectionCheck } from "../src/server/providers/cmr";
import { check, fetchText } from "../src/server/providers/http";
import { fetchImergSeries, IMERG_RUNS, IMERG_START, imergCell, imergRecordEnd, parseImergCsv, type ImergRun } from "../src/server/providers/imerg";
import { lastCompleteMonthEnd } from "../src/server/pipeline/power";
import { loadEnv } from "./db/connect.mts";
import { fetchPowerDailyPoint, type PowerDailyRequest } from "../src/server/providers/nasa-power";
import { fetchMod13q1Ndvi } from "../src/server/providers/ornl-modis";
import { fetchSoilGrids } from "../src/server/providers/soilgrids";
import { awcFromSoilGrids } from "../src/server/pipeline/soilgrids";
import {
  buildSdaHorizonQuery,
  buildSdaSurveyVersionQuery,
  parseSdaTable,
  postSdaQuery,
  rootZoneAwcMm,
  sdaProvenance,
  toHorizons,
  validateSda,
} from "../src/server/providers/usda-sda";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "data", "verification");
const FIXTURES = join(ROOT, "src", "server", "providers", "__fixtures__");
const args = process.argv.slice(2);
const writeFixtures = args.includes("--write-fixtures");
const only = args.filter((a) => !a.startsWith("--"));
const want = (k: string) => only.length === 0 || only.includes(k);

/** Test location: Iowa State University agronomy farm area near Ames, IA (row-crop landscape, inside SSURGO). */
const SITE = { name: "Near Ames, Iowa, USA (test point)", latitude: 42.03, longitude: -93.62 };

type Outcome = "live_verified" | "implemented" | "failed" | "credential_blocked" | "unavailable";
const results: { id: string; outcome: Outcome; expectedLive: boolean }[] = [];

function save(id: string, body: Record<string, unknown>) {
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${id}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        artifact: "LIVE VERIFICATION RECORD — produced by scripts/verify-sources.mts. Not a fixture and not an input to the product.",
        sourceId: id,
        generatedAt: new Date().toISOString(),
        site: SITE,
        ...body,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`  → ${file.replace(ROOT, ".")}`);
}

function fixture(name: string, capturedFrom: string, response: unknown) {
  if (!writeFixtures) return;
  mkdirSync(FIXTURES, { recursive: true });
  const file = join(FIXTURES, `${name}.fixture.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify(
      {
        _fixture: {
          label: "TEST FIXTURE ONLY — trimmed copy of a live provider response. Never use as a measurement or production fallback.",
          capturedFrom,
          capturedAt: new Date().toISOString(),
        },
        response,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`  → fixture ${file.replace(ROOT, ".")}`);
}

const summarize = (checks: { id: string; passed: boolean; detail: string }[]) => {
  for (const c of checks) console.log(`    ${c.passed ? "✓" : "✗"} ${c.id}: ${c.detail}`);
  return checks.every((c) => c.passed);
};

// --------------------------------------------------------------- POWER ---
async function verifyPower() {
  console.log("\nNASA POWER daily point (AG)");
  const historical: PowerDailyRequest = {
    latitude: SITE.latitude,
    longitude: SITE.longitude,
    start: "2024-01-01",
    end: "2024-12-31",
    parameters: ["T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN", "RH2M", "WS2M", "GWETROOT"],
  };
  const res = await fetchPowerDailyPoint(historical);
  if (!res.ok) {
    console.log(`  ✗ ${res.error}`);
    save("nasa-power-daily", { outcome: "failed", request: { url: res.url }, error: res.error, status: res.status ?? null });
    results.push({ id: "nasa-power-daily", outcome: "failed", expectedLive: true });
    return;
  }
  const ok = summarize(res.result.checks);

  // Recent window: measures actual near-real-time latency (trailing fill values).
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const start = new Date(today.getTime() - 20 * 86_400_000).toISOString().slice(0, 10);
  const recent = await fetchPowerDailyPoint({ ...historical, start, end, parameters: ["T2M_MAX", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN"] });
  const latency = recent.ok
    ? Object.fromEntries(
        recent.result.series.map((s) => {
          const lastValid = s.values.findLastIndex((v) => v !== null);
          return [s.parameter, { lastValidDate: lastValid >= 0 ? recent.result.dates[lastValid] : null, trailingFillDays: s.values.length - 1 - lastValid }];
        }),
      )
    : { error: recent.error };

  const traceDate = "20240715";
  const idx = res.result.dates.indexOf(traceDate);
  const tmax = res.result.series.find((s) => s.parameter === "T2M_MAX");
  const raw = res.raw as { properties: { parameter: Record<string, Record<string, number>> }; header: unknown };

  save("nasa-power-daily", {
    outcome: ok ? "live_verified" : "failed",
    request: { url: res.url, method: "GET", parameters: historical },
    response: { ...res.retrieval, header: raw.header, apiVersion: res.result.apiVersion, upstreamSources: res.result.upstreamSources, reportedElevationM: res.result.reportedElevationM },
    checks: res.result.checks,
    summary: res.result.series.map((s) => ({ parameter: s.parameter, units: s.units, valid: s.validCount, missing: s.missingCount, evidenceClass: s.provenance.evidenceClass })),
    trace: {
      statement: `T2M_MAX on 2024-07-15 for the grid cell containing (${SITE.latitude}, ${SITE.longitude}) = ${tmax?.values[idx]} ${tmax?.units}`,
      jsonPath: `properties.parameter.T2M_MAX["${traceDate}"]`,
      rawValue: raw.properties.parameter.T2M_MAX?.[traceDate],
      evidenceClass: tmax?.provenance.evidenceClass,
      spatialSupport: tmax?.provenance.spatialSupport,
      reproduce: `curl "${res.url}"  # compare jsonPath; body sha256 ${res.retrieval.bodySha256} (exact bytes may change if POWER reprocesses)`,
    },
    excerpt: Object.fromEntries(Object.entries(raw.properties.parameter).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).slice(195, 200))])),
    nearRealTimeLatency: { checkedWindow: { start, end }, ...latency },
  });
  results.push({ id: "nasa-power-daily", outcome: ok ? "live_verified" : "failed", expectedLive: true });

  if (ok) {
    const trimmed = {
      ...(res.raw as object),
      properties: { parameter: Object.fromEntries(Object.entries(raw.properties.parameter).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).slice(0, 10))])) },
      header: { ...(raw.header as object), start: "20240101", end: "20240110" },
    };
    fixture("nasa-power-daily", res.url, trimmed);
  }
}

// --------------------------------------------------------------- MODIS ---
async function verifyModis() {
  console.log("\nMODIS MOD13Q1 v061 NDVI via ORNL DAAC subset service");
  const res = await fetchMod13q1Ndvi(SITE.latitude, SITE.longitude, "2024-01-01", "2024-12-31");
  if ("error" in res) {
    console.log(`  ✗ ${res.error}`);
    save("modis-mod13q1-ornl", { outcome: "failed", error: res.error });
    results.push({ id: "modis-mod13q1-ornl", outcome: "failed", expectedLive: true });
    return;
  }
  const ok = summarize(res.result.checks);
  const peak = res.result.samples.filter((s) => s.ndvi !== null).sort((a, b) => (b.ndvi ?? 0) - (a.ndvi ?? 0))[0];
  save("modis-mod13q1-ornl", {
    outcome: ok ? "live_verified" : "failed",
    request: { urls: res.urls, method: "GET", headers: { Accept: "application/json" } },
    checks: res.result.checks,
    cellsizeM: res.result.cellsizeM,
    provenance: res.result.provenance,
    samples: res.result.samples,
    trace: peak && {
      statement: `Peak usable 2024 NDVI for the MODIS pixel containing (${SITE.latitude}, ${SITE.longitude}) = ${peak.ndvi} on composite ${peak.calendarDate} (${peak.modisDate}, tile ${peak.tile}); raw ${peak.rawNdvi} × scale 0.0001; reliability rank ${peak.reliability}`,
      jsonPath: `subset[modis_date="${peak.modisDate}"].data[0]`,
      reproduce: `curl -H "Accept: application/json" "${res.urls.find((u) => u.includes("NDVI"))}"`,
    },
  });
  results.push({ id: "modis-mod13q1-ornl", outcome: ok ? "live_verified" : "failed", expectedLive: true });
  if (ok) {
    fixture("ornl-mod13q1-bands", "https://modis.ornl.gov/rst/api/v1/MOD13Q1/bands", res.bandsRaw);
    fixture("ornl-mod13q1-ndvi", res.urls[0] ?? "", res.ndviRaw[0]);
    fixture("ornl-mod13q1-reliability", res.urls[1] ?? "", res.relRaw[0]);
  }
}

// ----------------------------------------------------------- SSURGO SDA ---
async function verifySda() {
  console.log("\nUSDA NRCS SSURGO via Soil Data Access");
  const q = buildSdaHorizonQuery(SITE.latitude, SITE.longitude);
  const res = await postSdaQuery(q);
  if (!res.ok) {
    console.log(`  ✗ ${res.error}`);
    save("usda-ssurgo-sda", { outcome: "failed", request: { query: q }, error: res.error });
    results.push({ id: "usda-ssurgo-sda", outcome: "failed", expectedLive: true });
    return;
  }
  const horizons = toHorizons(parseSdaTable(res.raw));
  const checks = validateSda(horizons);
  const mukey = horizons[0]?.mukey ?? "";
  const ver = mukey ? await postSdaQuery(buildSdaSurveyVersionQuery(mukey)) : null;
  const survey = ver?.ok ? (parseSdaTable(ver.raw)[0] as { areasymbol: string; areaname: string; saverest: string } | undefined) ?? null : null;
  checks.push({ id: "survey-version", passed: !!survey, detail: survey ? `${survey.areasymbol} ${survey.areaname}, saverest ${survey.saverest}` : "survey version not found" });
  const ok = summarize(checks);
  const first = horizons[0];
  save("usda-ssurgo-sda", {
    outcome: ok ? "live_verified" : "failed",
    request: { url: "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest", method: "POST", query: q, format: "JSON+COLUMNNAME" },
    response: res.retrieval,
    checks,
    provenance: sdaProvenance(survey, res.retrieval),
    horizons,
    derived: { note: "Derived by Astrapon from survey awc_r (cm/cm) × horizon thickness; not a provider value.", rootZone100cm: rootZoneAwcMm(horizons, 100) },
    trace: first && {
      statement: `Top horizon (${first.topCm}–${first.bottomCm} cm) of ${first.compname} (${first.comppct}% of map unit ${first.mukey}, "${first.muname}") has awc_r = ${first.awc}`,
      reproduce: "POST the query above to the SDA endpoint with format JSON+COLUMNNAME",
    },
  });
  results.push({ id: "usda-ssurgo-sda", outcome: ok ? "live_verified" : "failed", expectedLive: true });
  if (ok) fixture("usda-sda-horizons", "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest", res.raw);
}

// ------------------------------------------------------------ SoilGrids ---
async function verifySoilGrids() {
  console.log("\nISRIC SoilGrids 2.0 REST");
  // Water retention at a Bangladesh cropland point (Rajshahi test square): the layers the soil pipeline uses.
  const res = await fetchSoilGrids(24.62, 88.56, ["wv0033", "wv1500"], ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm"]);
  if (!res.ok) {
    const root = await fetch("https://rest.isric.org/", { signal: AbortSignal.timeout(30_000) }).then((r) => `HTTP ${r.status}`).catch((e: Error) => e.message);
    console.log(`  ✗ ${res.error}; service root: ${root}`);
    save("isric-soilgrids", {
      outcome: "unavailable",
      request: { url: res.url },
      error: res.error,
      serviceRoot: { url: "https://rest.isric.org/", result: root },
      officialStatus: "ISRIC paused the REST service in October 2026 (https://www.isric.org/explore/soilgrids); it answered again on 2026-11-06.",
    });
    results.push({ id: "isric-soilgrids-v2", outcome: "unavailable", expectedLive: false });
    return;
  }
  const ok = summarize(res.checks) && awcFromSoilGrids(res.values).awcMm != null;
  const allNull = res.checks.some((c) => c.id === "has-values" && !c.passed);
  const outcome: Outcome = ok ? "live_verified" : allNull ? "unavailable" : "failed";
  save("isric-soilgrids", {
    outcome,
    note: allNull ? "HTTP 200 with a well-formed body, but every value was null for a cropland point: treated as unavailable, not as data." : undefined,
    officialStatus: "ISRIC paused the REST service in October 2026 (https://www.isric.org/explore/soilgrids); it answered again on 2026-11-06.",
    request: { url: res.url },
    response: res.retrieval,
    checks: res.checks,
    point: { name: "Rajshahi, Bangladesh (test square)", latitude: 24.62, longitude: 88.56 },
    awcMm0to100: awcFromSoilGrids(res.values).awcMm,
    trace: { point: "24.62, 88.56", layers: awcFromSoilGrids(res.values).layers, awcMm0to100: awcFromSoilGrids(res.values).awcMm, rule: "Σ (wv0033 − wv1500)/100 × thickness, layer means, 0–100 cm" },
    excerpt: (res.raw as { properties?: { layers?: unknown[] } }).properties?.layers?.slice(0, 2),
  });
  results.push({ id: "isric-soilgrids-v2", outcome, expectedLive: false });
}

// ------------------------------------------------------------------ CMR ---
async function verifyCmr() {
  console.log("\nCMR collection metadata + unauthenticated data-access probe");
  const targets: [string, string][] = [
    ["GPM_3IMERGDL", "07"],
    ["GPM_3IMERGDF", "07"],
    ["SPL3SMP_E", "006"],
    ["SPL4SMGP", "008"],
    ["MOD13Q1", "061"],
    ["HLSL30", "2.0"],
    ["NASADEM_HGT", "001"],
  ];
  const out: CollectionCheck[] = [];
  for (const [sn, v] of targets) {
    const c = await checkCollection(sn, v);
    out.push(c);
    console.log(`  ${c.checks.every((x) => x.passed) ? "✓" : "✗"} ${sn} v${v}: newest ${c.latestGranuleStart?.slice(0, 10) ?? "?"}; data access: ${c.dataAccess} (${c.dataAccessDetail})`);
  }
  save("cmr-collections", {
    outcome: "metadata_live_verified",
    note: "CMR confirms collections and granule freshness only. 'earthdata-login-required' means data values were NOT retrieved: credential-blocked.",
    collections: out,
  });
  const blocked = out.filter((c) => c.dataAccess === "earthdata-login-required").map((c) => c.shortName);
  results.push({ id: `cmr (${blocked.join(", ")} data)`, outcome: "credential_blocked", expectedLive: false });
}

// ---------------------------------------------------------- GPM IMERG ---
/**
 * IMERG Late daily rain for the Rajshahi test square through Harmony (whole record), cross-checked
 * day by day against an OPeNDAP read of the same 0.1° cell, and compared year by year with POWER.
 * Needs NASA_EARTHDATA_TOKEN (never printed). Outcome "implemented" (credentialed sources are never
 * recorded as live_verified).
 */
async function verifyImerg() {
  console.log("\nNASA GPM IMERG daily rain, Final and Late Run (Harmony / Giovanni area average)");
  loadEnv();
  const token = process.env.NASA_EARTHDATA_TOKEN?.trim();
  const site = { name: "Rajshahi test square, Bangladesh", latitude: 24.62, longitude: 88.56 };
  if (!token) {
    save("gpm-imerg", { outcome: "credential_blocked", note: "NASA_EARTHDATA_TOKEN is not set", site });
    results.push({ id: "gpm-imerg", outcome: "credential_blocked", expectedLive: false });
    return;
  }
  const cell = imergCell(site.latitude, site.longitude);
  const lateEnd = lastCompleteMonthEnd();
  const fe = await imergRecordEnd("final");
  const ends: Record<ImergRun, string> = { late: lateEnd, final: fe.ok && fe.end < lateEnd ? fe.end : lateEnd };
  const checks: { id: string; passed: boolean; detail: string }[] = [check("final:record-end", fe.ok, fe.ok ? `Final Run newest granule ${fe.end}` : fe.error)];
  const series: Partial<Record<ImergRun, { s: ReturnType<typeof parseImergCsv>; seconds: number; sha: string; jobId: string }>> = {};
  for (const run of ["late", "final"] as ImergRun[]) {
    const t0 = Date.now();
    const r = await fetchImergSeries(run, cell, IMERG_START, ends[run], token);
    if (!r.ok) { checks.push(check(`${run}:fetch`, false, r.error)); continue; }
    const s = parseImergCsv(r.csv, run, IMERG_START, ends[run], cell);
    checks.push(...s.checks);
    series[run] = { s, seconds: Math.round((Date.now() - t0) / 1000), sha: r.retrieval.bodySha256, jobId: r.jobId };
    if (run === "late") fixture("gpm-imerg-late-csv", `Harmony ${IMERG_RUNS.late.collection} ${cell.key} (first 40 days of the record)`, { start: IMERG_START, end: s.dates[39], cell, csv: r.csv.split("\n").slice(0, 6 + 40).join("\n") + "\n" });
  }

  // Cross-check: the same cell read directly from daily files through OPeNDAP (DAP4 CSV), both runs.
  const dates = ["2007-07-15", "2017-06-12", "2024-08-20"];
  const cross: { run: ImergRun; date: string; harmony: number | null; opendap: number | null }[] = [];
  for (const run of ["late", "final"] as ImergRun[]) {
    const s = series[run]?.s;
    if (!s) continue;
    for (const d of dates) {
      const g = await fetchText(`https://cmr.earthdata.nasa.gov/search/granules.umm_json?collection_concept_id=${IMERG_RUNS[run].collection}&temporal=${d}T00:00:00Z,${d}T23:59:59Z&page_size=5`, { timeoutMs: 60_000 });
      const items = g.ok ? (JSON.parse(g.body) as { items: { umm: { RelatedUrls?: { URL: string }[] } }[] }).items : [];
      const od = items.map((it) => it.umm.RelatedUrls?.find((u) => u.URL.includes("opendap.earthdata.nasa.gov"))?.URL).find(Boolean);
      let v: number | null = null;
      if (od) {
        // Two cells are asked for and the first kept: Hyrax returns an empty value for a single-cell subset.
        const ce = encodeURIComponent(`/precipitation[0:1:0][${cell.col}:1:${cell.col}][${cell.row}:1:${cell.row + 1}]`);
        const res = await fetchText(`${od}.dap.csv?dap4.ce=${ce}`, { timeoutMs: 60_000, headers: { Authorization: `Bearer ${token}` } });
        // DAP4 CSV: "/precipitation[0][0], 3.175, 2.815" (this cell, then the one to its north)
        const line = res.ok ? res.body.split(/\r?\n/).find((l) => l.startsWith("/precipitation[")) : undefined;
        const raw = line?.split(",")[1]?.trim();
        const n = raw ? Number(raw) : NaN;
        v = Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
      }
      const i = s.dates.indexOf(d);
      cross.push({ run, date: d, harmony: i >= 0 ? s.values[i] ?? null : null, opendap: v });
    }
  }
  checks.push(check("same-as-opendap-cell", cross.length > 0 && cross.every((c) => c.harmony != null && c.opendap != null && Math.abs(c.harmony - c.opendap) <= 0.01), cross.map((c) => `${c.run} ${c.date}: Harmony ${c.harmony} mm, OPeNDAP cell [lon ${cell.col}, lat ${cell.row}] ${c.opendap} mm`).join("; ")));

  // Year totals for complete years 2015–2024: IMERG Final, IMERG Late and POWER (PRECTOTCORR, same point).
  const years = Array.from({ length: 10 }, (_, k) => 2015 + k);
  const total = (s: ReturnType<typeof parseImergCsv> | undefined, y: number) => {
    if (!s) return null;
    const xs = s.dates.map((d, k) => (d.startsWith(`${y}-`) ? s.values[k] : undefined)).filter((v) => v !== undefined);
    return xs.length >= 365 && xs.every((v) => v != null) ? Math.round(xs.reduce((a, b) => a + (b as number), 0)) : null;
  };
  const pw = await fetchPowerDailyPoint({ latitude: site.latitude, longitude: site.longitude, start: "2015-01-01", end: "2024-12-31", parameters: ["PRECTOTCORR"] });
  const powerYear = (y: number) => {
    if (!pw.ok) return null;
    const ser = pw.result.series.find((x) => x.parameter === "PRECTOTCORR");
    if (!ser) return null;
    const xs = pw.result.dates.map((d, k) => (d.startsWith(String(y)) ? ser.values[k] : undefined)).filter((v) => v !== undefined);
    return xs.every((v) => v != null) ? Math.round(xs.reduce((a, b) => a + (b as number), 0)) : null;
  };
  const annual = years.map((y) => ({ year: y, imergFinalMm: total(series.final?.s, y), imergLateMm: total(series.late?.s, y), powerMm: powerYear(y) }));
  const ok = summarize(checks);
  console.log(`    seconds: late ${series.late?.seconds}, final ${series.final?.seconds}; annual mm (Final / Late / POWER): ${annual.map((a) => `${a.year} ${a.imergFinalMm}/${a.imergLateMm}/${a.powerMm}`).join(", ")}`);
  save("gpm-imerg", {
    source: "gpm-imerg-daily",
    outcome: ok ? "implemented" : "failed",
    checkedAt: new Date().toISOString().slice(0, 10),
    auth: "NASA Earthdata bearer token (not recorded); NASA GESDISC DATA ARCHIVE application authorised on the account",
    route: `Harmony → Giovanni area-average time series (CSV) over box ${JSON.stringify(cell.box)} inside cell ${cell.key}; one job per run`,
    site,
    requests: (["late", "final"] as ImergRun[]).map((run) => ({ run, collection: IMERG_RUNS[run].collection, start: IMERG_START, end: ends[run], jobId: series[run]?.jobId ?? null, seconds: series[run]?.seconds ?? null, responseSha256: series[run]?.sha ?? null })),
    checks,
    trace: {
      point: `${site.name} ${site.latitude}, ${site.longitude}`,
      cell: { key: cell.key, centre: cell.centre },
      days: { late: series.late?.s.values.length ?? 0, final: series.final?.s.values.length ?? 0 },
      sampleDays: cross,
      annualRainMm: annual,
      note: "IMERG days are UTC days; POWER days are local solar time. POWER is a ½° × ⅝° reanalysis cell, IMERG a 0.1° satellite cell. The Late Run is not gauge-calibrated; the engine uses the Final Run whenever it covers a run's replay window.",
    },
  });
  results.push({ id: "gpm-imerg", outcome: ok ? "implemented" : "failed", expectedLive: false });
}

if (want("power")) await verifyPower();
if (want("modis")) await verifyModis();
if (want("sda")) await verifySda();
if (want("soilgrids")) await verifySoilGrids();
if (want("cmr")) await verifyCmr();
if (want("imerg")) await verifyImerg();

console.log("\nSummary");
for (const r of results) console.log(`  ${r.outcome.padEnd(18)} ${r.id}`);
const unexpected = results.filter((r) => r.expectedLive && r.outcome !== "live_verified");
if (unexpected.length) {
  console.log(`\n${unexpected.length} source(s) expected to be live did not verify.`);
  process.exit(1);
}
