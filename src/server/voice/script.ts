import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { BoundaryGeometry } from "@/domain/geo/boundary";
import type { EngineResult } from "@/domain/simulation/engine";
import { voiceScript, type VoiceDrySeason, type VoiceLine } from "@/domain/simulation/voice-script";
import { demandFromResult } from "@/domain/water/demand";
import { fieldFrame } from "@/domain/water/distance";
import { drySeasonOutlook, needInMonths } from "@/domain/water/dryseason";
import { formatterFor } from "@/lib/i18n/format";
import { MESSAGES, translate, type Locale, type MessageKey } from "@/lib/i18n/messages";
import { fmt } from "@/lib/i18n/sim-messages";
import type { Database } from "@/server/database/database.types";
import { getFieldWeatherSeries } from "@/server/water/queries";

type Db = SupabaseClient<Database>;

/**
 * The spoken summary of a run in one language. The page and the audio route both call this, so the
 * caption on screen and the audio are always the same sentence. Every read goes through the
 * caller's own client (RLS); the cache is keyed by the stored result hash, which only the owner can
 * read, so a cached script is never handed to someone who cannot read the run.
 */
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; lines: VoiceLine[] }>();

export async function runVoiceLines(db: Db, runId: string, locale: Locale): Promise<VoiceLine[] | null> {
  const res = await db.from("simulation_results").select("result, result_sha256").eq("run_id", runId).maybeSingle();
  if (res.error || !res.data) return null;
  const key = `${res.data.result_sha256}|${runId}|${locale}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.lines;

  const result = res.data.result as unknown as EngineResult;
  const dry = await drySeasonFor(db, runId, result).catch(() => null);
  const has = (k: string): k is MessageKey => k in MESSAGES.en;
  const lines = voiceScript(result.runs[0], { t: (k) => (has(k) ? translate(locale, k) : null), f: formatterFor(locale), fill: fmt, dry, irrigationMode: result.irrigationMode });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), lines });
  return lines;
}

/** The field's dry season from its stored NASA POWER series, and the top option's need in it. */
async function drySeasonFor(db: Db, runId: string, result: EngineResult): Promise<VoiceDrySeason | null> {
  const run = await db.from("simulation_runs").select("simulation_input_snapshots(field_id)").eq("id", runId).maybeSingle();
  const fieldId = (run.data?.simulation_input_snapshots as unknown as { field_id: string } | null)?.field_id;
  if (!fieldId) return null;
  const [field, geometry, weather] = await Promise.all([
    db.from("fields").select("area_ha").eq("id", fieldId).maybeSingle(),
    db.rpc("field_geometry", { p_field_id: fieldId }),
    getFieldWeatherSeries(db, fieldId),
  ]);
  const boundary = (geometry.data as unknown as { boundary: BoundaryGeometry | null } | null)?.boundary;
  if (!weather || !boundary) return null;
  const outlook = drySeasonOutlook(weather, fieldFrame(boundary).origin[1]);
  if (outlook.status !== "ok") return null;

  // Net irrigation of the option ranked first in the dry months, on this field's area.
  let dryNeedM3: number | null = null;
  const topId = result.runs[0]?.comparison?.ranking[0];
  const option = demandFromResult(result).options.find((o) => o.optionId === topId);
  const areaHa = Number(field.data?.area_ha) || 0;
  if (option && !option.unavailable && areaHa > 0 && outlook.dryMonths.length) {
    dryNeedM3 = needInMonths(
      option.months.map((m) => ({ key: m.key, grossM3: m.netMm == null ? null : m.netMm * areaHa * 10 })),
      outlook.dryMonths,
      Math.max(1, option.window?.years.length ?? 1),
    );
  }
  return { noDrySeason: outlook.noDrySeason, dryMonths: outlook.dryMonths, lowestMonth: outlook.lowestMonth, dryNeedM3 };
}
