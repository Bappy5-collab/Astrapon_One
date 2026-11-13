/**
 * pnpm reference:fao-calendar — downloads the FAO Crop Calendar (https://cropcalendar.apps.fao.org,
 * API https://api-cropcalendar.apps.fao.org/api/v1) for every country it covers and keeps the
 * sowing and harvest windows of crops that resolve to Astrapon's crop catalogue (same resolver the
 * engine uses for farmer-typed names). Output: data/reference/fao-crop-calendar.json (committed, the
 * input of the `fao-crop-calendar` reference dataset). Bounded: one request per country, 2 in
 * flight, polite User-Agent. Source credited as FAO; see the file's `licence` note.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { CROP_CATALOG, resolveCrop } from "../src/domain/simulation/catalog";

const API = "https://api-cropcalendar.apps.fao.org/api/v1";
const UA = "Astrapon/0.4 (crop-rotation decision support; reference import)";

type Md = { month: string; day: string } | null | undefined;
type Session = { additional_information?: string; early_sowing?: Md; later_sowing?: Md; early_harvest?: Md; late_harvest?: Md; growing_period?: { period?: string; value?: string } | null; all_year?: string };
type Entry = { id_country: string; lastUpdated?: string; crop: { id: string; name: string }; aez: { id: string; name: string }; sessions?: Session[] };

const md = (v: Md) => {
  const m = Number(v?.month), d = Number(v?.day);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${String(m).padStart(2, "0")}-${String(Math.min(d, m === 2 ? 28 : 31)).padStart(2, "0")}` : null;
};

async function get(url: string): Promise<unknown> {
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
      if (r.ok) return r.json();
      if (r.status < 500 && r.status !== 429) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (a === 3) throw e;
    }
    await new Promise((res) => setTimeout(res, 1500 * a));
  }
  throw new Error("server error after 3 attempts");
}
const failed: { country: string; error: string }[] = [];

const countries = (await get(`${API}/countries?language=en`)) as { id: string; name: string }[];
const out: { country: string; countryName: string; aezId: string; aezName: string; faoCropId: string; faoCrop: string; cropId: string; lastUpdated: string | null; season: string | null; sowFrom: string; sowTo: string; harvestFrom: string; harvestTo: string; growingDays: string | null }[] = [];
const unmapped = new Map<string, number>();
let i = 0;
const work = async () => {
  while (i < countries.length) {
    const c = countries[i++]!;
    let entries: Entry[];
    try {
      entries = (await get(`${API}/countries/${c.id}/cropCalendar?language=en`)) as Entry[];
    } catch (err) {
      failed.push({ country: c.id, error: err instanceof Error ? err.message : String(err) });
      console.log(`${c.id} ${c.name}: FAILED`);
      continue;
    }
    for (const e of entries) {
      const crop = resolveCrop(e.crop.name, CROP_CATALOG);
      if (!crop) { unmapped.set(e.crop.name, (unmapped.get(e.crop.name) ?? 0) + 1); continue; }
      for (const s of e.sessions ?? []) {
        if (s.all_year === "yes") continue;
        const sowFrom = md(s.early_sowing), sowTo = md(s.later_sowing), hFrom = md(s.early_harvest), hTo = md(s.late_harvest);
        if (!sowFrom || !sowTo || !hFrom || !hTo) continue;
        out.push({
          country: c.id, countryName: c.name, aezId: e.aez.id, aezName: e.aez.name, faoCropId: e.crop.id, faoCrop: e.crop.name, cropId: crop.id,
          lastUpdated: e.lastUpdated ?? null, season: s.additional_information?.trim() || null, sowFrom, sowTo, harvestFrom: hFrom, harvestTo: hTo,
          growingDays: s.growing_period?.value ? `${s.growing_period.value} ${s.growing_period.period ?? ""}`.trim() : null,
        });
      }
    }
    console.log(`${c.id} ${c.name}: ${entries.length} entries`);
  }
};
await Promise.all([work(), work()]);
out.sort((a, b) => a.country.localeCompare(b.country) || a.aezId.localeCompare(b.aezId) || a.cropId.localeCompare(b.cropId) || a.sowFrom.localeCompare(b.sowFrom) || (a.season ?? "").localeCompare(b.season ?? ""));
const file = path.join(import.meta.dirname, "..", "data", "reference", "fao-crop-calendar.json");
writeFileSync(
  file,
  JSON.stringify(
    {
      source: "FAO Crop Calendar (Food and Agriculture Organization of the United Nations), https://cropcalendar.apps.fao.org",
      api: `${API}/countries/{country}/cropCalendar?language=en`,
      retrievedAt: new Date().toISOString(),
      licence: "© FAO. FAO's open-data policy applies CC BY 4.0 to FAO statistical databases with attribution; separate terms for this calendar service were not found on 2026-11-05. Credit FAO as the source.",
      note: "Only crops that resolve to Astrapon's crop catalogue are kept; year-round entries and sessions without complete sowing and harvest dates are dropped. Windows are per country and agro-ecological zone (AEZ) as published.",
      countries: countries.length,
      failedCountries: failed,
      unmappedCrops: Object.fromEntries([...unmapped.entries()].sort((a, b) => b[1] - a[1])),
      entries: out,
    },
    null,
    1,
  ) + "\n",
);
console.log(`${out.length} calendar rows → ${path.relative(process.cwd(), file)}`);
