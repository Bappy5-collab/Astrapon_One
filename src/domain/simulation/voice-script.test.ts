import { describe, expect, it } from "vitest";

import { formatterFor } from "@/lib/i18n/format";
import { MESSAGES, translate, type Locale, type MessageKey } from "@/lib/i18n/messages";
import { fmt } from "@/lib/i18n/sim-messages";

import type { RunView } from "./engine";
import { voiceScript, type VoiceDrySeason } from "./voice-script";

/** Minimal stored-run shape (TEST ONLY): baseline + one alternative ranked first. */
function run(withBaseline = true): RunView {
  const ind = (v: Record<string, number>) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, { value: x }]));
  const p = (crop: string, start: string, end: string, cycleYear = 0) => ({ crop, start, end, cycleYear });
  return {
    kind: "historical_replay",
    baseline: withBaseline ? { id: "baseline", kind: "baseline", label: "Rice → Wheat", plantings: [p("Rice", "07-01", "11-01")], indicators: ind({ irrigation_requirement: 400, irrigation_dry_gap: 80 }) } : null,
    alternatives: [
      { id: "alternative-1", kind: "alternative", label: "Jute + Lentil → Lentil", plantings: [p("Jute", "04-10", "08-01"), p("Lentil", "11-05", "02-20"), p("Lentil", "11-05", "02-20", 1)], indicators: ind({ irrigation_requirement: 300, irrigation_dry_gap: 90 }) },
    ],
    comparison: { ranking: ["alternative-1", ...(withBaseline ? ["baseline"] : [])], stability: "stable" },
    indicatorDefinitions: [
      { key: "irrigation_requirement", group: "water_use", better: "low", unit: "mm/year", label: "", scored: true },
      { key: "irrigation_dry_gap", group: "weather_risk", better: "low", unit: "mm/year", label: "", scored: true },
    ],
  } as unknown as RunView;
}

const dry: VoiceDrySeason = { noDrySeason: false, dryMonths: [11, 12, 1, 2, 3], lowestMonth: 3, dryNeedM3: 1234 };
const ctx = (locale: Locale, d: VoiceDrySeason | null = dry) => ({
  t: (k: string) => (k in MESSAGES.en ? translate(locale, k as MessageKey) : null),
  f: formatterFor(locale),
  fill: fmt,
  dry: d,
  irrigationMode: "full" as const,
});

describe("spoken run summary", () => {
  it("says which crops, what to do, how much water and what the dry season means, each tied to its part of the page", () => {
    const lines = voiceScript(run(), ctx("en"));
    expect(lines.map((l) => [l.section, l.target])).toEqual([
      ["crops", "voice-top"],
      ["todo", "voice-top"],
      ["water", "voice-tile-irrigation_requirement"],
      ["dry", "voice-water"],
      ["check", "voice-check"],
    ]);
    expect(lines[0]!.text).toBe("Here is a short summary. Among the options compared, Alternative 1 is ranked first. It grows Jute and Lentil.");
    expect(lines[1]!.text).toBe("If you choose it: plant Jute around 10 April and harvest around 1 August; plant Lentil around 5 November and harvest around 20 February.");
    expect(lines[2]!.text).toBe("Water: it needs about 300 millimetres of irrigation a year. Now: 400 millimetres.");
    expect(lines[3]!.text).toBe(
      "Dry season: from November to March, rain is less than half of what crops use. Ponds and small rivers may run low around March. In those months this option needs about 1,230 cubic metres of water on this field. In a year with little rain, it needs about 90 millimetres more irrigation over the year. For these months, plan a backup: the Water page shows nearby water and works out a groundwater pump with solar.",
    );
    expect(lines.every((l) => !/\{\w+\}/.test(l.text))).toBe(true);
  });

  it("speaks Bangla with Bangla digits and Bangla sentence endings", () => {
    const lines = voiceScript(run(), ctx("bn"));
    expect(lines[1]!.text).toBe("এটি বেছে নিলে: ১০ এপ্রিল নাগাদ Jute বুনুন, ১ আগস্ট নাগাদ কাটুন; ৫ নভেম্বর নাগাদ Lentil বুনুন, ২০ ফেব্রুয়ারি নাগাদ কাটুন।");
    expect(lines.some((l) => /[0-9]/.test(l.text))).toBe(false);
    expect(lines.every((l) => !/[.]$/.test(l.text))).toBe(true);
  });

  it("without weather, says only the dry-year water and points at its tile", () => {
    const lines = voiceScript(run(), ctx("en", null));
    const d = lines.find((l) => l.section === "dry")!;
    expect(d).toEqual({ section: "dry", target: "voice-tile-irrigation_dry_gap", text: "In a year with little rain, it needs about 90 millimetres more irrigation over the year." });
  });

  it("leaves out 'now' when the current rotation is unknown, and says so when no month is dry", () => {
    const lines = voiceScript(run(false), ctx("en", { noDrySeason: true, dryMonths: [], lowestMonth: null, dryNeedM3: null }));
    expect(lines.find((l) => l.section === "water")!.text).toBe("Water: it needs about 300 millimetres of irrigation a year.");
    expect(lines.find((l) => l.section === "dry")!.text).toMatch(/^Dry season: in the NASA weather record, no month here is dry on average\./);
  });

  it("says when the option needs no water in the dry months, and then does not ask for a backup", () => {
    const d = voiceScript(run(), ctx("en", { ...dry, dryNeedM3: 0 })).find((l) => l.section === "dry")!.text;
    expect(d).toContain("needed no irrigation in those months");
    expect(d).not.toContain("plan a backup");
  });

  it("says why there is no water figure for a rain-only comparison", () => {
    const r = run();
    for (const o of [r.baseline!, ...r.alternatives]) o.indicators = {};
    const lines = voiceScript(r, { ...ctx("en"), irrigationMode: "rainfed" });
    expect(lines.find((l) => l.section === "water")).toEqual({ section: "water", target: "voice-water", text: expect.stringMatching(/^Water: this comparison assumed rain only/) });
  });

  it("says nothing for a run without a comparison", () => {
    expect(voiceScript({ ...run(), comparison: null } as unknown as RunView, ctx("en"))).toEqual([]);
    expect(voiceScript(undefined, ctx("en"))).toEqual([]);
  });
});
