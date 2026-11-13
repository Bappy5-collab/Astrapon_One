"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { ENGINE_VERSION } from "@/domain/simulation/engine-version";
import type { FormState } from "@/lib/forms/state";
import { getT } from "@/lib/i18n/server";
import { getAuth } from "@/server/auth/session";
import { describeDbError } from "@/server/database/errors";
import { updateScenario } from "@/server/farm/actions";
import { dispatchWorker } from "@/server/worker/dispatch";

export type SimulationActionResult = { ok: boolean; message: string; runId?: string; auth?: boolean };

async function signedIn() {
  const auth = await getAuth();
  if (auth.state !== "signed_in") return { error: (auth.state === "unreachable" ? { ok: false, message: "The account service did not respond. Try again." } : { ok: false, message: "Your session has ended. Sign in again.", auth: true }) as SimulationActionResult };
  return { auth };
}

/**
 * Freezes the scenario's current inputs (reusing the newest snapshot when nothing changed) and
 * queues a run. Only enqueues: the background worker runs the engine, so this returns at once.
 */
export async function requestSimulation(scenarioId: string): Promise<SimulationActionResult> {
  const u = await signedIn();
  if (u.error) return u.error;
  if (!z.uuid().safeParse(scenarioId).success) return { ok: false, message: "Unknown scenario." };
  const { data, error } = await u.auth.supabase.rpc("request_simulation", { p_scenario_id: scenarioId, p_engine_version: ENGINE_VERSION });
  if (error) return { ok: false, message: describeDbError(error) };
  after(dispatchWorker);
  revalidatePath(`/scenarios/${scenarioId}`);
  revalidatePath("/runs");
  return { ok: true, message: "Run queued.", runId: data as string };
}

/** The comparison form's one action: always saves, and starts a run when the farmer pressed the start button. */
export async function saveAndRun(scenarioId: string, state: FormState, fd: FormData): Promise<FormState> {
  const saved = await updateScenario(scenarioId, state, fd);
  if (saved.status !== "success") return saved;
  const t = await getT();
  if (fd.get("intent") !== "run") return { status: "success", message: t("cmp.saved") };
  const run = await requestSimulation(scenarioId);
  return run.ok ? { status: "success", message: t("cmp.started") } : { status: "error", message: run.message };
}

/** Queues another run on the same frozen snapshot, so its result can be compared with the stored one. */
export async function reproduceRun(runId: string): Promise<SimulationActionResult> {
  const u = await signedIn();
  if (u.error) return u.error;
  if (!z.uuid().safeParse(runId).success) return { ok: false, message: "Unknown run." };
  const { data: run, error: e1 } = await u.auth.supabase.from("simulation_runs").select("snapshot_id, engine_version").eq("id", runId).maybeSingle();
  if (e1) return { ok: false, message: describeDbError(e1) };
  if (!run) return { ok: false, message: "Run not found." };
  if (run.engine_version !== ENGINE_VERSION) return { ok: false, message: `That run used engine ${run.engine_version}; this server runs ${ENGINE_VERSION}, so it cannot be reproduced here.` };
  const { data, error } = await u.auth.supabase.from("simulation_runs").insert({ snapshot_id: run.snapshot_id, engine_version: run.engine_version }).select("id").single();
  if (error) return { ok: false, message: error.code === "23505" ? "A run of this snapshot is already queued." : describeDbError(error) };
  after(dispatchWorker);
  revalidatePath("/runs");
  return { ok: true, message: "Re-run queued on the same frozen inputs.", runId: data.id };
}

export async function cancelRun(runId: string): Promise<SimulationActionResult> {
  const u = await signedIn();
  if (u.error) return u.error;
  if (!z.uuid().safeParse(runId).success) return { ok: false, message: "Unknown run." };
  const { data, error } = await u.auth.supabase.from("simulation_runs").update({ status: "cancelled" }).eq("id", runId).in("status", ["queued", "running"]).select("id");
  if (error) return { ok: false, message: describeDbError(error) };
  revalidatePath("/runs");
  return data.length ? { ok: true, message: "Cancelled." } : { ok: false, message: "That run had already finished." };
}
