import type { Box } from "@/domain/water/coverage";
import type { OsmElement } from "@/domain/water/surface";

import { fetchText, type Retrieval } from "./http";

/**
 * OpenStreetMap water geometry through the public Overpass API (https://overpass-api.de),
 * © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
 *
 * Usage limits: the public instance is for light, human-driven use. Astrapon sends one bounded
 * query per farmer request (box ≤ field + 10 km, server timeout 25 s, element cap), one at a time
 * per server, caches results for 24 h, and retries 429/5xx with backoff. Production traffic needs a
 * dedicated Overpass instance (OVERPASS_URL is not wired to arbitrary hosts: it must be allowlisted).
 */
export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
/** Public instances listed on the OSM wiki (https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances), asked together: the first good answer wins and the other request is cancelled. */
export const OVERPASS_INSTANCES = [OVERPASS_URL, "https://overpass.private.coffee/api/interpreter"];
export const OVERPASS_ELEMENT_CAP = 2000;

export function buildOverpassQuery(b: Box): string {
  const bb = `(${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)})`;
  return [
    "[out:json][timeout:25][maxsize:67108864];",
    "(",
    `  way["waterway"~"^(river|stream|canal|drain|ditch|riverbank)$"]${bb};`,
    `  way["natural"="water"]${bb};`,
    `  relation["natural"="water"]${bb};`,
    `  way["landuse"="reservoir"]${bb};`,
    `  node["man_made"="water_well"]${bb};`,
    `  node["natural"="spring"]${bb};`,
    ");",
    `out tags geom meta ${OVERPASS_ELEMENT_CAP};`,
  ].join("\n");
}

export type OverpassOutcome =
  | { ok: true; elements: OsmElement[]; osmBase: string | null; truncated: boolean; retrieval: Retrieval; endpoint: string }
  | { ok: false; error: string; status?: number };

/** The longest a farmer waits for this lookup, retries included. Measured 2026-11-09: a small query took 36 s on a busy public server. */
export const OVERPASS_DEADLINE_MS = 60_000;

export function fetchWaterGeometry(box: Box, deadlineMs = OVERPASS_DEADLINE_MS): Promise<OverpassOutcome> {
  const stop = new AbortController();
  return new Promise((resolve) => {
    let waiting = OVERPASS_INSTANCES.length;
    const finish = (outcome: OverpassOutcome) => {
      clearTimeout(deadline);
      stop.abort();
      resolve(outcome);
    };
    const deadline = setTimeout(() => finish({ ok: false, error: `The OpenStreetMap water service did not answer within ${Math.round(deadlineMs / 1000)} seconds.` }), deadlineMs);
    for (const endpoint of OVERPASS_INSTANCES) {
      void fetchFrom(endpoint, box, deadlineMs, stop.signal).then((outcome) => {
        waiting -= 1;
        if (outcome.ok || waiting === 0) finish(outcome);
      });
    }
  });
}

async function fetchFrom(endpoint: string, box: Box, timeoutMs: number, signal: AbortSignal): Promise<OverpassOutcome> {
  const res = await fetchText(endpoint, {
    method: "POST",
    body: new URLSearchParams({ data: buildOverpassQuery(box) }).toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    timeoutMs,
    attempts: 4, // a 502 or 429 comes back within a second; waits of 1, 4 and 9 s stay inside the deadline
    signal,
  });
  if (!res.ok) return { ok: false, error: res.status === 429 || res.status === 504 || res.status === 502 ? `The public OpenStreetMap water service is busy (${res.error}). Try again in a minute.` : `The OpenStreetMap water service did not answer (${res.error}).`, status: res.status };
  let body: { elements?: unknown; osm3s?: { timestamp_osm_base?: string }; remark?: string };
  try {
    body = JSON.parse(res.body);
  } catch {
    return { ok: false, error: "The OpenStreetMap water service returned an unreadable answer." };
  }
  if (!Array.isArray(body.elements)) return { ok: false, error: "The OpenStreetMap water service returned no element list." };
  if (body.remark && /runtime error|timed out|out of memory/i.test(body.remark)) return { ok: false, error: `The OpenStreetMap query did not finish: ${body.remark.slice(0, 160)}` };
  const elements = (body.elements as OsmElement[]).filter((e) => e && (e.type === "node" || e.type === "way" || e.type === "relation") && Number.isFinite(e.id));
  return { ok: true, elements, osmBase: body.osm3s?.timestamp_osm_base ?? null, truncated: elements.length >= OVERPASS_ELEMENT_CAP, retrieval: res.retrieval, endpoint };
}
