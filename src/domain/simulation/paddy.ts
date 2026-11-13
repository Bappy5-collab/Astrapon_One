/**
 * Engine 1.3.0: irrigation need of flooded (paddy) rice, FAO Irrigation Water Management Training
 * Manual No. 3, "Irrigation Water Needs" (Brouwer & Heibloem 1986), Part II §4.4:
 *
 *   IN = ETcrop + SAT + PERC + WL − Pe   (per calendar month, never below 0)
 *
 *  - ETcrop = Kc × ET0 with FAO-56 Table 12 rice Kc (standing-water evaporation included, FAO-56
 *    "Kc ini for paddy rice");
 *  - SAT = 200 mm to saturate the root zone, "in the month before sowing or transplanting"
 *    (spread over the 30 days before planting);
 *  - PERC = percolation + seepage while ponded: "for heavy clay 4, for sandy soils 8, on average
 *    6 mm/day" (the average is used; 4 and 8 are reported as the range);
 *  - WL = 100 mm to establish the water layer at transplanting (maintaining it is in PERC);
 *  - Pe = 0.8 P − 25 if P > 75 mm/month, 0.6 P − 10 otherwise, never negative (§4.2), applied to
 *    each calendar month's rain; a partial month is scaled to a full month and back.
 *
 * Under ponding the crop is not water-limited, so ETa = ETc. After the paddy is drained the next
 * crop starts with the soil at field capacity (FAO-56 Ch. 8: "following heavy rain or irrigation").
 */

import { isoDate } from "./dates";

export const PADDY = { satMm: 200, satDays: 30, waterLayerMm: 100, percMmPerDay: 6, percRange: [4, 8] as const } as const;

/** FAO Training Manual No. 3 §4.2 effective rainfall for a full month (mm). */
export function effectiveRainMonth(pMm: number): number {
  return Math.max(0, pMm > 75 ? 0.8 * pMm - 25 : 0.6 * pMm - 10);
}

export type PaddyMonth = { month: string; days: number; etcMm: number; satMm: number; percMm: number; layerMm: number; rainMm: number; effectiveRainMm: number; irrigationMm: number };

/**
 * Monthly paddy irrigation for one planting. `startDay` is the absolute day index of planting,
 * `etc` the daily ETc of the planting (length L), `precip` the daily rain from 30 days before
 * planting to harvest (length 30 + L). Returns null when any rain or ETc value is missing.
 */
export function paddyIrrigation(startDay: number, etc: (number | null)[], precip: (number | null)[], percMmPerDay: number = PADDY.percMmPerDay): { irrigationMm: number; months: PaddyMonth[]; percolationMm: number } | null {
  const L = etc.length;
  if (precip.length !== PADDY.satDays + L) throw new Error("Paddy rain window must cover the 30 days before planting and the season");
  if (etc.some((v) => v == null) || precip.some((v) => v == null)) return null;
  const by = new Map<string, PaddyMonth & { calDays: number }>();
  for (let k = -PADDY.satDays; k < L; k++) {
    const iso = isoDate(startDay + k);
    const key = iso.slice(0, 7);
    const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7));
    const calDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const row = by.get(key) ?? { month: key, days: 0, etcMm: 0, satMm: 0, percMm: 0, layerMm: 0, rainMm: 0, effectiveRainMm: 0, irrigationMm: 0, calDays };
    row.days++;
    row.rainMm += precip[k + PADDY.satDays]!;
    if (k < 0) row.satMm += PADDY.satMm / PADDY.satDays;
    else {
      row.etcMm += etc[k]!;
      row.percMm += percMmPerDay;
      if (k === 0) row.layerMm += PADDY.waterLayerMm;
    }
    by.set(key, row);
  }
  const months: PaddyMonth[] = [];
  let total = 0, perc = 0;
  for (const r of by.values()) {
    const scale = r.calDays / r.days;
    const pe = effectiveRainMonth(r.rainMm * scale) / scale;
    const need = Math.max(0, r.etcMm + r.satMm + r.percMm + r.layerMm - pe);
    total += need;
    perc += r.percMm;
    months.push({ month: r.month, days: r.days, etcMm: r.etcMm, satMm: r.satMm, percMm: r.percMm, layerMm: r.layerMm, rainMm: r.rainMm, effectiveRainMm: pe, irrigationMm: need });
  }
  return { irrigationMm: total, months, percolationMm: perc };
}
