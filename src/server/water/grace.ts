import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { graceCell, graceSummary, type GraceContext, type GraceFile } from "@/domain/water/grace";

let cache: Promise<GraceFile | null> | null = null;

/** The stored GRACE/GRACE-FO mascon extract (built by `pnpm grace:fetch`); null when absent. */
function load(): Promise<GraceFile | null> {
  cache ??= readFile(path.join(process.cwd(), "data", "reference", "grace-mascon.json"), "utf8")
    .then((t) => JSON.parse(t) as GraceFile)
    .catch(() => null);
  return cache;
}

/** Regional water-storage context for a point; null over ocean, without the extract, or with too few months. */
export async function graceContext(lat: number, lon: number): Promise<GraceContext | null> {
  const f = await load();
  if (!f) return null;
  const c = graceCell(f, lat, lon);
  if (!c) return null;
  const s = f.series[String(c.masconId)];
  if (!s) return null;
  const summary = graceSummary(f.months, s.lwe, s.unc, c.scale);
  if (!summary) return null;
  return {
    summary,
    cell: { lat: c.cellLat, lon: c.cellLon, masconId: c.masconId, scale: c.scale },
    source: { name: f.source, doi: f.doi, citation: f.citation, granule: f.granule, retrievedAt: f.retrievedAt, nativeResolution: f.nativeResolution },
  };
}
