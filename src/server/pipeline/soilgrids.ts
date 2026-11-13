import { round } from "@/domain/evidence/aggregate";
import { PROCESSING_VERSION } from "@/domain/evidence/catalog";
import { check, type Check } from "@/server/providers/http";
import { fetchSoilGrids, type SoilValue } from "@/server/providers/soilgrids";
import { fetchWcsMean } from "@/server/providers/soilgrids-wcs";

import { cacheKey, combinedSha } from "./cache";
import { PipelineError, type FieldContext, type PipelineOutput, type Progress } from "./types";

/** Depth layers inside the top metre and their thickness (cm). */
export const AWC_DEPTHS = [
  { label: "0-5cm", cm: 5 },
  { label: "5-15cm", cm: 10 },
  { label: "15-30cm", cm: 15 },
  { label: "30-60cm", cm: 30 },
  { label: "60-100cm", cm: 40 },
] as const;

/**
 * Plant-available water in the top 100 cm (mm) from SoilGrids water content at field capacity
 * (33 kPa, wv0033) and wilting point (1500 kPa, wv1500), both in vol %: Σ (FC − WP)/100 × thickness.
 * Uses the layer means (quantiles cannot be subtracted). Null when any layer is missing.
 */
export function awcFromSoilGrids(values: SoilValue[]): { awcMm: number | null; layers: { depth: string; fc: number | null; wp: number | null; mm: number | null }[] } {
  const layers = AWC_DEPTHS.map((d) => {
    const fc = values.find((v) => v.property === "wv0033" && v.depth === d.label)?.mean ?? null;
    const wp = values.find((v) => v.property === "wv1500" && v.depth === d.label)?.mean ?? null;
    const mm = fc == null || wp == null ? null : (Math.max(0, fc - wp) / 100) * d.cm * 10;
    return { depth: d.label, fc, wp, mm };
  });
  const awcMm = layers.every((l) => l.mm != null) ? round(layers.reduce((a, l) => a + l.mm!, 0), 0) : null;
  return { awcMm, layers };
}

/** WCS boxes tried after the REST point: the 250 m pixels within about 330 m, then about 1.3 km (masked towns, rivers). */
const WCS_BOXES = [0.003, 0.012] as const;
/** The REST point is preferred only if it answers this quickly; it has taken up to two minutes (2026-11-09), while the WCS answers in seconds. */
const REST_BUDGET_MS = 4000;

const wcsRequests = (half: number, lat: number, lon: number) => AWC_DEPTHS.flatMap((d) => (["wv0033", "wv1500"] as const).map((property) => ({ property, depth: d.label, r: fetchWcsMean(property, d.label, lat, lon, half) })));

type Layer = { property: "wv0033" | "wv1500"; depth: string; mean: number | null };
const toValues = (ls: Layer[]): SoilValue[] => ls.map((l) => ({ property: l.property, depth: l.depth, units: "vol%", q05: null, q50: null, q95: null, mean: l.mean }));

/**
 * ISRIC SoilGrids 2.0 water retention (wv0033, wv1500) for the field, as the root-zone available
 * water capacity used outside SSURGO coverage. Route: the REST point query at the field centre;
 * when it is paused, slow or masked, the WCS (same layers) averaged over the valid 250 m pixels
 * within about 330 m, then about 1.3 km. The route and distance used are recorded. A model
 * estimate, never a measurement; a farmer's soil test and the US survey both take precedence.
 */
