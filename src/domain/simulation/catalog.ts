import { z } from "zod";

/**
 * Crop catalogue, published as the reference dataset `crop-parameters` and pinned by snapshots.
 * Every number was checked on 2026-11-01 against the primary source:
 *
 * - FAO-56 (Allen et al. 1998) Table 12 (Kc), Table 11 (stage lengths, regional examples) and
 *   Table 22 (maximum rooting depth range, depletion fraction p).
 * - USDA PLANTS Database PlantProfile API (botanical family).
 *
 * Group Kc ini is used where a crop row leaves it blank (Table 12 note). Table 11 rows without a
 * stated region were not transcribed. Crops with no FAO-56 row carry only their family, and the
 * engine reports water indicators for them as insufficient evidence. See
 * docs/scientific-methodology.md §3.
 *
 * crop-parameters v4 (2026-11-06) fills four crops FAO-56 leaves incomplete, each value from a
 * published field study checked against its PDF (`paramSource` and each stage row's `source`
 * name it): stage lengths for chickpea (MPKV Rahuri lysimeter; Garofalo et al. 2009) and rapeseed
 * (Sarma & Bharadwaj 2020, Jorhat lysimeter); mustard Kc, root depth, height and p from the FAO56
 * update (Pereira et al. 2021, Tables 12 and 15) with stages from Gupta et al. (2017); jute Kc and
 * stages measured in Bangladesh (Milla et al. 2018, BARI Gazipur). No crop borrows another's values.
 */

const kcValue = z.union([z.number().min(0).max(1.5), z.object({ low: z.number().min(0).max(1.5), high: z.number().min(0).max(1.5) })]);

export const stageExampleSchema = z.object({
  ini: z.number().int().min(0),
  dev: z.number().int().min(0),
  mid: z.number().int().min(0),
  late: z.number().int().min(0),
  plantDate: z.string(),
  region: z.string().min(1),
  /** v4: citation when the row is not an FAO-56 Table 11 row (a published field study). */
  source: z.string().optional(),
});

export const cropParamsSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  label: z.string().min(1),
  scientificName: z.string().nullable(),
  plantsSymbol: z.string().nullable(),
  family: z.string().min(1),
  familyNote: z.string().optional(),
  aliases: z.array(z.string().min(1)),
  role: z.enum(["crop", "cover"]),
  fao56: z
    .object({
      table12Row: z.string(),
      kcIni: z.union([z.number().min(0).max(1.5), z.object({ frozen: z.number(), nonFrozen: z.number() })]),
      kcMid: kcValue,
      kcEnd: kcValue,
      kcNote: z.string().optional(),
      /** Footnote 9: the lower Kc mid applies to rainfed crops. */
      rainfedUsesLowKcMid: z.boolean().optional(),
      /** 1.3.0: FAO-56 Table 12 maximum crop height h (m) as printed (a range keeps both ends); null when Table 12 prints none. */
      heightM: z.union([z.number().positive(), z.tuple([z.number().positive(), z.number().positive()])]).nullable().optional(),
      table22Row: z.string(),
      /** v4: null only for "potential_only" crops whose rooting depth and p are not published (jute). */
      rootDepthM: z.tuple([z.number().positive(), z.number().positive()]).nullable(),
      p: z.number().min(0.05).max(0.9).nullable(),
      /** v4: where the Kc, depth and p come from when not FAO-56 Tables 12/22. */
      paramSource: z.string().optional(),
      /**
       * v4: true when the Kc values were measured in the local climate (not the FAO-56 standard
       * climate RHmin 45 %, u2 2 m/s); the Eq. 62/65 climate adjustment is then not applied.
       */
      kcLocal: z.boolean().optional(),
      /**
       * "potential_only": no root-zone balance. "paddy" (1.3.0): flooded rice, irrigation by the FAO
       * Training Manual No. 3 paddy procedure (SAT + PERC + water layer − effective rain), no root-zone balance.
       */
      waterBalance: z.enum(["full", "potential_only", "paddy"]),
      stages: z.array(stageExampleSchema),
    })
    .refine((f) => f.waterBalance === "potential_only" || (f.rootDepthM != null && f.p != null), "rooting depth and p are required for a soil water balance")
    .nullable(),
  notes: z.array(z.string()),
});

