/**
 * Simulation runs, processed by the background worker (scripts/evidence-worker.mts) with the
 * trusted SUPABASE_DB_URL connection. Builds the engine input only from immutable rows the snapshot
 * pins, verifies the pinned hashes, runs the pure engine and stores the result.
 */
import { createHash } from "node:crypto";

import type postgres from "postgres";

import { canonicalJson } from "../src/domain/reference/canonical.ts";
import { runEngine } from "../src/domain/simulation/engine.ts";
import { ENGINE_VERSION } from "../src/domain/simulation/engine-version.ts";
import type { EngineInput } from "../src/domain/simulation/inputs.ts";

export type RunRow = { id: string; owner_id: string; snapshot_id: string; engine_version: string };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const STALE_RUNNING = "10 minutes";

export async function claimRun(sql: postgres.Sql): Promise<RunRow | null> {
  // A run left "running" by a stopped worker is closed honestly rather than silently retried.
  await sql`update public.simulation_runs set status = 'failed', finished_at = now(), error_message = 'The worker stopped while this run was in progress. Run it again.'
             where status = 'running' and started_at < now() - ${STALE_RUNNING}::interval`;
  const rows = await sql<RunRow[]>`
    update public.simulation_runs r set status = 'running', started_at = now()
     where r.id = (select q.id from public.simulation_runs q where q.status = 'queued' and q.engine_version = ${ENGINE_VERSION} order by q.queued_at for update skip locked limit 1)
    returning r.id, r.owner_id, r.snapshot_id, r.engine_version`;
  return rows[0] ?? null;
}

class RunInputError extends Error {}

