/**
 * Regional terrestrial water storage from NASA GRACE / GRACE-FO (JPL mascons RL06.3Mv04 CRI).
 * Pure. Input is the stored series of the 3° mascon containing the field (about 300 km): the
 * equivalent water thickness anomaly relative to the 2004.000–2009.999 mean, in mm, multiplied by
 * the 0.5° cell's CRI land scale factor as JPL recommends for land hydrology.
 *
 * It is total water on and under the land (soil moisture, groundwater, surface water, snow), for a
 * region far larger than any farm. It can show a regional decline or a dry-season low; it cannot
 * show a well's level, separate pumping from drought, or describe one field.
 */

export type GraceFile = {
  source: string;
  doi: string;
  citation: string;
  granule: string;
  retrievedAt: string;
  units: string;
  nativeResolution: string;
  grid: { lat0: number; lon0: number; step: number; nLat: number; nLon: number };
  months: string[];
  rows: Record<string, [number, number, number[]][]>;
  series: Record<string, { lwe: (number | null)[]; unc: (number | null)[] }>;
};

/** Mascon id and land scale factor of the 0.5° land cell containing (lat, lon); null over ocean. */
export function graceCell(file: Pick<GraceFile, "grid" | "rows">, lat: number, lon: number): { masconId: number; scale: number; cellLat: number; cellLon: number } | null {
  const { lat0, lon0, step, nLat, nLon } = file.grid;
  const lonE = ((lon % 360) + 360) % 360;
  const i = Math.round((lat - lat0) / step);
  const j = Math.round((lonE - lon0) / step) % nLon;
  if (i < 0 || i >= nLat) return null;
  for (const [j0, m, scales] of file.rows[String(i)] ?? []) if (j >= j0 && j < j0 + scales.length) return { masconId: m, scale: scales[j - j0]!, cellLat: lat0 + i * step, cellLon: ((lon0 + j * step + 180) % 360) - 180 };
  return null;
}

export type GraceSummary = {
  /** Months with a value / months in the record. */
  validMonths: number;
  totalMonths: number;
  firstMonth: string;
  lastMonth: string;
  latest: { month: string; mm: number; uncertaintyMm: number | null };
  /** Least-squares trend of the deseasonalised series (mm/year). */
  trendMmPerYear: number | null;
  /** Mean of the last 3 complete years minus the first 3 complete years (mm). */
  change: { fromYears: [number, number]; toYears: [number, number]; mm: number } | null;
  /** Calendar month of the lowest and highest average storage, and the average yearly swing (mm). */
  seasonal: { lowMonth: number; highMonth: number; swingMm: number } | null;
  /** Yearly means for years with at least 9 months (mm). */
  years: { year: number; mm: number }[];
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function graceSummary(months: string[], lweMm: (number | null)[], uncMm: (number | null)[], scale: number): GraceSummary | null {
  const pts = months.map((m, k) => ({ m, y: Number(m.slice(0, 4)), mo: Number(m.slice(5, 7)), v: lweMm[k] == null ? null : lweMm[k]! * scale, u: uncMm[k] ?? null })).filter((p): p is { m: string; y: number; mo: number; v: number; u: number | null } => p.v != null);
  if (pts.length < 24) return null;
  const clim = Array.from({ length: 12 }, (_, i) => {
    const xs = pts.filter((p) => p.mo === i + 1).map((p) => p.v);
    return xs.length ? mean(xs) : null;
  });
  // Trend on deseasonalised anomalies (needs every calendar month and at least 8 years).
  let trend: number | null = null;
  const span = pts.at(-1)!.y + pts.at(-1)!.mo / 12 - (pts[0]!.y + pts[0]!.mo / 12);
  if (clim.every((c) => c != null) && span >= 8) {
    const xs = pts.map((p) => p.y + (p.mo - 0.5) / 12), ys = pts.map((p) => p.v - clim[p.mo - 1]!);
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0;
    xs.forEach((x, k) => { sxy += (x - mx) * (ys[k]! - my); sxx += (x - mx) ** 2; });
    trend = sxx > 0 ? sxy / sxx : null;
  }
  const byYear = new Map<number, number[]>();
  for (const p of pts) byYear.set(p.y, [...(byYear.get(p.y) ?? []), p.v]);
  const years = [...byYear.entries()].filter(([, v]) => v.length >= 9).map(([year, v]) => ({ year, mm: Math.round(mean(v)) })).sort((a, b) => a.year - b.year);
  const full = [...byYear.entries()].filter(([, v]) => v.length >= 11).map(([y]) => y).sort((a, b) => a - b);
  let change: GraceSummary["change"] = null;
  if (full.length >= 6) {
    const first = full.slice(0, 3), last = full.slice(-3);
    const avg = (ys: number[]) => mean(ys.map((y) => mean(byYear.get(y)!)));
    change = { fromYears: [first[0]!, first[2]!], toYears: [last[0]!, last[2]!], mm: Math.round(avg(last) - avg(first)) };
  }
  let seasonal: GraceSummary["seasonal"] = null;
  if (clim.every((c) => c != null)) {
    const c = clim as number[];
    const lo = c.indexOf(Math.min(...c)), hi = c.indexOf(Math.max(...c));
    seasonal = { lowMonth: lo + 1, highMonth: hi + 1, swingMm: Math.round(c[hi]! - c[lo]!) };
  }
  const last = pts.at(-1)!;
  return {
    validMonths: pts.length,
    totalMonths: months.length,
    firstMonth: pts[0]!.m,
    lastMonth: last.m,
    latest: { month: last.m, mm: Math.round(last.v), uncertaintyMm: last.u == null ? null : Math.round(last.u * scale) },
    trendMmPerYear: trend == null ? null : Math.round(trend * 10) / 10,
    change,
    seasonal,
    years,
  };
}

export type GraceContext = {
  summary: GraceSummary;
  cell: { lat: number; lon: number; masconId: number; scale: number };
  source: { name: string; doi: string; citation: string; granule: string; retrievedAt: string; nativeResolution: string };
};