export type CropParams = z.infer<typeof cropParamsSchema>;
export type StageExample = z.infer<typeof stageExampleSchema>;

const st = (ini: number, dev: number, mid: number, late: number, plantDate: string, region: string, source?: string): StageExample => ({ ini, dev, mid, late, plantDate, region, ...(source ? { source } : {}) });
const MPKV_GRAM = "MPKV Rahuri (2023), Phase VIII report, Determination of Crop Coefficients for Major Crops by Lysimetric Studies (PoCRA), Table 1.1: rabi gram cv. Phule Vikram, sown 14 Dec 2021, harvested 4 Apr 2022";
const GAROFALO = "Garofalo, Vonella, Ruggieri & Rinaldi (2009), WIT Trans. Ecol. Environ. 125, doi:10.2495/WRM090441, Table 1 (drip, sown 4 Dec 2006)";
const SARMA = "Sarma & Bharadwaj (2020), J. Agrometeorol. 22(2):172-178, weighing lysimeter, rapeseed cv. TS 38 sown 30 Oct (1-13, 14-33, 34-65, 66-93 DAS)";
const GUPTA = "Gupta, Sarangi & Singh (2017), Curr. Sci. 113(2):264-271, weighing lysimeter, cv. Pusa Vijay sown 14-22 Nov";
const MILLA = "Milla, Akanda, Biswas & Uddin (2018), The Agriculturists 16(2):115-122, doi:10.3329/agric.v16i02.40349, Table 4 (micro-lysimeter, BJRI Tosa-2 sown 18 Apr 2016)";
const SMALL_GRAIN_STAGES = [
  st(15, 25, 50, 30, "November", "Central India"),
  st(20, 25, 60, 30, "March/Apr", "35-45°L"),
  st(15, 30, 65, 40, "July", "East Africa"),
  st(20, 50, 60, 30, "Dec", "Calif. Desert, USA"),
];