export async function loadEngineInput(sql: postgres.Sql, run: RunRow): Promise<EngineInput> {
  const [snap] = await sql<{ id: string; inputs: unknown; inputs_sha256: string; engine_version: string; owner_id: string }[]>`
    select id, inputs, inputs_sha256, engine_version, owner_id from public.simulation_input_snapshots where id = ${run.snapshot_id}`;
  if (!snap) throw new RunInputError("The input snapshot no longer exists.");
  if (snap.owner_id !== run.owner_id) throw new RunInputError("Snapshot owner mismatch.");
  const [check] = await sql<{ h: string }[]>`select encode(sha256(convert_to(inputs::text, 'UTF8')), 'hex') as h from public.simulation_input_snapshots where id = ${snap.id}`;
  if (check?.h !== snap.inputs_sha256) throw new RunInputError("The snapshot's stored hash does not match its contents.");

  const datasets = await sql<{ id: string; kind: string; name: string; version: number; content_sha256: string; pinned: string }[]>`
    select d.id, d.kind, d.name, d.version, d.content_sha256, p.dataset_sha256 as pinned
      from public.snapshot_reference_datasets p join public.reference_datasets d on d.id = p.dataset_id
     where p.snapshot_id = ${snap.id}`;
  const loadItems = async (kind: string) => {
    const d = datasets.find((x) => x.kind === kind);
    if (!d) return null;
    if (d.pinned !== d.content_sha256) throw new RunInputError(`Pinned ${kind} dataset hash mismatch.`);
    const items = await sql<{ payload: unknown }[]>`select payload from public.reference_items where dataset_id = ${d.id} order by item_key`;
    return { id: d.id, name: d.name, version: d.version, sha256: d.content_sha256, items: items.map((i) => i.payload) };
  };

  const loadAll = async (kind: string) => {
    const out = [];
    for (const d of datasets.filter((x) => x.kind === kind).sort((a, b) => a.name.localeCompare(b.name))) {
      if (d.pinned !== d.content_sha256) throw new RunInputError(`Pinned ${kind} dataset ${d.name} hash mismatch.`);
      const items = await sql<{ payload: unknown }[]>`select payload from public.reference_items where dataset_id = ${d.id} order by item_key`;
      out.push({ id: d.id, name: d.name, version: d.version, sha256: d.content_sha256, items: items.map((i) => i.payload) });
    }
    return out;
  };

  // Started now and awaited below: the reference tables load while the evidence is verified.
  const cropDataset = loadItems("crop_parameters");
  const calendarDatasets = loadAll("crop_calendar");
  void Promise.all([cropDataset, calendarDatasets]).catch(() => undefined);

  const pins = await sql<{ retrieval_id: string; source_id: string; product_version: string | null; pinned_response: string; response_sha256: string; pinned_aggregates: string; aggregates_now: string }[]>`
    select p.retrieval_id, r.source_id, r.product_version, p.response_sha256 as pinned_response, r.response_sha256,
           p.aggregates_sha256 as pinned_aggregates, private.aggregates_sha256(r.id) as aggregates_now
      from public.snapshot_evidence_retrievals p join public.evidence_retrievals r on r.id = p.retrieval_id
     where p.snapshot_id = ${snap.id}`;
  for (const p of pins) {
    if (p.pinned_response !== p.response_sha256 || p.pinned_aggregates !== p.aggregates_now) throw new RunInputError(`Pinned evidence ${p.source_id} no longer matches its hashes.`);
  }

  let weather: EngineInput["weather"] = null;
  const power = pins.find((p) => p.source_id === "nasa-power-daily");
  if (power) {
    const series = await sql<{ variable: string; start_date: string; values: (number | null)[]; values_sha256: string; h: string }[]>`
      -- array_to_json keeps NULL as null (the driver would turn a NULL array element into NaN).
      select variable, to_char(start_date, 'YYYY-MM-DD') as start_date, array_to_json("values") as "values", values_sha256,
             encode(sha256(convert_to(start_date::text || ':' || array_to_string("values", ',', 'null'), 'UTF8')), 'hex') as h
        from public.evidence_daily_series where retrieval_id = ${power.retrieval_id}`;
    const by = new Map(series.map((s) => [s.variable, s]));
    const tx = by.get("T2M_MAX");
    const tn = by.get("T2M_MIN");
    const pr = by.get("PRECTOTCORR");
    if (tx && tn && pr) {
      for (const s of [tx, tn, pr]) if (s.h !== s.values_sha256) throw new RunInputError(`Daily series ${s.variable} hash mismatch.`);
      if (tx.start_date !== tn.start_date || tx.start_date !== pr.start_date || tx.values.length !== tn.values.length || tx.values.length !== pr.values.length)
        throw new RunInputError("Daily series are not aligned.");
      weather = { retrievalId: power.retrieval_id, productVersion: power.product_version, start: tx.start_date, tmax: tx.values, tmin: tn.values, precip: pr.values };
      // 1.3.0: Penman-Monteith inputs, when this retrieval stored them (evidence-1.2.0) and the cell elevation is known.
      const td = by.get("T2MDEW"), ws = by.get("WS2M"), rs = by.get("ALLSKY_SFC_SW_DWN");
      if (td && ws && rs) {
        for (const s of [td, ws, rs]) if (s.h !== s.values_sha256) throw new RunInputError(`Daily series ${s.variable} hash mismatch.`);
        const aligned = [td, ws, rs].every((s) => s.start_date === tx.start_date && s.values.length === tx.values.length);
        const [meta] = await sql<{ elevation: number | null }[]>`select (provenance->>'elevationM')::double precision as elevation from public.evidence_retrievals where id = ${power.retrieval_id}`;
        if (aligned && meta?.elevation != null) weather = { ...weather, tdew: td.values, wind: ws.values, rs: rs.values, elevationM: meta.elevation };
      }
    }
  }
  // 1.4.0: NASA IMERG daily rain (Final and Late Run) from its own pinned retrieval. The engine picks one
  // product for the whole run when it covers the replay window; nothing is merged into the POWER rows.
  let rain: EngineInput["rain"] = null;
  const imerg = pins.find((p) => p.source_id === "gpm-imerg-daily");
  if (imerg && weather) {
    const rows = await sql<{ variable: string; start_date: string; values: (number | null)[]; values_sha256: string; h: string }[]>`
      select variable, to_char(start_date, 'YYYY-MM-DD') as start_date, array_to_json("values") as "values", values_sha256,
             encode(sha256(convert_to(start_date::text || ':' || array_to_string("values", ',', 'null'), 'UTF8')), 'hex') as h
        from public.evidence_daily_series where retrieval_id = ${imerg.retrieval_id} and variable in ('IMERG_FINAL_PRECIP', 'IMERG_LATE_PRECIP')`;
    for (const r of rows) if (r.h !== r.values_sha256) throw new RunInputError(`Daily series ${r.variable} hash mismatch.`);
    const pick = (v: string) => { const r = rows.find((x) => x.variable === v); return r ? { start: r.start_date, values: r.values } : null; };
    const final = pick("IMERG_FINAL_PRECIP"), late = pick("IMERG_LATE_PRECIP");
    if (final || late) rain = { retrievalId: imerg.retrieval_id, productVersion: imerg.product_version, final, late };
  }
  let soilSurvey: EngineInput["soilSurvey"] = null;
  const ssurgo = pins.find((p) => p.source_id === "usda-ssurgo-sda");
  if (ssurgo) {
    const [a] = await sql<{ value: number | null }[]>`
      select value::double precision as value from public.evidence_aggregates where retrieval_id = ${ssurgo.retrieval_id} and variable = 'awc_0_100cm' and pixel = '' limit 1`;
    soilSurvey = { retrievalId: ssurgo.retrieval_id, awcMm0to100: a?.value ?? null, source: "usda-ssurgo-sda" };
  }
  // 1.3.0: outside the US survey, the SoilGrids 2.0 water-retention estimate (250 m model) when pinned.
  const sg = pins.find((p) => p.source_id === "isric-soilgrids-v2");
  if (sg && soilSurvey?.awcMm0to100 == null) {
    const [a] = await sql<{ value: number | null }[]>`
      select value::double precision as value from public.evidence_aggregates where retrieval_id = ${sg.retrieval_id} and variable = 'awc_0_100cm' limit 1`;
    if (a?.value != null) soilSurvey = { retrievalId: sg.retrieval_id, awcMm0to100: a.value, source: "isric-soilgrids-v2" };
  }

  return {
    engineVersion: snap.engine_version,
    snapshot: { id: snap.id, inputsSha256: snap.inputs_sha256, inputs: snap.inputs as EngineInput["snapshot"]["inputs"] },
    cropDataset: (await cropDataset) as EngineInput["cropDataset"],
    calendarDataset: null,
    calendarDatasets: (await calendarDatasets) as EngineInput["calendarDatasets"],
    weather,
    rain,
    soilSurvey,
  };
}

