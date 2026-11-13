import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/database/database.types";

/**
 * Planting calendars offered on the comparison page, limited to the farm's country. Datasets are
 * published once and never edited (a new version gets a new id), so each is read once per server
 * instance; the page refreshes itself while a comparison runs and must stay light.
 */
type Db = SupabaseClient<Database>;
type Entry = { region: string; country: string | null; cropId: string; from: string; to: string };
type Payload = { region?: string; country?: string; cropId?: string; plant?: { begin?: string; end?: string } };

const NASS = "usda-nass-usual-dates-2010";
const FAO = "fao-crop-calendar";
const memo = new Map<string, Promise<Entry[]>>();

async function datasetEntries(db: Db, name: string): Promise<Entry[]> {
  const { data } = await db.from("reference_datasets").select("id").eq("name", name).eq("status", "published").order("version", { ascending: false }).limit(1);
  const id = data?.[0]?.id;
  if (!id) return [];
  let pending = memo.get(id);
  if (!pending) {
    pending = (async () => {
      const out: Entry[] = [];
      for (let from = 0; from < 20000; from += 1000) {
        const { data: items, error } = await db.from("reference_items").select("payload").eq("dataset_id", id).order("item_key").range(from, from + 999);
        if (error) throw new Error("Could not load planting calendars");
        for (const i of items ?? []) {
          const p = i.payload as Payload;
          if (p.region && p.cropId && p.plant?.begin && p.plant.end) out.push({ region: p.region, country: p.country ?? null, cropId: p.cropId, from: p.plant.begin, to: p.plant.end });
        }
        if (!items || items.length < 1000) break;
      }
      return out;
    })();
    pending.catch(() => memo.delete(id));
    memo.set(id, pending);
  }
  return pending;
}

const regionLabel = (region: string) => {
  if (!region.startsWith("FAO · ")) return region;
  return region.split(" · ").slice(2).join(" · ") || region.slice(6);
};
const fullLabel = (region: string) => (region.startsWith("FAO · ") ? region.slice(6) : `USA · ${region}`);

export type CalendarChoices = { regions: { value: string; label: string }[]; dates: { region: string; cropId: string; from: string; to: string }[]; datesKnown: boolean };

/** `country` is an ISO two-letter code, or null when unknown (then every area is listed and dates are not previewed). */
export async function calendarChoices(db: Db, country: string | null, selected: string | null): Promise<CalendarChoices> {
  const [nass, fao] = await Promise.all([datasetEntries(db, NASS), datasetEntries(db, FAO)]);
  const inCountry = country === "US" ? nass : country ? fao.filter((e) => e.country === country) : [];
  const sorted = (rs: string[]) => [...new Set(rs)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (inCountry.length) {
    const regions = sorted(inCountry.map((e) => e.region)).map((r) => ({ value: r, label: regionLabel(r) }));
    if (selected && !regions.some((r) => r.value === selected)) regions.unshift({ value: selected, label: fullLabel(selected) });
    return { regions, dates: inCountry.map(({ region, cropId, from, to }) => ({ region, cropId, from, to })), datesKnown: !selected || inCountry.some((e) => e.region === selected) };
  }
  return { regions: sorted([...nass, ...fao].map((e) => e.region)).map((r) => ({ value: r, label: fullLabel(r) })), dates: [], datesKnown: false };
}