export const CROP_CATALOG: CropParams[] = [
  {
    id: "maize", label: "Maize (grain)", scientificName: "Zea mays", plantsSymbol: "ZEMA", family: "Poaceae", role: "crop",
    aliases: ["maize", "corn", "field corn", "grain maize", "corn for grain", "ভুট্টা", "bhutta", "vutta"],
    fao56: {
      table12Row: "Maize, Field (grain) (field corn)", kcIni: 0.3, kcMid: 1.2, kcEnd: 0.35,
      kcNote: "Kc end 0.35 is for harvest after field drying; Table 12 gives 0.60 for harvest at high grain moisture (footnote 11). Kc ini is the cereals group value.",
      heightM: 2, table22Row: "Maize, Field (grain) (field corn)", rootDepthM: [1.0, 1.7], p: 0.55, waterBalance: "full",
      stages: [
        st(30, 50, 60, 40, "April", "East Africa (alt.)"), st(25, 40, 45, 30, "Dec/Jan", "Arid Climate"), st(20, 35, 40, 30, "June", "Nigeria (humid)"),
        st(20, 35, 40, 30, "October", "India (dry, cool)"), st(30, 40, 50, 30, "April", "Spain (spr, sum.); Calif."), st(30, 40, 50, 50, "April", "Idaho, USA"),
      ],
    },
    notes: [],
  },
  {
    id: "soybean", label: "Soybean", scientificName: "Glycine max", plantsSymbol: "GLMA4", family: "Fabaceae", role: "crop",
    aliases: ["soybean", "soybeans", "soy", "soya", "soya bean", "সয়াবিন", "soyabin"],
    fao56: {
      table12Row: "Soybeans", kcIni: 0.4, kcMid: 1.15, kcEnd: 0.5, kcNote: "Kc ini is the legumes group value.",
      heightM: [0.5,1], table22Row: "Soybeans", rootDepthM: [0.6, 1.3], p: 0.5, waterBalance: "full",
      stages: [st(15, 15, 40, 15, "Dec", "Tropics"), st(20, 35, 60, 25, "May", "Central USA"), st(20, 25, 75, 30, "June", "Japan")],
    },
    notes: ["Table 11 lists the Central USA development stage as 30/35 days; 35 is used because it matches the stated 140-day total."],
  },
  {
    id: "winter_wheat", label: "Winter wheat", scientificName: "Triticum aestivum", plantsSymbol: "TRAE", family: "Poaceae", role: "crop",
    aliases: ["winter wheat", "wheat, winter", "winter, wheat"],
    fao56: {
      table12Row: "Winter Wheat", kcIni: { frozen: 0.4, nonFrozen: 0.7 }, kcMid: 1.15, kcEnd: 0.25,
      kcNote: "Kc end 0.25 is for machine harvest; Table 12 gives up to 0.4 for hand-harvested crops (footnote 10).",
      heightM: null, table22Row: "Winter Wheat", rootDepthM: [1.5, 1.8], p: 0.55, waterBalance: "full",
      stages: [st(20, 60, 70, 30, "December", "Calif., USA"), st(30, 140, 40, 30, "November", "Mediterranean"), st(160, 75, 75, 25, "October", "Idaho, USA")],
    },
    notes: [],
  },
  {
    id: "spring_wheat", label: "Wheat (spring type)", scientificName: "Triticum aestivum", plantsSymbol: "TRAE", family: "Poaceae", role: "crop",
    aliases: ["spring wheat", "wheat, spring", "wheat", "গম", "gom"],
    fao56: {
      table12Row: "Spring Wheat", kcIni: 0.3, kcMid: 1.15, kcEnd: 0.25, kcNote: "Kc end 0.25 is for machine harvest (footnote 10). Kc ini is the cereals group value.",
      heightM: 1, table22Row: "Spring Wheat", rootDepthM: [1.0, 1.5], p: 0.55, waterBalance: "full", stages: SMALL_GRAIN_STAGES,
    },
    notes: ["Stage examples are FAO-56 Table 11 'Barley/Oats/Wheat'.", "Unqualified 'wheat' is treated as a spring (non-vernalising) type; record 'winter wheat' if yours is."],
  },
  {
    id: "barley", label: "Barley", scientificName: "Hordeum vulgare", plantsSymbol: "HOVU", family: "Poaceae", role: "crop",
    aliases: ["barley", "barley, spring", "barley, fall", "যব", "job", "jab"],
    fao56: { table12Row: "Barley", kcIni: 0.3, kcMid: 1.15, kcEnd: 0.25, heightM: 1, table22Row: "Barley", rootDepthM: [1.0, 1.5], p: 0.55, waterBalance: "full", stages: SMALL_GRAIN_STAGES },
    notes: ["Stage examples are FAO-56 Table 11 'Barley/Oats/Wheat'."],
  },
  {
    id: "oats", label: "Oats", scientificName: "Avena sativa", plantsSymbol: "AVSA", family: "Poaceae", role: "crop",
    aliases: ["oats", "oat", "oats, spring", "oats, fall", "ওট"],
    fao56: { table12Row: "Oats", kcIni: 0.3, kcMid: 1.15, kcEnd: 0.25, heightM: 1, table22Row: "Oats", rootDepthM: [1.0, 1.5], p: 0.55, waterBalance: "full", stages: SMALL_GRAIN_STAGES },
    notes: ["Stage examples are FAO-56 Table 11 'Barley/Oats/Wheat'."],
  },
  {
    id: "sorghum", label: "Sorghum (grain)", scientificName: "Sorghum bicolor", plantsSymbol: "SOBI2", family: "Poaceae", role: "crop",
    aliases: ["sorghum", "grain sorghum", "sorghum for grain", "milo", "joar", "জোয়ার"],
    fao56: {
      table12Row: "Sorghum - grain", kcIni: 0.3, kcMid: { low: 1.0, high: 1.1 }, kcEnd: 0.55,
      heightM: [1,2], table22Row: "Sorghum - grain", rootDepthM: [1.0, 2.0], p: 0.55, waterBalance: "full",
      stages: [st(20, 35, 40, 30, "May/June", "USA, Pakis., Med."), st(20, 35, 45, 30, "Mar/April", "Arid Region")],
    },
    notes: [],
  },
  {
    id: "rice", label: "Rice (paddy)", scientificName: "Oryza sativa", plantsSymbol: "ORSA", family: "Poaceae", role: "crop",
    aliases: ["rice", "paddy", "rice, all", "aman", "boro", "aus", "ধান", "dhan", "চাল"],
    fao56: {
      table12Row: "Rice", kcIni: 1.05, kcMid: 1.2, kcEnd: { low: 0.6, high: 0.9 },
      heightM: 1, table22Row: "Rice", rootDepthM: [0.5, 1.0], p: 0.2, waterBalance: "paddy",
      stages: [st(30, 30, 60, 30, "Dec; May", "Tropics; Mediterranean"), st(30, 30, 80, 40, "May", "Tropics")],
    },
    notes: ["FAO-56 gives p for rice as 0.20 of saturation (flooded). Under full irrigation, paddy water need follows FAO Training Manual No. 3 §4.4 (land soaking 200 mm, percolation 6 mm/day (4–8), water layer 100 mm, effective rain); rainfed rice reports potential water use only."],
  },
  {
    id: "lentil", label: "Lentil", scientificName: "Lens culinaris", plantsSymbol: "LECU2", family: "Fabaceae", role: "crop",
    aliases: ["lentil", "lentils", "মসুর", "mosur", "masur"],
    fao56: {
      table12Row: "Lentil", kcIni: 0.4, kcMid: 1.1, kcEnd: 0.3, kcNote: "Kc ini is the legumes group value.",
      heightM: 0.5, table22Row: "Lentil", rootDepthM: [0.6, 0.8], p: 0.5, waterBalance: "full",
      stages: [st(20, 30, 60, 40, "April", "Europe"), st(25, 35, 70, 40, "Oct/Nov", "Arid Region")],
    },
    notes: [],
  },
  {
    id: "chickpea", label: "Chickpea", scientificName: "Cicer arietinum", plantsSymbol: "CIAR5", family: "Fabaceae", role: "crop",
    aliases: ["chickpea", "chickpeas", "chick pea", "garbanzo", "ছোলা", "chola", "chhola"],
    fao56: {
      table12Row: "Chick pea", kcIni: 0.4, kcMid: 1.0, kcEnd: 0.35, kcNote: "Kc ini is the legumes group value.",
      heightM: 0.4, table22Row: "Chick pea", rootDepthM: [0.6, 1.0], p: 0.5, waterBalance: "full",
      stages: [st(20, 35, 35, 20, "December", "Rahuri, Maharashtra, India", MPKV_GRAM), st(85, 35, 40, 35, "December", "Foggia, Italy", GAROFALO)],
    },
    notes: ["FAO-56 Table 11 has no chickpea row; stage lengths come from two lysimeter studies (Rahuri, India; Foggia, Italy). The engine uses the one closest in season length (about 110 days in South Asia)."],
  },
  {
    id: "dry_bean", label: "Dry bean", scientificName: "Phaseolus vulgaris", plantsSymbol: "PHVU", family: "Fabaceae", role: "crop",
    aliases: ["dry bean", "dry beans", "bean", "beans", "beans, dry edible", "dry edible beans"],
    fao56: {
      table12Row: "Beans, dry and Pulses", kcIni: 0.4, kcMid: 1.15, kcEnd: 0.35,
      heightM: 0.4, table22Row: "Beans, dry and Pulses", rootDepthM: [0.6, 0.9], p: 0.45, waterBalance: "full",
      stages: [st(20, 30, 40, 20, "May/June", "Continental Climates"), st(15, 25, 35, 20, "June", "Pakistan, Calif."), st(25, 25, 30, 20, "June", "Idaho, USA")],
    },
    notes: [],
  },
  {
    id: "pea_dry", label: "Pea (dry)", scientificName: "Pisum sativum", plantsSymbol: "PISA6", family: "Fabaceae", role: "crop",
    aliases: ["pea", "peas", "dry pea", "dry peas", "field pea", "peas, dry edible", "মটর", "motor", "matar"],
    fao56: {
      table12Row: "Peas - Dry/Seed", kcIni: 0.4, kcMid: 1.15, kcEnd: 0.3, kcNote: "Kc ini is the legumes group value.",
      heightM: 0.5, table22Row: "Peas - Dry/Seed", rootDepthM: [0.6, 1.0], p: 0.4, waterBalance: "full",
      stages: [st(15, 25, 35, 15, "May", "Europe"), st(20, 30, 35, 15, "Mar/Apr", "Mediterranean"), st(35, 25, 30, 20, "April", "Idaho, USA")],
    },
    notes: [],
  },
  {
    id: "faba_bean", label: "Faba bean (dry)", scientificName: "Vicia faba", plantsSymbol: "VIFA", family: "Fabaceae", role: "crop",
    aliases: ["faba bean", "fava bean", "broad bean", "fababean"],
    fao56: {
      table12Row: "Fababean - Dry/Seed", kcIni: 0.5, kcMid: 1.15, kcEnd: 0.3,
      heightM: 0.8, table22Row: "Fababean - Dry/Seed", rootDepthM: [0.5, 0.7], p: 0.45, waterBalance: "full",
      stages: [st(15, 25, 35, 15, "May", "Europe"), st(20, 30, 35, 15, "Mar/Apr", "Mediterranean"), st(90, 45, 40, 60, "Nov", "Europe (dry)")],
    },
    notes: [],
  },
  {
    id: "green_gram_cowpea", label: "Mung bean / cowpea", scientificName: "Vigna unguiculata; Vigna radiata", plantsSymbol: "VIUN", family: "Fabaceae", role: "crop",
    aliases: ["mung", "mung bean", "mungbean", "green gram", "cowpea", "cowpeas", "মুগ", "mug", "moog"],
    fao56: {
      table12Row: "Green Gram and Cowpeas", kcIni: 0.4, kcMid: 1.05, kcEnd: 0.35, kcNote: "Kc end 0.35 is for dry harvest; 0.60 if harvested fresh (footnote 6). Kc ini is the legumes group value.",
      heightM: 0.4, table22Row: "Green Gram and Cowpeas", rootDepthM: [0.6, 1.0], p: 0.45, waterBalance: "full",
      stages: [st(20, 30, 30, 20, "March", "Mediterranean")],
    },
    notes: ["Family checked for cowpea (VIUN); mung bean is in the same genus."],
  },
  {
    id: "groundnut", label: "Groundnut (peanut)", scientificName: "Arachis hypogaea", plantsSymbol: "ARHY", family: "Fabaceae", role: "crop",
    aliases: ["groundnut", "peanut", "peanuts", "চিনাবাদাম", "badam", "chinabadam"],
    fao56: {
      table12Row: "Groundnut (Peanut)", kcIni: 0.4, kcMid: 1.15, kcEnd: 0.6, kcNote: "Kc ini is the legumes group value.",
      heightM: 0.4, table22Row: "Groundnut (Peanut)", rootDepthM: [0.5, 1.0], p: 0.5, waterBalance: "full",
      stages: [st(25, 35, 45, 25, "Dry season", "West Africa"), st(35, 35, 35, 35, "(not stated)", "High Latitudes")],
    },
    notes: [],
  },
  {
    id: "potato", label: "Potato", scientificName: "Solanum tuberosum", plantsSymbol: "SOTU", family: "Solanaceae", role: "crop",
    aliases: ["potato", "potatoes", "potatoes, fall", "potatoes, spring", "potatoes, summer", "potatoes, all", "আলু", "alu", "aloo"],
    fao56: {
      table12Row: "Potato", kcIni: 0.5, kcMid: 1.15, kcEnd: 0.75, kcNote: "Kc end is about 0.40 for long-season potatoes with vine kill (footnote 4). Kc ini is the roots and tubers group value.",
      heightM: 0.6, table22Row: "Potato", rootDepthM: [0.4, 0.6], p: 0.35, waterBalance: "full",
      stages: [st(25, 30, 45, 30, "May", "Continental Climate"), st(30, 35, 50, 30, "April", "Europe"), st(45, 30, 70, 20, "Apr/May", "Idaho, USA"), st(30, 35, 50, 25, "Dec", "Calif. Desert, USA")],
    },
    notes: [],
  },
  {
    id: "cotton", label: "Cotton", scientificName: "Gossypium hirsutum", plantsSymbol: "GOHI", family: "Malvaceae", role: "crop",
    aliases: ["cotton", "cotton, all", "তুলা", "tula"],
    fao56: {
      table12Row: "Cotton", kcIni: 0.35, kcMid: { low: 1.15, high: 1.2 }, kcEnd: { low: 0.5, high: 0.7 }, kcNote: "Kc ini is the fibre crops group value.",
      heightM: [1.2,1.5], table22Row: "Cotton", rootDepthM: [1.0, 1.7], p: 0.65, waterBalance: "full",
      stages: [st(30, 50, 60, 55, "Mar-May", "Egypt; Pakistan; Calif."), st(45, 90, 45, 45, "Mar", "Calif. Desert, USA"), st(30, 50, 60, 55, "Sept", "Yemen"), st(30, 50, 55, 45, "April", "Texas")],
    },
    notes: [],
  },
  {
    id: "sunflower", label: "Sunflower", scientificName: "Helianthus annuus", plantsSymbol: "HEAN3", family: "Asteraceae", role: "crop",
    aliases: ["sunflower", "sunflower, all", "সূর্যমুখী", "surjomukhi"],
    fao56: {
      table12Row: "Sunflower", kcIni: 0.35, kcMid: { low: 1.0, high: 1.15 }, kcEnd: 0.35, rainfedUsesLowKcMid: true, kcNote: "Kc ini is the oil crops group value.",
      heightM: 2, table22Row: "Sunflower", rootDepthM: [0.8, 1.5], p: 0.45, waterBalance: "full", stages: [st(25, 35, 45, 25, "April/May", "Medit.; California")],
    },
    notes: [],
  },
  {
    id: "rapeseed", label: "Rapeseed / canola", scientificName: "Brassica napus", plantsSymbol: "BRNA", family: "Brassicaceae", role: "crop",
    aliases: ["rapeseed", "canola", "rape", "oilseed rape"],
    fao56: {
      table12Row: "Rapeseed, Canola", kcIni: 0.35, kcMid: { low: 1.0, high: 1.15 }, kcEnd: 0.35, rainfedUsesLowKcMid: true, kcNote: "Kc ini is the oil crops group value.",
      heightM: 0.6, table22Row: "Rapeseed, Canola", rootDepthM: [1.0, 1.5], p: 0.6, waterBalance: "full",
      stages: [st(13, 20, 32, 28, "30 October", "Jorhat, Assam, India", SARMA)],
    },
    notes: ["FAO-56 Table 11 has no rapeseed row; stage lengths come from a weighing-lysimeter study of rapeseed in Assam (the paper does not state the species of cv. TS 38).", "Return interval: at most once in three years (Canola Council of Canada)."],
  },
  {
    id: "sesame", label: "Sesame", scientificName: "Sesamum orientale", plantsSymbol: "SEIN3", family: "Pedaliaceae", role: "crop",
    aliases: ["sesame", "তিল", "til"],
    fao56: {
      table12Row: "Sesame", kcIni: 0.35, kcMid: 1.1, kcEnd: 0.25, kcNote: "Kc ini is the oil crops group value.",
      heightM: 1, table22Row: "Sesame", rootDepthM: [1.0, 1.5], p: 0.6, waterBalance: "full", stages: [st(20, 30, 40, 20, "June", "China")],
    },
    notes: [],
  },
  {
    id: "millet", label: "Millet", scientificName: null, plantsSymbol: null, family: "Poaceae", role: "crop",
    aliases: ["millet", "pearl millet", "proso millet", "kaon", "কাউন"],
    fao56: {
      table12Row: "Millet", kcIni: 0.3, kcMid: 1.0, kcEnd: 0.3, kcNote: "Kc ini is the cereals group value.",
      heightM: 1.5, table22Row: "Millet", rootDepthM: [1.0, 2.0], p: 0.55, waterBalance: "full",
      stages: [st(15, 25, 40, 25, "June", "Pakistan"), st(20, 30, 55, 35, "April", "Central USA")],
    },
    notes: ["FAO-56 'Millet' does not name a species. Family checked for pearl millet (PEGL2)."],
  },
  {
    id: "flax", label: "Flax / linseed", scientificName: "Linum usitatissimum", plantsSymbol: "LIUS", family: "Linaceae", role: "crop",
    aliases: ["flax", "linseed", "flaxseed", "তিসি", "tishi"],
    fao56: {
      table12Row: "Flax", kcIni: 0.35, kcMid: 1.1, kcEnd: 0.25, kcNote: "Kc ini is the fibre crops group value.",
      heightM: 1.2, table22Row: "Flax", rootDepthM: [1.0, 1.5], p: 0.5, waterBalance: "full",
      stages: [st(25, 35, 50, 40, "April", "Europe"), st(30, 40, 100, 50, "October", "Arizona")],
    },
    notes: [],
  },
  {
    id: "mustard", label: "Mustard", scientificName: "Brassica juncea", plantsSymbol: "BRJU", family: "Brassicaceae", role: "crop",
    aliases: ["mustard", "সরিষা", "shorisha", "sorisha", "sharisha", "sarisha"],
    fao56: {
      table12Row: "Not in FAO-56; Pereira et al. (2021) Table 12, Mustard (Brassica juncea)", kcIni: 0.35, kcMid: 1.15, kcEnd: 0.4,
      kcNote: "Kc mid and Kc end are the updated standard values (standard sub-humid climate) of Pereira et al. (2021) Table 12. Kc ini is the FAO-56 Table 12 oil crops group value (Pereira et al. did not update Kc ini).",
      heightM: [1.5, 2.0], table22Row: "Not in FAO-56; Pereira et al. (2021) Table 15, Mustard (B. juncea)", rootDepthM: [0.5, 1.1], p: 0.55, waterBalance: "full",
      paramSource: "Pereira, Paredes, Hunsaker, López-Urrea & Mohammadi Shad (2021), Standard single and basal crop coefficients for field crops. Updates and advances to the FAO56 crop water requirements method. Agric. Water Manag. 243:106466, Tables 12 and 15.",
      stages: [st(30, 40, 40, 20, "November", "New Delhi, India", GUPTA)],
    },
    notes: ["Not in FAO-56. Kc, rooting depth, height and p are the updated standard values of the FAO56 update for field crops (Pereira et al. 2021); stage lengths from a weighing-lysimeter study in New Delhi (Gupta et al. 2017)."],
  },
  {
    id: "jute", label: "Jute", scientificName: "Corchorus olitorius", plantsSymbol: "COOL", family: "Tiliaceae", familyNote: "USDA PLANTS lists Tiliaceae; APG IV places Corchorus in Malvaceae.", role: "crop",
    aliases: ["jute", "পাট", "pat", "paat"],
    fao56: {
      table12Row: "Not in FAO-56; Milla et al. (2018) Table 4", kcIni: 0.72, kcMid: 1.26, kcEnd: 0.46, kcLocal: true,
      kcNote: "Measured in Gazipur, Bangladesh (micro-lysimeter, irrigation every 14 days, the highest-yielding treatment). Kc end is the paper's late-season mean. The paper's development-stage mean (1.39) is above its mid-season value; the FAO-56 curve interpolates between Kc ini and Kc mid there, so development-stage water use may be underestimated. Measured in the local climate, so no Eq. 62/65 adjustment.",
      heightM: 3.62, table22Row: "Not published for jute", rootDepthM: null, p: null, waterBalance: "potential_only",
      paramSource: MILLA,
      stages: [st(25, 31, 39, 20, "18 April", "Gazipur, Bangladesh", MILLA)],
    },
    notes: ["Not in FAO-56 or its 2021 update. Kc and stage lengths were measured in Bangladesh (BARI and BJRI; Milla et al. 2018). No published rooting depth or depletion fraction was found, so jute water use is shown but no soil water balance or irrigation need is computed."],
  },
  {
    id: "rye", label: "Rye", scientificName: "Secale cereale", plantsSymbol: "SECE", family: "Poaceae", role: "crop",
    aliases: ["rye", "cereal rye", "winter rye"],
    fao56: null,
    notes: ["Not in FAO-56 Tables 11, 12 or 22."],
  },
  {
    id: "common_vetch", label: "Common vetch (cover)", scientificName: "Vicia sativa", plantsSymbol: "VISA", family: "Fabaceae", role: "cover",
    aliases: ["vetch", "common vetch"],
    fao56: null,
    notes: ["Not in FAO-56 Tables 11, 12 or 22."],
  },
  {
    id: "red_clover", label: "Red clover (cover)", scientificName: "Trifolium pratense", plantsSymbol: "TRPR2", family: "Fabaceae", role: "cover",
    aliases: ["clover", "red clover"],
    fao56: null,
    notes: ["FAO-56 'Clover hay, Berseem' describes a cut hay crop and is not used for a cover crop."],
  },
  {
    id: "radish", label: "Radish (cover)", scientificName: "Raphanus sativus", plantsSymbol: "RASA2", family: "Brassicaceae", role: "cover",
    aliases: ["radish", "tillage radish", "oilseed radish"],
    fao56: null,
    notes: ["FAO-56 'Radish' is a small vegetable, not a cover crop; not used."],
  },
];

