/**
 * Builds the public example (/example) from a REAL run: a throwaway account gets a Rajshahi test
 * square with an illustrative crop history, the worker fetches live NASA POWER and SoilGrids, the
 * engine runs, and the stored result is written to data/example/rajshahi.json. The account is
 * deleted afterwards. The farm history is invented (labelled on the page); the weather, soil
 * estimate and engine output are real.  Usage: pnpm example:build
 */
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { ENGINE_VERSION } from "../src/domain/simulation/engine-version";
import type { EngineResult } from "../src/domain/simulation/engine";
import { ATTAINABLE_APPLICATION_EFFICIENCY, demandFromResult } from "../src/domain/water/demand";
import { drySeasonOutlook } from "../src/domain/water/dryseason";
import { graceCell, graceSummary, type GraceFile } from "../src/domain/water/grace";
import { computeWaterEnergy, type PlannerInput } from "../src/domain/water/plan";
import { fetchSolar } from "../src/server/providers/power-solar";
import { readFileSync } from "node:fs";
import { loadEnv } from "./db/connect.mts";

loadEnv();
const ROOT = path.resolve(import.meta.dirname, "..");
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!, PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, SECRET = process.env.SUPABASE_SECRET_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SECRET, opts);
const worker = () => {
  const r = spawnSync(process.execPath, ["--import", "tsx", path.join(ROOT, "scripts", "evidence-worker.mts"), "--once"], { cwd: ROOT, env: { ...process.env, GITHUB_DISPATCH_TOKEN: "" }, encoding: "utf8", timeout: 20 * 60_000 });
  return `${r.stdout}${r.stderr}`.trim().split(/\r?\n/).slice(-2).join(" | ");
};

