import { describe, expect, it } from "vitest";

import type { EngineResult, RunView } from "./engine";
import { fixList, glance } from "./glance";

/** Minimal stored-run shape (TEST ONLY): baseline + one alternative ranked first. */
function run(withBaseline = true): RunView {
  const ind = (v: Record<string, number>) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, { value: x }]));
  return {
    baseline: withBaseline ? { id: "baseline", kind: "baseline", label: "Rice → Wheat", indicators: ind({ irrigation_requirement: 400, irrigation_dry_gap: 80, bare_days: 60, crop_diversity: 2 }) } : null,
    alternatives: [{ id: "alternative-1", kind: "alternative", label: "Maize → Lentil", indicators: ind({ irrigation_requirement: 300, irrigation_dry_gap: 90, bare_days: 60, crop_diversity: 3 }) }],
    comparison: { ranking: ["alternative-1", ...(withBaseline ? ["baseline"] : [])] },
    indicatorDefinitions: [
      { key: "irrigation_requirement", group: "water_use", better: "low", unit: "mm/year", label: "", scored: true },
      { key: "irrigation_dry_gap", group: "weather_risk", better: "low", unit: "mm/year", label: "", scored: true },
      { key: "bare_days", group: "soil_health", better: "low", unit: "days/year", label: "", scored: true },
      { key: "crop_diversity", group: "diversification", better: "high", unit: "crops", label: "", scored: true },
    ],
  } as unknown as RunView;
}

describe("at a glance", () => {
  it("compares the top option with the current rotation in plain verdicts", () => {
    const g = glance(run())!;
    expect(g.topId).toBe("alternative-1");
    expect(g.tiles.map((t) => [t.topic, t.verdict])).toEqual([["water", "better"], ["dry_years", "worse"], ["bare", "same"], ["variety", "better"]]);
    expect(g.tiles[0]).toMatchObject({ now: 400, top: 300, delta: -100, pct: -25 });
  });
  it("shows the option alone when the current rotation is unknown", () => {
    const g = glance(run(false))!;
    expect(g.baselineId).toBeNull();
    expect(g.tiles.every((t) => t.now == null && t.verdict == null)).toBe(true);
  });
});

describe("fix list", () => {
  const base = { search: { cropRejections: [], feasible: 3, rejectionCounts: {} }, evidence: { weatherRetrievalId: "w" }, soil: { awcMmPerM: 150 }, runs: [run()] };
  it("is empty for a complete result", () => {
    expect(fixList(base as unknown as EngineResult)).toEqual([]);
  });
  it("blocks on unknown crops and missing weather when nothing was compared", () => {
    const r = { ...base, search: { cropRejections: [{ crop: "test", code: "unknown_crop", detail: "" }], feasible: 0, rejectionCounts: { unknown_crop: 1 } }, evidence: { weatherRetrievalId: null }, soil: { awcMmPerM: null }, runs: [{ ...run(false), comparison: null }] };
    const items = fixList(r as unknown as EngineResult);
    expect(items.map((i) => [i.code, i.blocking])).toEqual([["unknown_crops", true], ["no_weather", true], ["no_soil", false], ["no_history", false]]);
    expect(items[0]!.detail).toEqual(["test"]);
  });
});
