import { z } from "zod";

import { cropParamsSchema } from "./catalog";
import { calendarEntrySchema } from "./nass";

/**
 * The engine's complete input: a frozen snapshot plus the immutable rows it pins (reference
 * datasets by id and hash, the POWER daily series and the SSURGO aggregate of pinned retrievals).
 * Built by the worker; nothing else is read. Parsing is lenient about extra keys and strict about
 * the values the engine uses.
 */

const num = z.number().finite();
const nullableNum = num.nullable();

export const snapshotInputsSchema = z
  .object({
    input_schema_version: z.number().int(),
    scenario: z.object({ id: z.string(), name: z.string(), settings_schema_version: z.number().int(), settings: z.unknown() }).passthrough(),
    field: z
      .object({
        id: z.string(),
        name: z.string(),
        area_ha: nullableNum.optional().default(null),
        centroid: z.object({ type: z.literal("Point"), coordinates: z.tuple([num, num]) }).nullable(),
      })
      .passthrough(),
    zones: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()).default([]),
    crop_history: z
      .array(
        z
          .object({
            id: z.string(),
            zone_id: z.string().nullable(),
            season_year: z.number().int(),
            season: z.string(),
            crop_name: z.string(),
            planted_on: z.string().nullable(),
            harvested_on: z.string().nullable(),
          })
          .passthrough(),
      )
      .default([]),
    soil_observations: z
      .array(
        z
          .object({
            id: z.string(),
            zone_id: z.string().nullable(),
            property: z.string(),
            value_numeric: nullableNum,
            depth_top_cm: num,
            depth_bottom_cm: num,
            evidence_class: z.string(),
            observed_on: z.string(),
          })
          .passthrough(),
      )
      .default([]),
    constraints: z.object({ irrigation: z.string().nullable(), seasonal_water_allocation_mm: nullableNum }).passthrough().nullable().default(null),
    priorities: z
      .object({
        water_use: num, soil_health: num, income_stability: num, workload: num, weather_risk: num, diversification: num,
        excluded_crops: z.array(z.string()).default([]),
      })
      .passthrough()
      .nullable()
      .default(null),
    market_preferences: z.array(z.object({ crop_name: z.string(), preference: z.string(), has_contract: z.boolean() }).passthrough()).default([]),
  })
  .passthrough();

export type SnapshotInputs = z.infer<typeof snapshotInputsSchema>;

const datasetRef = z.object({ id: z.string(), name: z.string(), version: z.number().int(), sha256: z.string() });

export const engineInputSchema = z.object({
  engineVersion: z.string(),
  snapshot: z.object({ id: z.string(), inputsSha256: z.string(), inputs: snapshotInputsSchema }),
  cropDataset: datasetRef.extend({ items: z.array(cropParamsSchema) }).nullable(),
  /** 1.1.0 inputs carried one calendar; 1.2.0 inputs carry every pinned calendar dataset (NASS, FAO). */
  calendarDataset: datasetRef.extend({ items: z.array(calendarEntrySchema) }).nullable().optional().default(null),
  calendarDatasets: z.array(datasetRef.extend({ items: z.array(calendarEntrySchema.passthrough()) })).optional().default([]),
  weather: z
    .object({
      retrievalId: z.string(),
      productVersion: z.string().nullable(),
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      tmax: z.array(nullableNum),
      tmin: z.array(nullableNum),
      precip: z.array(nullableNum),
      /** 1.3.0: Penman-Monteith inputs from the same retrieval (absent for evidence-1.1.0 retrievals). */
      tdew: z.array(nullableNum).optional(),
      wind: z.array(nullableNum).optional(),
      rs: z.array(nullableNum).optional(),
      elevationM: z.number().finite().nullable().optional(),
    })
    .nullable(),
  /** 1.4.0: NASA GPM IMERG daily rain (its own pinned retrieval: Final and/or Late Run), used for a whole run only when it covers the replay window. */
  rain: z
    .object({
      retrievalId: z.string(),
      productVersion: z.string().nullable(),
      final: z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), values: z.array(nullableNum) }).nullable(),
      late: z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), values: z.array(nullableNum) }).nullable(),
    })
    .nullable()
    .optional()
    .default(null),
  /** Soil survey (SSURGO) or, from 1.3.0, the SoilGrids 2.0 model estimate; absent source = SSURGO. */
  soilSurvey: z.object({ retrievalId: z.string(), awcMm0to100: nullableNum, source: z.enum(["usda-ssurgo-sda", "isric-soilgrids-v2"]).optional() }).nullable(),
});

export type EngineInput = z.infer<typeof engineInputSchema>;
