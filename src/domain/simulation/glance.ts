/**
 * Plain "at a glance" view of a stored comparison and the list of inputs that would make it more
 * complete. Pure: reads only the stored result; nothing is recomputed.
 */

import type { EngineResult, RunView } from "./engine";
import { indicatorTable, optionsOf } from "./view";

export type GlanceTopic = "water" | "dry_years" | "bare" | "variety";

export type GlanceTile = {
  topic: GlanceTopic;
  key: string;
  unit: string;
  /** Current rotation's value; null when the existing practice is unknown. */
  now: number | null;
  top: number;
  better: "high" | "low";
  /** top − now (null without a baseline). */
  delta: number | null;
  /** Relative change in % of |now| (null without a baseline or when now is 0). */
  pct: number | null;
  /** "better" | "worse" | "same" against the current rotation (null without a baseline). */
  verdict: "better" | "worse" | "same" | null;
};

/** First available indicator per topic, in this order. */
const TOPICS: { topic: GlanceTopic; keys: string[] }[] = [
  { topic: "water", keys: ["irrigation_requirement", "relative_water_supply", "climatic_water_balance"] },
  { topic: "dry_years", keys: ["irrigation_dry_gap", "water_supply_dry_gap", "climatic_dry_gap"] },
  { topic: "bare", keys: ["bare_days"] },
  { topic: "variety", keys: ["crop_diversity", "legume_plantings"] },
];

export function glance(run: RunView): { topId: string; baselineId: string | null; tiles: GlanceTile[] } | null {
  const cmp = run.comparison;
  const defs = run.indicatorDefinitions;
  if (!cmp || !defs || !cmp.ranking.length) return null;
  const topId = cmp.ranking[0]!;
  const table = indicatorTable(run);
  const baselineId = run.baseline?.id ?? null;
  const tiles: GlanceTile[] = [];
  for (const t of TOPICS) {
    for (const key of t.keys) {
      const def = defs.find((d) => d.key === key);
      const top = table[topId]?.[key];
      if (!def || top == null) continue;
      const now = baselineId && baselineId !== topId ? table[baselineId]?.[key] ?? null : baselineId === topId ? top : null;
      const delta = now == null ? null : top - now;
      const verdict = delta == null ? null : Math.abs(delta) < 1e-9 ? "same" : (def.better === "high" ? delta > 0 : delta < 0) ? "better" : "worse";
      tiles.push({ topic: t.topic, key, unit: def.unit, now, top, better: def.better, delta, pct: now == null || delta == null || Math.abs(now) < 1e-9 ? null : (delta / Math.abs(now)) * 100, verdict });
      break;
    }
  }
  return { topId, baselineId, tiles };
}

export type FixCode = "unknown_crops" | "no_weather" | "no_soil" | "no_history" | "no_feasible";
export type FixItem = { code: FixCode; detail: string[]; blocking: boolean };

/**
 * What the farmer can add to get a (more complete) comparison, derived from the stored result's
 * structured fields. `blocking` items explain why nothing could be compared.
 */
export function fixList(result: EngineResult): FixItem[] {
  const out: FixItem[] = [];
  const run = result.runs[0] ?? null;
  const compared = !!run?.comparison && optionsOf(run).length > 0;
  const unknown = result.search.cropRejections.filter((c) => c.code === "unknown_crop").map((c) => c.crop);
  if (unknown.length) out.push({ code: "unknown_crops", detail: unknown, blocking: !compared });
  if (!result.evidence.weatherRetrievalId) out.push({ code: "no_weather", detail: [], blocking: !compared });
  if (result.soil.awcMmPerM == null) out.push({ code: "no_soil", detail: [], blocking: false });
  if (run && !run.baseline) out.push({ code: "no_history", detail: [], blocking: false });
  if (!compared && result.search.feasible === 0 && !unknown.length) out.push({ code: "no_feasible", detail: Object.keys(result.search.rejectionCounts), blocking: true });
  return out;
}

