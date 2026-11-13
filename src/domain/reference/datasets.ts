import { CROP_CATALOG } from "@/domain/simulation/catalog";
import { parseNassUsualDates, type CalendarEntry } from "@/domain/simulation/nass";
import { REFERENCE_SOURCES } from "@/domain/sources/references";
import { DATA_SOURCES } from "@/domain/sources/registry";
import type { DataSource, ReferenceSource } from "@/domain/sources/types";

/**
 * Builds the reference datasets Astrapon imports into the database. Only content that is
 * sourced in the repository is included:
 * - crop-parameters: FAO-56 Tables 11/12/22 values and USDA PLANTS families (checked 2026-11-01);
 * - usda-nass-usual-dates-2010: parsed from data/reference/usda-nass-usual-dates-2010.txt (the
 *   caller passes the text, since this module does no I/O);
 * - the data-source registry and the reference library.
 * No rotation rules beyond the canola return interval (in the engine) are published.
 */

export type CitationVerification = "verified" | "title_to_verify" | "secondary_source" | "catalog_pointer";

export type CitationRecord = {
  citationKey: string;
  citation: string;
  url: string | null;
  doi: string | null;
  verification: CitationVerification;
};

export type DatasetItem = { itemKey: string; payload: Record<string, unknown>; citationKeys: string[] };

export type DatasetDefinition = {
  kind: "data_source_registry" | "reference_library" | "crop_parameters" | "crop_calendar";
  name: string;
  description: string;
  items: DatasetItem[];
};

/** Field studies behind crop values FAO-56 does not tabulate (crop-parameters v4). */
const CROP_STUDY_REFS: Record<string, string[]> = {
  chickpea: ["mpkv-rahuri-gram", "garofalo-2009-chickpea"],
  rapeseed: ["sarma-2020-rapeseed"],
  mustard: ["pereira-2021-field-crops", "gupta-2017-mustard"],
  jute: ["milla-2018-jute"],
};

const httpsOrNull =(url: string | undefined) => (url && url.startsWith("https://") ? url : null);

export function sourceCitation(s: DataSource): CitationRecord {
  const pointer = /not yet transcribed|<date>/i.test(s.citation);
  return {
    citationKey: `source-${s.id}`,
    citation: s.citation,
    url: httpsOrNull(s.officialUrls[0]),
    doi: s.doi ?? null,
    verification: pointer ? "catalog_pointer" : "verified",
  };
}

export function literatureCitation(r: ReferenceSource): CitationRecord {
  return {
    citationKey: r.id,
    citation: r.citation,
    url: httpsOrNull(r.url),
    doi: r.doi ?? null,
    verification: /title to verify/i.test(r.title) ? "title_to_verify" : "verified",
  };
}

export type FaoCalendarFile = { entries: { country: string; countryName: string; aezId: string; aezName: string; faoCropId: string; faoCrop: string; cropId: string; lastUpdated: string | null; season: string | null; sowFrom: string; sowTo: string; harvestFrom: string; harvestTo: string }[] };

/** Region label of an FAO calendar zone, as shown in the scenario form and stored in settings. */
export const faoRegion = (countryName: string, aezName: string) => `FAO · ${countryName} · ${aezName}`;

export function buildReferenceDatasets(opts: { nassText?: string; faoCalendar?: FaoCalendarFile } = {}): { citations: CitationRecord[]; datasets: DatasetDefinition[] } {
  const citations = [...DATA_SOURCES.map(sourceCitation), ...REFERENCE_SOURCES.map(literatureCitation)];
  const datasets: DatasetDefinition[] = [
    {
      kind: "data_source_registry",
      // Published dataset id kept from the working name; reference data is immutable and pinned by snapshots.
      name: "fieldshift-data-sources",
      description: "Environmental data sources: evidence class, coverage, access, what each supports and cannot establish, and verification status.",
      items: DATA_SOURCES.map((s) => ({ itemKey: s.id, payload: { ...s }, citationKeys: [`source-${s.id}`] })),
    },
    {
      kind: "reference_library",
      name: "agronomic-references",
      description: "Agronomic literature and tables Astrapon may draw on, with intended use, caveats and unconfirmed points. Contains no transcribed parameter values.",
      items: REFERENCE_SOURCES.map((r) => ({ itemKey: r.id, payload: { ...r }, citationKeys: [r.id] })),
    },
    {
      kind: "crop_parameters",
      name: "crop-parameters",
      description: "Crop catalogue for the simulation engine: FAO-56 Kc (Table 12), stage-length examples (Table 11), rooting depth and p (Table 22), and botanical family (USDA PLANTS); for crops FAO-56 leaves incomplete, values from cited field studies (FAO56 update 2021, lysimeter studies). See docs/scientific-methodology.md §3.",
      items: CROP_CATALOG.map((c) => ({ itemKey: c.id, payload: { ...c }, citationKeys: c.fao56 ? ["fao56", "usda-plants", ...(CROP_STUDY_REFS[c.id] ?? [])] : ["usda-plants"] })),
    },
  ];
  if (opts.nassText !== undefined) {
    const entries = parseNassUsualDates(opts.nassText);
    if (!entries.length) throw new Error("The NASS calendar text produced no entries");
    datasets.push({
      kind: "crop_calendar",
      name: "usda-nass-usual-dates-2010",
      description: "USDA NASS (2010) usual planting and harvesting dates by state, for crops in the catalogue. Used only when a scenario selects that state.",
      items: entries.map((e) => ({ itemKey: `${e.region}|${e.sourceCrop}`, payload: { ...e }, citationKeys: ["usda-nass-2010"] })),
    });
  }
  if (opts.faoCalendar) {
    const seen = new Map<string, number>();
    const items = opts.faoCalendar.entries.map((e) => {
      const base = `${e.country}|${e.aezId}|${e.faoCropId}|${e.sowFrom}|${e.harvestFrom}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const entry: CalendarEntry = {
        region: faoRegion(e.countryName, e.aezName),
        sourceCrop: e.season ? `${e.faoCrop} (${e.season})` : e.faoCrop,
        cropId: e.cropId,
        plant: { begin: e.sowFrom, activeStart: e.sowFrom, activeEnd: e.sowTo, end: e.sowTo },
        harvest: { begin: e.harvestFrom, activeStart: e.harvestFrom, activeEnd: e.harvestTo, end: e.harvestTo },
      };
      return { itemKey: n > 1 ? `${base}|${n}` : base, payload: { ...entry, country: e.country, lastUpdated: e.lastUpdated }, citationKeys: ["fao-crop-calendar"] };
    });
    if (!items.length) throw new Error("The FAO calendar file produced no entries");
    datasets.push({
      kind: "crop_calendar",
      name: "fao-crop-calendar",
      description: "FAO Crop Calendar sowing and harvest windows by country and agro-ecological zone, for crops in the catalogue. Used only when a scenario selects that zone.",
      items,
    });
  }
  return { citations, datasets };
}