export async function runSoilGrids(ctx: FieldContext, progress: Progress): Promise<PipelineOutput> {
  const checks: Check[] = [];
  const shas: string[] = [];
  let bytes = 0;
  const { lat, lon } = ctx.centroid;
  let used: { route: "rest" | "wcs"; values: SoilValue[]; retrievedAt: string; support: string; boxDeg: number | null } | null = null;
  let restNote = "";

  await progress({ step: "Soil water retention (SoilGrids)", done: 0, total: 3 });
  // The WCS starts alongside the REST point, so a slow REST answer costs no extra time.
  const nearby = wcsRequests(WCS_BOXES[0], lat, lon);
  void Promise.all(nearby.map((n) => n.r)).catch(() => undefined);
  const rest = await fetchSoilGrids(round(lat, 5), round(lon, 5), ["wv0033", "wv1500"], AWC_DEPTHS.map((d) => d.label), { timeoutMs: REST_BUDGET_MS, attempts: 1 });
  if (rest.ok) {
    shas.push(rest.retrieval.bodySha256);
    bytes += rest.retrieval.bodyBytes;
    // REST checks count only when its values are used; an all-null answer is recorded in the route note instead.
    if (awcFromSoilGrids(rest.values).awcMm != null) {
      for (const c of rest.checks) checks.push({ ...c, id: `rest:${c.id}` });
      used = { route: "rest", values: rest.values, retrievedAt: rest.retrieval.retrievedAt, support: "One 250 m SoilGrids pixel at the field centre (REST point query)", boxDeg: null };
    } else restNote = "REST answered with no water-retention values at the field centre (masked pixel or paused backend)";
  } else restNote = `REST did not answer: ${rest.error}`;

  for (const [k, half] of WCS_BOXES.entries()) {
    if (used) break;
    const m = Math.round(half * 111_000);
    await progress({ step: `Soil water retention (SoilGrids WCS, within about ${m} m)`, done: k + 1, total: 3 });
    const layers: Layer[] = [];
    let retrievedAt = "";
    let minPixels = Infinity;
    const requests = k === 0 ? nearby : wcsRequests(half, lat, lon);
    const answers = await Promise.all(requests.map((n) => n.r));
    for (const [i, r] of answers.entries()) {
      if (!r.ok) throw new PipelineError(`ISRIC SoilGrids did not answer (${restNote}; WCS: ${r.error})`, "unavailable");
      shas.push(r.sha256);
      bytes += r.bytes;
      retrievedAt ||= r.retrievedAt;
      minPixels = Math.min(minPixels, r.pixels);
      layers.push({ property: requests[i]!.property, depth: requests[i]!.depth, mean: r.value });
    }
    const values = toValues(layers);
    if (awcFromSoilGrids(values).awcMm != null) {
      used = { route: "wcs", values, retrievedAt, support: `Mean of the valid 250 m SoilGrids pixels within about ${m} m of the field centre (WCS; at least ${minPixels} pixel(s) per layer)`, boxDeg: half };
      checks.push(check("route", true, `${restNote}; used the WCS within about ${m} m`));
    }
  }
  if (!used) throw new PipelineError(`SoilGrids has no water-retention values within about 1.3 km of the field (water, built-up land or a paused service). ${restNote}.`, "not_applicable");
  const { awcMm, layers } = awcFromSoilGrids(used.values);
  checks.push(check("fc-above-wp", layers.every((l) => l.fc != null && l.wp != null && l.fc >= l.wp), "field capacity ≥ wilting point in every layer"));
  checks.push(check("awc-plausible", awcMm != null && awcMm > 0 && awcMm < 400, `${awcMm} mm in 0–100 cm`));
  const today = used.retrievedAt.slice(0, 10);
  return {
    retrieval: {
      sourceId: "isric-soilgrids-v2",
      productId: "SoilGrids 2.0 wv0033/wv1500",
      productVersion: "2.0",
      evidenceClass: "assimilated_model_product",
      spatialSupport: used.support,
      request: { route: used.route, rest: "https://rest.isric.org/soilgrids/v2.0/properties/query", wcs: "https://maps.isric.org/mapserv", properties: ["wv0033", "wv1500"], depths: AWC_DEPTHS.map((d) => d.label), value: "mean", latitude: lat, longitude: lon, boxDeg: used.boxDeg, restNote: restNote || null },
      retrievedAt: used.retrievedAt,
      responseSha256: combinedSha(shas),
      responseBytes: bytes,
      outcome: checks.every((c) => c.passed) ? "valid" : "partial",
      checks,
      provenance: {
        evidenceClass: "assimilated_model_product",
        source: "ISRIC SoilGrids 2.0 (machine-learning predictions from soil profiles and covariates), CC-BY 4.0; Poggio et al. 2021, doi:10.5194/soil-7-217-2021",
        method: "AWC = Σ (θ33 kPa − θ1500 kPa) × layer thickness over 0–100 cm, layer means",
        route: used.route,
        layers,
      },
      cacheKey: cacheKey({ source: "isric-soilgrids-v2", lat: round(lat, 4), lon: round(lon, 4), route: used.route, processing: PROCESSING_VERSION }),
      processingVersion: PROCESSING_VERSION,
      observationStart: today,
      observationEnd: today,
    },
    aggregates: [{ variable: "awc_0_100cm", unit: "mm", aggregation: "mean", periodStart: today, periodEnd: today, value: awcMm, validCount: layers.filter((l) => l.mm != null).length, expectedCount: layers.length, pixel: "" }],
  };
}
