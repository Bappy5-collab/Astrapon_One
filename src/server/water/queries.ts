import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EngineResult } from "@/domain/simulation/engine";
import { demandFromResult, type RunDemand } from "@/domain/water/demand";
import type { PlannerInput, PlannerResult } from "@/domain/water/plan";
import type { Database } from "@/server/database/database.types";

type Db = SupabaseClient<Database>;

export type FieldRunDemand = { runId: string; resultSha256: string; scenarioName: string; finishedAt: string | null; engineVersion: string; demand: RunDemand };

/** Finished comparisons of this field, newest first, with the demand derived from each stored result. */
export async function listFieldRunDemands(db: Db, fieldId: string, limit = 6): Promise<FieldRunDemand[]> {
  const { data: snaps, error: e1 } = await db.from("simulation_input_snapshots").select("id, scenarios(name)").eq("field_id", fieldId);
  if (e1) throw new Error(`Could not load comparisons (${e1.code})`);
  if (!snaps.length) return [];
  const names = new Map(snaps.map((s) => [s.id, (s.scenarios as unknown as { name: string } | null)?.name ?? "Comparison"]));
  const { data: runs, error: e2 } = await db
    .from("simulation_runs")
    .select("id, snapshot_id, finished_at, engine_version, simulation_results(result, result_sha256)")
    .in("snapshot_id", [...names.keys()])
    .eq("status", "succeeded")
    .order("finished_at", { ascending: false })
    .limit(limit);
  if (e2) throw new Error(`Could not load comparisons (${e2.code})`);
  const out: FieldRunDemand[] = [];
  for (const r of runs) {
    const res = (Array.isArray(r.simulation_results) ? r.simulation_results[0] : r.simulation_results) as { result: unknown; result_sha256: string } | null;
    if (!res) continue;
    out.push({ runId: r.id, resultSha256: res.result_sha256, scenarioName: names.get(r.snapshot_id) ?? "Comparison", finishedAt: r.finished_at, engineVersion: r.engine_version, demand: demandFromResult(res.result as EngineResult) });
  }
  return out;
}

export type WaterPlanRow = { id: string; version: number; name: string; modelVersion: string; runId: string | null; createdAt: string; inputsSha256: string; resultSha256: string; inputs: PlannerInput; evidence: Record<string, unknown>; result: PlannerResult };

export async function listWaterPlans(db: Db, fieldId: string): Promise<WaterPlanRow[]> {
  const { data, error } = await db.from("water_energy_plans").select("*").eq("field_id", fieldId).order("version", { ascending: false }).limit(30);
  if (error) throw new Error(`Could not load saved water plans (${error.code})`);
  return data.map((r) => ({ id: r.id, version: r.version, name: r.name, modelVersion: r.model_version, runId: r.run_id, createdAt: r.created_at, inputsSha256: r.inputs_sha256, resultSha256: r.result_sha256, inputs: r.inputs as unknown as PlannerInput, evidence: r.evidence as Record<string, unknown>, result: r.result as unknown as PlannerResult }));
}

export async function getWaterPlan(db: Db, planId: string): Promise<(WaterPlanRow & { fieldId: string }) | null> {
  const { data, error } = await db.from("water_energy_plans").select("*").eq("id", planId).maybeSingle();
  if (error) throw new Error(`Could not load the water plan (${error.code})`);
  if (!data) return null;
  return { id: data.id, fieldId: data.field_id, version: data.version, name: data.name, modelVersion: data.model_version, runId: data.run_id, createdAt: data.created_at, inputsSha256: data.inputs_sha256, resultSha256: data.result_sha256, inputs: data.inputs as unknown as PlannerInput, evidence: data.evidence as Record<string, unknown>, result: data.result as unknown as PlannerResult };
}

export type FieldWeatherSeries = {
  retrievalId: string;
  retrievedAt: string;
  productVersion: string | null;
  start: string;
  tmax: (number | null)[];
  tmin: (number | null)[];
  precip: (number | null)[];
  /** Which product the rain is from: NASA IMERG Final Run, else Late Run, when stored for the field, else POWER. Never mixed. */
  rainSource: "gpm-imerg-final" | "gpm-imerg-late" | "nasa-power-daily";
  rainRetrievalId: string;
  rainRetrievedAt: string;
};

