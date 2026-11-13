/**
 * Which planting-calendar areas to suggest on the comparison form, and whether one can be chosen for
 * the farmer. Pure: the caller supplies the place names around the field (from a reverse geocoder)
 * and the areas the farmer chose in earlier comparisons. Nothing here guesses a zone from
 * coordinates: FAO zones have no published boundaries in Astrapon, so a zone is suggested only when
 * its name contains a place name around the field, or the farmer already used it nearby.
 */

export type RegionOption = { value: string; label: string };
export type SuggestReason = "place" | "this_field" | "this_farm" | "before";
export type RegionSuggestion = { value: string; reason: SuggestReason; place?: string };
/** An area chosen in another comparison: same field, same farm, or anywhere (most recent first). */
export type PastChoice = { region: string; scope: "this_field" | "this_farm" | "other" };

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Words that name a kind of area, dropped from a place name ("Rajshahi Division" → "rajshahi"). */
const KIND = new Set(["state", "province", "region", "district", "division", "county", "governorate", "prefecture", "of"]);

/** The specific part of a place name. Direction words are kept, so "West Virginia" never matches "Virginia". */
function placeKey(name: string): string | null {
  const key = norm(name).split(" ").filter((w) => w && !KIND.has(w)).join(" ");
  return key.length >= 4 ? key : null;
}

const containsPhrase = (haystack: string, phrase: string) => ` ${norm(haystack)} `.includes(` ${phrase} `);

export function suggestRegions(
  regions: RegionOption[],
  placeNames: string[],
  past: PastChoice[],
): { suggestions: RegionSuggestion[]; auto: RegionSuggestion | null } {
  const listed = new Set(regions.map((r) => r.value));
  const out: RegionSuggestion[] = [];
  const add = (s: RegionSuggestion) => {
    if (listed.has(s.value) && !out.some((o) => o.value === s.value)) out.push(s);
  };

  // 1. Areas named after the place the field is in (a US state; a province such as Punjab or Sindh).
  const placeHits: RegionSuggestion[] = [];
  const exactHits: RegionSuggestion[] = [];
  for (const name of placeNames) {
    const key = placeKey(name);
    if (!key) continue;
    for (const r of regions) {
      if (!containsPhrase(r.label, key)) continue;
      const hit = { value: r.value, reason: "place" as const, place: name };
      if (!placeHits.some((h) => h.value === r.value)) placeHits.push(hit);
      if (norm(r.label) === key && !exactHits.some((h) => h.value === r.value)) exactHits.push(hit);
    }
  }

  // 2. Areas the farmer chose before: on this field, on this farm, then anywhere.
  const distinct = (scope: PastChoice["scope"]) => [...new Set(past.filter((p) => p.scope === scope && listed.has(p.region)).map((p) => p.region))];
  const field = distinct("this_field");
  const farm = distinct("this_farm");
  const before = distinct("other");

  field.forEach((v) => add({ value: v, reason: "this_field" }));
  placeHits.forEach(add);
  farm.forEach((v) => add({ value: v, reason: "this_farm" }));
  before.slice(0, 3).forEach((v) => add({ value: v, reason: "before" }));

  // Chosen for the farmer only when there is exactly one clear answer.
  const single = <T,>(xs: T[]): T | null => (xs.length === 1 ? xs[0]! : null);
  const one = (v: string | null, reason: "this_field" | "this_farm"): RegionSuggestion | null => (v ? { value: v, reason } : null);
  const auto: RegionSuggestion | null =
    one(single(field), "this_field") ??
    single(placeHits) ??
    single(exactHits) ??
    (placeHits.length ? null : one(single(farm), "this_farm"));

  return { suggestions: out, auto };
}
