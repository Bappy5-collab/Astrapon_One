import type { EvidenceClass } from "@/domain/provenance/evidence";

import { BASELINE, DRY_DAY_MM, DRY_SPELL_MIN_DAYS, FROST_THRESHOLD_C, HEAT_THRESHOLD_C, NDVI_MIN_GOOD_PER_YEAR, NDVI_MIN_YEARS_FOR_TREND, YEAR_MIN_COMPLETENESS } from "./indicators";
import { MONTH_MIN_COMPLETENESS } from "./aggregate";

/**
 * Version of Astrapon's own processing (normalisation + aggregation). Part of every cache key and retrieval.
 * evidence-1.3.0 adds NASA GPM IMERG daily rain, Final and Late Run (their own daily series, never merged with each other or with POWER rain).
 */
export const PROCESSING_VERSION = "evidence-1.3.0";

export const PIPELINE_SOURCES = ["nasa-power-daily", "gpm-imerg-daily", "modis-mod13q1-ornl", "usda-ssurgo-sda", "isric-soilgrids-v2", "smap-l3-enhanced"] as const;
export type PipelineSource = (typeof PIPELINE_SOURCES)[number];

/**
 * Sources fetched only when the user asks for them. They are never part of "Refresh all", never
 * used by the simulation engine (which pins POWER, IMERG rain and soil only), and the worker takes them last.
 */
export const OPTIONAL_SOURCES: readonly PipelineSource[] = ["modis-mod13q1-ornl", "smap-l3-enhanced"];
export const isOptionalSource = (s: PipelineSource) => OPTIONAL_SOURCES.includes(s);

export const SOURCE_LABELS: Record<PipelineSource, { name: string; short: string; evidenceClass: EvidenceClass; support: string; staleAfterDays: number; plain: string }> = {
  "nasa-power-daily": {
    name: "NASA POWER daily (Agroclimatology)",
    short: "NASA POWER",
    evidenceClass: "assimilated_model_product",
    support: "One ½° × ⅝° grid cell (about 55 × 50 km at mid-latitudes)",
    staleAfterDays: 30,
    plain: "Daily weather from a global model that blends observations. One value for the whole area around your field.",
  },
  "gpm-imerg-daily": {
    name: "NASA GPM IMERG daily precipitation V07 (Final Run GPM_3IMERGDF + Late Run GPM_3IMERGDL)",
    short: "NASA IMERG rain",
    evidenceClass: "satellite_observation",
    support: "One 0.1° × 0.1° grid cell (about 11 × 10 km)",
    staleAfterDays: 30,
    plain: "Daily rain measured from space by NASA's GPM satellites, since 1998. One value for an 11 km square around your field, finer than the weather model.",
  },
  "modis-mod13q1-ornl": {
    name: "MODIS Terra MOD13Q1 v061 NDVI (via ORNL DAAC)",
    short: "MODIS greenness",
    evidenceClass: "satellite_observation",
    support: "≈232 m sinusoidal pixels, 16-day composites",
    staleAfterDays: 32,
    plain: "Satellite greenness (NDVI) every 16 days for the last 10 years. Each pixel is about the size of 5 football pitches and may mix several fields.",
  },
  "usda-ssurgo-sda": {
    name: "USDA NRCS SSURGO via Soil Data Access",
    short: "SSURGO soil survey",
    evidenceClass: "ground_measurement",
    support: "Soil survey map-unit polygon containing the field centre (United States only)",
    staleAfterDays: 365,
    plain: "Soil survey values for the mapped soil under the field centre.",
  },
  "isric-soilgrids-v2": {
    name: "ISRIC SoilGrids 2.0 water retention",
    short: "SoilGrids soil water",
    evidenceClass: "assimilated_model_product",
    support: "One 250 m model pixel at the field centre (global)",
    staleAfterDays: 365,
    plain: "How much water the soil can hold, estimated by a global soil model. Used where no soil survey or soil test exists.",
  },
  "smap-l3-enhanced": {
    name: "NASA SMAP L3 Enhanced soil moisture (SPL3SMP_E v006)",
    short: "SMAP soil moisture",
    evidenceClass: "satellite_observation",
    support: "One 9 km EASE-Grid 2.0 cell (about 81 km²)",
    staleAfterDays: 30,
    plain: "How wet the top 5 cm of soil was, measured from space by NASA's SMAP satellite, for the last two years. One value for a 9 km square.",
  },
};