/** Names meaning "nothing planted" (not a crop). */
export const FALLOW_NAMES = ["fallow", "bare", "none", "fallow land", "পতিত", "potit"];

const norm = (s: string) => s.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");

export function isFallowName(name: string): boolean {
  return FALLOW_NAMES.includes(norm(name));
}

/** Resolves a farmer's crop name to a catalogue entry: exact alias first, then any whole word. */
export function resolveCrop(name: string, catalog: CropParams[]): CropParams | null {
  const key = norm(name);
  for (const c of catalog) if (c.id === key || c.aliases.some((a) => norm(a) === key)) return c;
  const words = key.split(/[\s,/()-]+/).filter(Boolean);
  for (let n = words.length; n >= 1; n--)
    for (let i = 0; i + n <= words.length; i++) {
      const phrase = words.slice(i, i + n).join(" ");
      for (const c of catalog) if (c.aliases.some((a) => norm(a) === phrase)) return c;
    }
  return null;
}

/** Display threshold for "deep-rooted" (Astrapon convention, not an FAO category). */
export const DEEP_ROOT_THRESHOLD_M = 1.5;

export function isLegume(c: CropParams): boolean {
  return c.family === "Fabaceae";
}

export function isDeepRooted(c: CropParams): boolean {
  return (c.fao56?.rootDepthM?.[1] ?? 0) >= DEEP_ROOT_THRESHOLD_M;
}