export async function processRun(sql: postgres.Sql, run: RunRow): Promise<{ ok: boolean; message: string; ms: number }> {
  const t0 = performance.now();
  try {
    if (run.engine_version !== ENGINE_VERSION) throw new RunInputError(`This worker runs engine ${ENGINE_VERSION}; the run needs ${run.engine_version}.`);
    const input = await loadEngineInput(sql, run);
    const inputDigest = sha(canonicalJson(input));
    const result = { ...runEngine(input), inputDigest };
    const ms = Math.round(performance.now() - t0);
    const stored = await sql.begin(async (tx) => {
      const [still] = await tx`select 1 from public.simulation_runs where id = ${run.id} and status = 'running' for update`;
      if (!still) return false;
      await tx`insert into public.simulation_results (run_id, owner_id, engine_version, result) values (${run.id}, ${run.owner_id}, ${run.engine_version}, ${tx.json(result as unknown as postgres.JSONValue)})`;
      await tx`update public.simulation_runs set status = 'succeeded', finished_at = now(), compute_ms = ${ms}, input_digest = ${inputDigest} where id = ${run.id}`;
      return true;
    });
    return { ok: true, message: stored ? `succeeded (${result.status}) in ${ms} ms` : "cancelled meanwhile", ms };
  } catch (e) {
    const message = (e instanceof RunInputError ? e.message : `Engine error: ${e instanceof Error ? e.message : String(e)}`).slice(0, 1000);
    await sql`update public.simulation_runs set status = 'failed', finished_at = now(), error_message = ${message} where id = ${run.id} and status = 'running'`;
    return { ok: false, message, ms: Math.round(performance.now() - t0) };
  }
}