export type IndicatorDef = {
  id: string;
  label: string;
  /** Plain-language one-liner shown by default. */
  plain: string;
  unit: string;
  source: PipelineSource;
  variables: string[];
  transformation: string[];
  completeness: string;
  limitations: string[];
};

const NOT_DAMAGE = "Describes past conditions in the grid cell; it is not a measure of crop damage and not a forecast.";
const COARSE = "One value for the whole grid cell: it cannot differ between your zones.";

export const INDICATORS: Record<string, IndicatorDef> = {
  frost_days: {
    id: "frost_days",
    label: "Frost days per year",
    plain: `Days when the daily minimum air temperature at 2 m was ${FROST_THRESHOLD_C} °C or lower.`,
    unit: "days/year",
    source: "nasa-power-daily",
    variables: ["T2M_MIN"],
    transformation: [`Daily T2M_MIN (°C, local solar time) from POWER`, `Count days with T2M_MIN ≤ ${FROST_THRESHOLD_C} °C in each calendar year`, "Average over the years shown"],
    completeness: `A year is counted only if at least ${YEAR_MIN_COMPLETENESS * 100}% of its days are valid. Missing days are not filled.`,
    limitations: [NOT_DAMAGE, COARSE, "Air temperature at 2 m over the cell; ground frost in low spots can be more frequent.", "The threshold is generic, not crop- or stage-specific."],
  },
  heat_days: {
    id: "heat_days",
    label: "Hot days per year",
    plain: `Days when the daily maximum air temperature at 2 m reached ${HEAT_THRESHOLD_C} °C or more.`,
    unit: "days/year",
    source: "nasa-power-daily",
    variables: ["T2M_MAX"],
    transformation: ["Daily T2M_MAX (°C) from POWER", `Count days with T2M_MAX ≥ ${HEAT_THRESHOLD_C} °C in each calendar year`, "Average over the years shown"],
    completeness: `A year is counted only if at least ${YEAR_MIN_COMPLETENESS * 100}% of its days are valid.`,
    limitations: [NOT_DAMAGE, COARSE, "The threshold is generic; crop sensitivity depends on stage and duration."],
  },
  dry_spell_longest: {
    id: "dry_spell_longest",
    label: "Longest dry spell per year",
    plain: `The longest run of consecutive days with less than ${DRY_DAY_MM} mm of precipitation.`,
    unit: "days",
    source: "nasa-power-daily",
    variables: ["PRECTOTCORR"],
    transformation: ["Daily PRECTOTCORR (mm/day, bias-corrected) from POWER", `Mark days below ${DRY_DAY_MM} mm as dry`, "Longest run inside each calendar year; a missing day ends a run", "Average over the years shown"],
    completeness: `A year is counted only if at least ${YEAR_MIN_COMPLETENESS * 100}% of its days are valid.`,
    limitations: [NOT_DAMAGE, COARSE, "Rainfall is modelled for the whole cell; local showers are not resolved.", "Ignores irrigation and stored soil water."],
  },
  dry_spells_10d: {
    id: "dry_spells_10d",
    label: `Dry spells of ${DRY_SPELL_MIN_DAYS}+ days per year`,
    plain: `How many times a year it stayed dry (below ${DRY_DAY_MM} mm/day) for at least ${DRY_SPELL_MIN_DAYS} days in a row.`,
    unit: "spells/year",
    source: "nasa-power-daily",
    variables: ["PRECTOTCORR"],
    transformation: ["Daily PRECTOTCORR from POWER", `Runs of ≥ ${DRY_SPELL_MIN_DAYS} dry days inside each calendar year`, "Average over the years shown"],
    completeness: `As for dry spells: ≥ ${YEAR_MIN_COMPLETENESS * 100}% valid days per year.`,
    limitations: [NOT_DAMAGE, COARSE],
  },
  precip_season: {
    id: "precip_season",
    label: "Seasonal precipitation",
    plain: `Total precipitation in each three-month season, compared with the ${BASELINE.start}–${BASELINE.end} average for that season.`,
    unit: "mm",
    source: "nasa-power-daily",
    variables: ["PRECTOTCORR"],
    transformation: [
      "Daily PRECTOTCORR (mm/day) from POWER",
      `Monthly totals; a month needs ≥ ${MONTH_MIN_COMPLETENESS * 100}% valid days or it is left empty`,
      "Season = sum of its three months (Dec–Feb uses the previous December); a season with an empty month is left empty",
      `Normal = mean of the same calendar month over ${BASELINE.start}–${BASELINE.end}`,
    ],
    completeness: `Monthly ≥ ${MONTH_MIN_COMPLETENESS * 100}% valid days; normal needs ≥ 24 of 30 baseline years.`,
    limitations: [NOT_DAMAGE, COARSE, "Model-derived precipitation; no second rainfall product is added in, to avoid double counting."],
  },
  temp_anomaly: {
    id: "temp_anomaly",
    label: "Temperature compared with normal",
    plain: `How much warmer or cooler each month was than its ${BASELINE.start}–${BASELINE.end} average (daily mean air temperature).`,
    unit: "°C",
    source: "nasa-power-daily",
    variables: ["T2M"],
    transformation: ["Daily T2M (°C) from POWER", `Monthly mean (≥ ${MONTH_MIN_COMPLETENESS * 100}% valid days)`, `Anomaly = month − mean of that calendar month over ${BASELINE.start}–${BASELINE.end}`],
    completeness: "Months below the completeness threshold have no anomaly.",
    limitations: [NOT_DAMAGE, COARSE, "Uses daily mean air temperature only; not mixed with maximum/minimum or land-surface temperature."],
  },
  soil_wetness: {
    id: "soil_wetness",
    label: "Root-zone soil wetness (model)",
    plain: "A model estimate of how wet the top metre of soil was, from 0 (dry) to 1 (saturated), compared with normal.",
    unit: "0–1",
    source: "nasa-power-daily",
    variables: ["GWETROOT"],
    transformation: ["Daily GWETROOT (dimensionless wetness) from POWER", "Monthly mean", `Compared with the ${BASELINE.start}–${BASELINE.end} mean of the same month`],
    completeness: `Monthly ≥ ${MONTH_MIN_COMPLETENESS * 100}% valid days.`,
    limitations: [
      COARSE,
      "Model-derived wetness fraction for a ~1 m root zone. It is not a volumetric water content and is not combined with satellite surface soil moisture (different depth and quantity).",
      "Says nothing about your field's own drainage or irrigation.",
    ],
  },
  ndvi_peak: {
    id: "ndvi_peak",
    label: "Peak greenness per year (NDVI)",
    plain: "The highest cloud-free greenness the satellite saw each year, and its long-term direction.",
    unit: "NDVI (−1 to 1)",
    source: "modis-mod13q1-ornl",
    variables: ["ndvi", "ndvi_annual_peak"],
    transformation: [
      "MOD13Q1 v061 16-day NDVI, scaled by 0.0001",
      "Only composites with pixel reliability 0 (good) are kept; cloudy, snow and marginal composites are dropped, not filled",
      "Field value = mean of pixels lying ≥ 75% inside the field, or the pixel at the field centre when none do",
      `Annual peak = highest good composite, if the year has ≥ ${NDVI_MIN_GOOD_PER_YEAR} good composites`,
      `Trend = Theil–Sen slope per decade over ≥ ${NDVI_MIN_YEARS_FOR_TREND} years (descriptive, no significance test)`,
    ],
    completeness: `Years with fewer than ${NDVI_MIN_GOOD_PER_YEAR} good composites are left empty.`,
    limitations: [
      "NDVI cannot identify the crop, and cannot establish yield, disease or nutrient status.",
      "A ≈232 m pixel can mix your field with neighbours, roads and field edges.",
      "Peak timing depends on the 16-day compositing window.",
    ],
  },
  awc: {
    id: "awc",
    label: "Plant-available water capacity, top 100 cm",
    plain: "How much water the mapped soil can hold for plants in the top metre, from the US soil survey.",
    unit: "mm",
    source: "usda-ssurgo-sda",
    variables: ["awc_0_100cm"],
    transformation: ["Survey representative AWC (cm/cm) per horizon of each major component", "Horizon thickness × AWC summed to 100 cm (mm)", "Weighted by component share; components with missing horizons are excluded and reported"],
    completeness: "A component missing any horizon value inside 0–100 cm is excluded rather than counted short.",
    limitations: ["Survey map-unit values, not a measurement in your field.", "United States only; elsewhere no value is shown.", "Your own soil tests (Records page) take precedence."],
  },
  smap_sm: {
    id: "smap_sm",
    label: "Satellite surface soil moisture (SMAP, top 5 cm)",
    plain: "How wet the top 5 cm of soil was, measured by NASA's SMAP satellite: the average of the last 12 months, and the driest and wettest months.",
    unit: "m³/m³",
    source: "smap-l3-enhanced",
    variables: ["smap_sm", "smap_sm_any"],
    transformation: ["SPL3SMP_E v006 daily AM and PM retrievals for the 9 km cell (DCA algorithm)", "Day value = mean of the day's retrievals; recommended-quality retrievals only (flag bit 0 = 0), with all valid retrievals kept separately", "Monthly mean of the days with a value"],
    completeness: "Missing days (no overpass, failed retrieval) stay missing; each month reports how many days it has.",
    limitations: ["Top 5 cm only, not the root zone.", "One value for a 9 km cell: irrigated plots, ponds and towns inside it all count.", "Retrievals flagged 'not recommended' (urban, water, dense vegetation) are shown separately, never mixed in silently.", "Not used by the rotation engine; context only."],
  },
  imerg_precip: {
    id: "imerg_precip",
    label: "Satellite rain, last 12 months (NASA GPM IMERG)",
    plain: "How much rain fell in the last 12 complete months, measured from space by NASA's GPM satellites for the 11 km square around your field.",
    unit: "mm",
    source: "gpm-imerg-daily",
    variables: ["imerg_precip"],
    transformation: ["GPM_3IMERGDL (Late Run) V07 daily precipitation (mm/day) for the 0.1° cell containing the field, through NASA Harmony (Giovanni area-average time series over a box inside the cell)", "Fill values and negative or implausible values kept missing", "Monthly totals of complete months; 12-month total compared with the NASA POWER total for the same months"],
    completeness: "A month counts only when every day has a value; missing days are never filled.",
    limitations: ["A satellite estimate for an 11 km cell, not a rain gauge in your field.", "Recent months come from the Late Run, which is calibrated to climatology, not to rain gauges; the gauge-calibrated Final Run (also stored, used by comparisons when it covers their years) ends on 2025-09-30 until NASA releases V08. In single years the two can differ by a third.", "Days are UTC days (in Bangladesh, 6 a.m. to 6 a.m. local time).", "Weaker over snow, steep mountains and coasts."],
  },
  awc_global: {
    id: "awc_global",
    label: "Plant-available water capacity, top 100 cm (global soil model)",
    plain: "How much water the soil can hold for plants in the top metre, estimated by the SoilGrids global soil model.",
    unit: "mm",
    source: "isric-soilgrids-v2",
    variables: ["awc_0_100cm"],
    transformation: ["SoilGrids 2.0 water content at 33 kPa (field capacity) and 1500 kPa (wilting point), layer means, vol %", "(FC − WP) × layer thickness for 0–5, 5–15, 15–30, 30–60 and 60–100 cm", "Summed to mm in the top 100 cm"],
    completeness: "Every layer must have both values; otherwise up to four points about 500 m away are tried and the one used is stated.",
    limitations: ["A 250 m machine-learning estimate, not a measurement in your field.", "Your own soil test and, in the US, the soil survey take precedence.", "Prediction intervals are wide; quantiles cannot be subtracted, so no range is given."],
  },
};