const PLACE = { name: "Tanore, Rajshahi, Bangladesh (test square)", lat: 24.62, lon: 88.56, d: 0.001 };
const email = `astrapon-example-${randomUUID().slice(0, 6)}@example.com`;
const password = randomBytes(18).toString("base64url");
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { astrapon_test: true } });
if (created.error) throw new Error(created.error.message);
const userId = created.data.user.id;
try {
  const db = createClient(URL_, PUB, opts);
  if ((await db.auth.signInWithPassword({ email, password })).error) throw new Error("sign in failed");
  const farm = await db.from("farms").insert({ name: "Example farm", country_code: "BD" }).select("id").single();
  const field = await db.from("fields").insert({ farm_id: farm.data!.id, name: "Example field (Rajshahi test square)" }).select("id").single();
  const fieldId = field.data!.id;
  const { lat, lon, d } = PLACE;
  const boundary = { type: "Polygon", coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] };
  const b = await db.rpc("set_field_boundary", { p_field_id: fieldId, p_boundary: boundary, p_source: "farmer_drawn" });
  if (b.error) throw new Error(b.error.message);
  // Illustrative history (invented, labelled): dry-season Boro rice then monsoon Aman rice.
  const hist = [2023, 2024, 2025].flatMap((y) => [
    { field_id: fieldId, season_year: y, season: "winter", crop_name: "Boro rice", planted_on: `${y}-01-25`, harvested_on: `${y}-05-14` },
    { field_id: fieldId, season_year: y, season: "summer", crop_name: "Aman rice", planted_on: `${y}-07-20`, harvested_on: `${y}-11-16` },
  ]);
  const h = await db.from("crop_history").insert(hist);
  if (h.error) throw new Error(h.error.message);
  await db.from("field_constraints").insert({ field_id: fieldId, irrigation: "full" });
  for (const s of ["nasa-power-daily", "isric-soilgrids-v2"]) await db.rpc("request_evidence", { p_field_id: fieldId, p_source_id: s });
  console.log("worker (evidence):", worker());
  const settings = {
    // Mustard and chickpea windows come from the FAO Crop Calendar zone (High Barind Tract); crop-parameters v4.
    candidateCrops: ["rice", "wheat", "lentil", "maize", "mustard", "chickpea"],
    rotationYears: 1, replayFromYear: 2006, replayToYear: 2025, irrigationAssumption: "full_irrigation",
    calendarRegion: "FAO · Bangladesh · 26. High Barind Tract", runoffSoilGroup: "C",
    plantingWindows: [
      { crop: "wheat", plantFrom: "11-15", plantTo: "12-05", lengthDays: 115 },
      { crop: "maize", plantFrom: "11-15", plantTo: "12-10", lengthDays: 145 },
      { crop: "lentil", plantFrom: "10-25", plantTo: "11-10", lengthDays: 110 },
    ],
    turnaroundDays: 7, precipitationChangePct: 0, temperatureChangeC: 0, notes: "Public example",
  };
  const sc = await db.from("scenarios").insert({ field_id: fieldId, name: "Barind dry season", settings, settings_schema_version: 2 }).select("id").single();
  if (sc.error) throw new Error(sc.error.message);
  const run = await db.rpc("request_simulation", { p_scenario_id: sc.data.id, p_engine_version: ENGINE_VERSION });
  if (run.error) throw new Error(run.error.message);
  console.log("worker (run):", worker());
  const res = await db.from("simulation_results").select("result_sha256, result").eq("run_id", run.data).maybeSingle();
  const status = await db.from("simulation_runs").select("status, error_message, engine_version").eq("id", run.data).single();
  if (!res.data) throw new Error(`No result: ${status.data?.status} ${status.data?.error_message ?? ""}`);
  // Water & Energy for the compared rotations: a tube well with a HYPOTHETICAL depth range (labelled), NASA POWER sunshine.
  const solar = await fetchSolar(PLACE.lat + d / 2, PLACE.lon + d / 2);
  const demand = demandFromResult(res.data.result as EngineResult);
  const areaHa = (d * 111_320) * (d * 111_320 * Math.cos((PLACE.lat * Math.PI) / 180)) / 10_000;
  const plannerInput: PlannerInput = {
    schema: 1,
    areaHa,
    demand: { mode: "run", runId: run.data, resultSha256: res.data.result_sha256, runKind: "historical_replay", options: demand.options.slice(0, 5) },
    efficiency: { application: ATTAINABLE_APPLICATION_EFFICIENCY.basin[0], applicationBasis: "default_assumption", method: "Basin (flooded plots): lower end of the attainable range (FAO W4367E, Keller 1992)", conveyance: 1, conveyanceBasis: "default_assumption" },
    source: { kind: "well", label: "Shallow tube well (example)", basis: "hypothetical_input", ref: null, straightLineM: null, geometryNote: null },
    lift: { kind: "well", levelKind: "static_plus_drawdown", depthM: { low: 10, high: 20 }, drawdownM: { low: 2, high: 5 }, deliveryAboveGroundM: 1, basis: "hypothetical_input", proxy: null },
    deliveryPressureKPa: 0,
    pipe: { lengthM: { low: 30, high: 60 }, lengthBasis: "hypothetical_input", innerDiameterMm: 75, roughnessMm: 0.0015, minorLossK: { low: 2, high: 6 } },
    pump: { etaPumpMotor: 0.45, runtimeHoursPerDay: 8 },
    solar: { performanceRatio: 0.75, controllerEfficiency: 0.95, mode: "size", existingKwp: null, summary: solar.ok ? solar.summary : null },
    supply: { capacityM3PerDay: null, seasonalBudgetM3: null, basis: "farmer_report" },
    storage: { tankM3: null },
    constants: { rho: 1000, g: 9.81 },
  };
  const water = { input: plannerInput, result: computeWaterEnergy(plannerInput), solarFrom: solar.ok ? solar.provenance : null, note: "Well depth, drawdown and pipe length are hypothetical example ranges, not measurements." };
  // Context cards: GRACE regional water storage and the weather-based dry-season outlook.
  const graceFile = JSON.parse(readFileSync(path.join(ROOT, "data", "reference", "grace-mascon.json"), "utf8")) as GraceFile;
  const cell = graceCell(graceFile, PLACE.lat, PLACE.lon);
  const grace = cell ? { summary: graceSummary(graceFile.months, graceFile.series[String(cell.masconId)]!.lwe, graceFile.series[String(cell.masconId)]!.unc, cell.scale), cell: { lat: cell.cellLat, lon: cell.cellLon, masconId: cell.masconId, scale: cell.scale }, source: { name: graceFile.source, doi: graceFile.doi, citation: graceFile.citation, granule: graceFile.granule, retrievedAt: graceFile.retrievedAt, nativeResolution: graceFile.nativeResolution } } : null;
  const ret = await db.from("evidence_retrievals").select("id, retrieved_at").eq("field_id", fieldId).eq("source_id", "nasa-power-daily").limit(1).single();
  const ser = await db.from("evidence_daily_series").select("variable, start_date, values").eq("retrieval_id", ret.data!.id).in("variable", ["T2M_MAX", "T2M_MIN", "PRECTOTCORR"]);
  const by = Object.fromEntries((ser.data ?? []).map((x) => [x.variable, x]));
  const outlook = { ...drySeasonOutlook({ start: by.T2M_MAX.start_date, tmax: by.T2M_MAX.values, tmin: by.T2M_MIN.values, precip: by.PRECTOTCORR.values }, PLACE.lat), retrievalId: ret.data!.id, retrievedAt: ret.data!.retrieved_at };

  const out = {
    builtAt: new Date().toISOString(),
    place: PLACE,
    illustrativeHistory: "Boro rice (Jan–May) and Aman rice (Jul–Nov), 2023–2025: invented for the example.",
    scenario: { name: "Barind dry season", settings },
    engineVersion: status.data!.engine_version,
    resultSha256: res.data.result_sha256,
    geometry: { boundary, zones: [] },
    result: res.data.result,
    water,
    grace,
    outlook,
  };
  mkdirSync(path.join(ROOT, "data", "example"), { recursive: true });
  writeFileSync(path.join(ROOT, "data", "example", "rajshahi.json"), JSON.stringify(out));
  const r = res.data.result as { soil: { awcMmPerM: number | null; source: string }; runs: { baseline: { label: string } | null; alternatives: { label: string }[]; comparison: { ranking: string[] } | null }[] };
  console.log(JSON.stringify({ soil: r.soil, baseline: r.runs[0]?.baseline?.label, alternatives: r.runs[0]?.alternatives.map((a) => a.label), ranking: r.runs[0]?.comparison?.ranking }));
} finally {
  const del = await admin.auth.admin.deleteUser(userId);
  console.log(del.error ? `cleanup failed: ${del.error.message}` : "test account deleted");
}