/**
 * The newest stored NASA POWER daily series of this field (the same normalised rows the engine
 * pins), or null when none is stored. When NASA IMERG daily rain is stored for the field, one IMERG
 * run replaces POWER rain for the whole series: the gauge-calibrated Final Run when stored, else the
 * Late Run (days outside its record stay missing, never filled from POWER or the other run).
 * Monthly medians need complete months only, so the Final Run's 1998–2025 record suffices. Reads only.
 */
export async function getFieldWeatherSeries(db: Db, fieldId: string): Promise<FieldWeatherSeries | null> {
  const { data: rets, error } = await db
    .from("evidence_retrievals")
    .select("id, retrieved_at, product_version")
    .eq("field_id", fieldId)
    .eq("source_id", "nasa-power-daily")
    .in("outcome", ["valid", "partial"])
    .order("retrieved_at", { ascending: false })
    .limit(3);
  if (error) throw new Error(`Could not load weather (${error.code})`);
  for (const r of rets) {
    const { data: rows, error: e2 } = await db.from("evidence_daily_series").select("variable, start_date, values").eq("retrieval_id", r.id).in("variable", ["T2M_MAX", "T2M_MIN", "PRECTOTCORR"]);
    if (e2) throw new Error(`Could not load weather series (${e2.code})`);
    const by = new Map(rows.map((s) => [s.variable, s]));
    const tx = by.get("T2M_MAX"), tn = by.get("T2M_MIN"), pr = by.get("PRECTOTCORR");
    if (!tx || !tn || !pr) continue;
    if (tx.start_date !== tn.start_date || tx.start_date !== pr.start_date || tx.values.length !== tn.values.length || tx.values.length !== pr.values.length) continue;
    const power = { retrievalId: r.id, retrievedAt: r.retrieved_at, productVersion: r.product_version, start: tx.start_date, tmax: tx.values as (number | null)[], tmin: tn.values as (number | null)[], precip: pr.values as (number | null)[] };
    const imerg = await getFieldImergRain(db, fieldId);
    if (!imerg) return { ...power, rainSource: "nasa-power-daily", rainRetrievalId: r.id, rainRetrievedAt: r.retrieved_at };
    const offset = Math.round((Date.parse(`${power.start}T00:00:00Z`) - Date.parse(`${imerg.start}T00:00:00Z`)) / 86_400_000);
    const precip = power.precip.map((_, k) => imerg.values[k + offset] ?? null);
    return { ...power, precip, rainSource: imerg.run === "final" ? "gpm-imerg-final" : "gpm-imerg-late", rainRetrievalId: imerg.retrievalId, rainRetrievedAt: imerg.retrievedAt };
  }
  return null;
}

/** The newest stored NASA GPM IMERG daily rain of this field (Final Run when stored, else Late Run), or null. */
async function getFieldImergRain(db: Db, fieldId: string): Promise<{ retrievalId: string; retrievedAt: string; run: "final" | "late"; start: string; values: (number | null)[] } | null> {
  const { data: rets, error } = await db
    .from("evidence_retrievals")
    .select("id, retrieved_at")
    .eq("field_id", fieldId)
    .eq("source_id", "gpm-imerg-daily")
    .in("outcome", ["valid", "partial"])
    .order("retrieved_at", { ascending: false })
    .limit(1);
  if (error || !rets[0]) return null;
  const { data: rows } = await db.from("evidence_daily_series").select("variable, start_date, values").eq("retrieval_id", rets[0].id).in("variable", ["IMERG_FINAL_PRECIP", "IMERG_LATE_PRECIP"]);
  const row = rows?.find((r) => r.variable === "IMERG_FINAL_PRECIP") ?? rows?.find((r) => r.variable === "IMERG_LATE_PRECIP");
  if (!row) return null;
  return { retrievalId: rets[0].id, retrievedAt: rets[0].retrieved_at, run: row.variable === "IMERG_FINAL_PRECIP" ? "final" : "late", start: row.start_date, values: row.values as (number | null)[] };
}
