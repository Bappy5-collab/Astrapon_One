/**
 * IMERG pipeline without network: global fetch answers like CMR and NASA Harmony (TEST DATA,
 * synthetic rain), and the cache points at a temporary directory.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "fs-imerg-"));
process.env.ASTRAPON_CACHE_DIR = dir;
process.env.ASTRAPON_RETRY_BASE_MS = "1";
const { runImerg } = await import("./imerg");
const { pipelineErrorKind } = await import("./types");
type FieldContext = import("./types").FieldContext;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const field = { fieldId: "f1", centroid: { lat: 24.62, lon: 88.56 }, boundary: { type: "Polygon", coordinates: [] } as unknown as FieldContext["boundary"], countryCode: "BD" };
const NOW = new Date("2026-11-13T00:00:00Z");
let calls: string[] = [];
let token: string | null = null;
let denyFinal = false;

function csv(variable: string, start: string, end: string, value: (i: number) => number) {
  const lines = [`User Start Date:,${start}T00:00:00.000Z`, `User End Date:,${end}T00:00:00.000Z`, 'User Bounding Box:,"88.525, 24.625, 88.575, 24.675"', "Fill Value:,-9999.900390625", ",", `time,mean_${variable}`];
  for (let d = Date.parse(`${start}T00:00:00Z`), i = 0; d <= Date.parse(`${end}T00:00:00Z`); d += 86_400_000, i++) lines.push(`${new Date(d).toISOString().slice(0, 19)},${value(i)}`);
  return lines.join("\n") + "\n";
}

beforeEach(() => {
  calls = [];
  token = null;
  denyFinal = false;
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url.hostname + url.pathname);
    token = (init?.headers as Record<string, string> | undefined)?.Authorization ?? token;
    if (url.hostname === "cmr.earthdata.nasa.gov") return Response.json({ feed: { entry: [{ time_start: "2025-09-30T00:00:00.000Z" }] } });
    const m = url.pathname.match(/^\/(C\d+-GES_DISC)\/ogc-api-coverages\/1\.0\.0\/collections\/(\w+)\/coverage\/rangeset$/);
    if (m) {
      if (denyFinal && m[2]!.includes("DF")) return new Response("forbidden", { status: 403 });
      const [, s, e] = url.searchParams.getAll("subset")[2]!.match(/"(\d{4}-\d{2}-\d{2})T.*":"(\d{4}-\d{2}-\d{2})T/)!;
      // Harmony answers 303 to the job; fetch follows it, so the job document arrives here.
      return Response.json({ jobID: `job-${m[2]}`, status: "successful", links: [{ rel: "data", href: `https://harmony.earthdata.nasa.gov/service-results/x/${m[2]}.${s}.${e}.csv` }] });
    }
    const r = url.pathname.match(/\/service-results\/x\/(\w+)\.(\d{4}-\d{2}-\d{2})\.(\d{4}-\d{2}-\d{2})\.csv$/);
    if (r) return new Response(csv(r[1]!, r[2]!, r[3]!, (i) => (r[1]!.includes("DF") ? 4 : i % 3)), { headers: { "content-type": "text/csv" } });
    return new Response("not found", { status: 404 });
  });
});

describe("IMERG pipeline", () => {
  it("stores the Final and Late Run as separate daily series of one retrieval, with monthly sums", async () => {
    const out = await runImerg({ ...field, earthdataToken: "TEST-TOKEN" }, () => undefined, NOW);
    expect(out.retrieval).toMatchObject({ sourceId: "gpm-imerg-daily", productId: "GPM_3IMERGDL+GPM_3IMERGDF", productVersion: "07", evidenceClass: "satellite_observation", outcome: "valid", observationStart: "1998-01-01", observationEnd: "2026-10-31" });
    expect(out.daily!.map((d) => [d.variable, d.unit, d.startDate, d.values.length])).toEqual([
      ["IMERG_LATE_PRECIP", "mm/day", "1998-01-01", 10531],
      ["IMERG_FINAL_PRECIP", "mm/day", "1998-01-01", 10135],
    ]);
    expect(out.aggregates.find((a) => a.variable === "imerg_final_precip" && a.periodStart === "2025-09-01")).toMatchObject({ value: 120, validCount: 30, expectedCount: 30, unit: "mm" });
    expect(out.aggregates.some((a) => a.variable === "imerg_precip" && a.periodStart === "2026-10-01")).toBe(true);
    expect(token).toBe("Bearer TEST-TOKEN");
    expect(JSON.stringify(out.retrieval)).not.toContain("TEST-TOKEN");
  });

  it("reuses the cached answers on a second fetch", async () => {
    await runImerg({ ...field, earthdataToken: "TEST-TOKEN" }, () => undefined, NOW);
    expect(calls.filter((c) => c.includes("rangeset"))).toHaveLength(0);
  });

  it("is unavailable without a token, and keeps the Late Run when the Final Run is refused", async () => {
    await expect(runImerg({ ...field, earthdataToken: null }, () => undefined, NOW)).rejects.toSatisfy((e) => pipelineErrorKind(e) === "unavailable");
    rmSync(dir, { recursive: true, force: true });
    denyFinal = true;
    const out = await runImerg({ ...field, earthdataToken: "TEST-TOKEN" }, () => undefined, NOW);
    expect(out.retrieval.outcome).toBe("partial");
    expect(out.daily!.map((d) => d.variable)).toEqual(["IMERG_LATE_PRECIP"]);
    expect(out.retrieval.checks.find((c) => c.id === "final:available")).toMatchObject({ passed: false });
  });
});
