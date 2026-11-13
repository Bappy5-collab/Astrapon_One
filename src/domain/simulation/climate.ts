import { dayIndex, dayOfYear } from "./dates";

/**
 * Daily weather for the engine, reference evapotranspiration and the scenario transformations.
 * ET0 is FAO-56 Penman-Monteith (Eq. 6) when the weather carries dew point, 2 m wind and
 * shortwave radiation (engine 1.3.0, NASA POWER evidence-1.2.0); otherwise FAO-56 Hargreaves
 * (Eq. 52) for the whole run, never mixed within a run. Missing days stay null; nothing is
 * interpolated.
 */

export type DailyWeather = {
  /** Absolute day index of element 0. */
  startDay: number;
  tmax: (number | null)[];
  tmin: (number | null)[];
  precip: (number | null)[];
  /** Penman-Monteith inputs (engine 1.3.0): dew point °C, wind at 2 m m/s, shortwave radiation MJ m⁻² day⁻¹, site elevation m. */
  pm?: { tdew: (number | null)[]; wind: (number | null)[]; rs: (number | null)[]; elevationM: number };
  /** Transformations already applied, in order (empty for historical replay). */
  applied: Transformation[];
};

export type Transformation =
  | { kind: "precipitation_scale"; percent: number }
  | { kind: "temperature_offset"; celsius: number };

export const TRANSFORM_LIMITS = { precipitationPercent: [-50, 50], temperatureCelsius: [-5, 5] } as const;

/** FAO-56 Eq. 21–25: extraterrestrial radiation, MJ m⁻² day⁻¹. */
export function extraterrestrialRadiation(latitudeDeg: number, doy: number): number {
  const GSC = 0.082; // MJ m⁻² min⁻¹
  const phi = (Math.PI / 180) * latitudeDeg;
  const dr = 1 + 0.033 * Math.cos(((2 * Math.PI) / 365) * doy);
  const delta = 0.409 * Math.sin(((2 * Math.PI) / 365) * doy - 1.39);
  const x = Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta)));
  const ws = Math.acos(x);
  const ra = ((24 * 60) / Math.PI) * GSC * dr * (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));
  return Math.max(0, ra);
}

/** FAO-56 Eq. 52 (Hargreaves), mm/day. Ra converted with 0.408 (Eq. 20). */
export function hargreavesEt0(tmax: number, tmin: number, latitudeDeg: number, doy: number): number {
  if (tmax < tmin) throw new RangeError("Tmax below Tmin");
  const raMm = 0.408 * extraterrestrialRadiation(latitudeDeg, doy);
  const tmean = (tmax + tmin) / 2;
  return Math.max(0, 0.0023 * (tmean + 17.8) * Math.sqrt(tmax - tmin) * raMm);
}

/** FAO-56 Eq. 11: saturation vapour pressure at T (°C), kPa. */
export const satVp = (t: number) => 0.6108 * Math.exp((17.27 * t) / (t + 237.3));

/**
 * FAO-56 Penman-Monteith reference evapotranspiration (Eq. 6), mm/day, with G = 0 for daily steps
 * (Eq. 42). ea from dew point (Eq. 14), es as the mean of e°(Tmax) and e°(Tmin) (Eq. 12), Δ at
 * the mean temperature (Eq. 13), P and γ from elevation (Eq. 7–8), Rso from elevation (Eq. 37),
 * albedo 0.23 (Eq. 38), Rnl (Eq. 39) with Rs/Rso capped at 1. Returns null when Rso ≤ 0 (no sun).
 */
export function penmanMonteithEt0(d: { tmax: number; tmin: number; tdew: number; u2: number; rs: number }, latitudeDeg: number, doy: number, elevationM: number): number | null {
  if (d.tmax < d.tmin) throw new RangeError("Tmax below Tmin");
  const tmean = (d.tmax + d.tmin) / 2;
  const pressure = 101.3 * ((293 - 0.0065 * elevationM) / 293) ** 5.26;
  const gamma = 0.000665 * pressure;
  const es = (satVp(d.tmax) + satVp(d.tmin)) / 2;
  const ea = satVp(d.tdew);
  const delta = (4098 * satVp(tmean)) / (tmean + 237.3) ** 2;
  const ra = extraterrestrialRadiation(latitudeDeg, doy);
  const rso = (0.75 + 2e-5 * elevationM) * ra;
  if (!(rso > 0)) return null;
  const rns = (1 - 0.23) * d.rs;
  const SIGMA = 4.903e-9; // MJ K⁻⁴ m⁻² day⁻¹
  const tk4 = ((d.tmax + 273.16) ** 4 + (d.tmin + 273.16) ** 4) / 2;
  const rnl = SIGMA * tk4 * (0.34 - 0.14 * Math.sqrt(Math.max(0, ea))) * (1.35 * Math.min(1, d.rs / rso) - 0.35);
  const rn = rns - rnl;
  const et0 = (0.408 * delta * rn + gamma * (900 / (tmean + 273)) * d.u2 * (es - ea)) / (delta + gamma * (1 + 0.34 * d.u2));
  return Math.max(0, et0);
}

export type Et0Method = "penman_monteith" | "hargreaves";
export const et0Method = (w: DailyWeather): Et0Method => (w.pm ? "penman_monteith" : "hargreaves");

/** Validates physical ranges. Throws on impossible data rather than repairing it. */
export function validateWeather(w: DailyWeather): void {
  const n = w.tmax.length;
  if (w.tmin.length !== n || w.precip.length !== n) throw new Error("Weather series lengths differ");
  for (let i = 0; i < n; i++) {
    const hi = w.tmax[i];
    const lo = w.tmin[i];
    const p = w.precip[i];
    if (hi != null && (hi < -90 || hi > 65)) throw new RangeError(`Tmax out of range on day ${i}`);
    if (lo != null && (lo < -95 || lo > 60)) throw new RangeError(`Tmin out of range on day ${i}`);
    if (hi != null && lo != null && hi < lo) throw new RangeError(`Tmax below Tmin on day ${i}`);
    if (p != null && (p < 0 || p > 2000)) throw new RangeError(`Precipitation out of range on day ${i}`);
  }
  if (w.pm) {
    if (w.pm.tdew.length !== n || w.pm.wind.length !== n || w.pm.rs.length !== n) throw new Error("Penman-Monteith series lengths differ");
    if (!Number.isFinite(w.pm.elevationM) || w.pm.elevationM < -500 || w.pm.elevationM > 9000) throw new RangeError("Site elevation out of range");
    for (let i = 0; i < n; i++) {
      const u = w.pm.wind[i], r = w.pm.rs[i], td = w.pm.tdew[i];
      if (u != null && (u < 0 || u > 75)) throw new RangeError(`Wind out of range on day ${i}`);
      if (r != null && (r < 0 || r > 50)) throw new RangeError(`Radiation out of range on day ${i}`);
      if (td != null && (td < -95 || td > 40)) throw new RangeError(`Dew point out of range on day ${i}`);
    }
  }
}

export function weatherFromSeries(startIso: string, tmax: (number | null)[], tmin: (number | null)[], precip: (number | null)[]): DailyWeather {
  const w: DailyWeather = { startDay: dayIndex(startIso), tmax, tmin, precip, applied: [] };
  validateWeather(w);
  return w;
}

/** Applies one transformation to a copy. Applying the same kind twice is refused. */
export function applyTransformation(w: DailyWeather, t: Transformation): DailyWeather {
  if (w.applied.some((a) => a.kind === t.kind)) throw new Error(`Transformation ${t.kind} already applied`);
  if (t.kind === "precipitation_scale") {
    const [lo, hi] = TRANSFORM_LIMITS.precipitationPercent;
    if (!(t.percent >= lo && t.percent <= hi)) throw new RangeError(`Precipitation change must be between ${lo}% and ${hi}%`);
    const f = 1 + t.percent / 100;
    return { ...w, precip: w.precip.map((p) => (p == null ? null : Math.max(0, p * f))), applied: [...w.applied, t] };
  }
  const [lo, hi] = TRANSFORM_LIMITS.temperatureCelsius;
  if (!(t.celsius >= lo && t.celsius <= hi)) throw new RangeError(`Temperature change must be between ${lo} and ${hi} °C`);
  const add = (v: number | null) => (v == null ? null : v + t.celsius);
  // The dew point moves with the temperature, so the dew-point depression (and roughly the relative humidity) is kept.
  return { ...w, tmax: w.tmax.map(add), tmin: w.tmin.map(add), ...(w.pm ? { pm: { ...w.pm, tdew: w.pm.tdew.map(add) } } : {}), applied: [...w.applied, t] };
}

export function applyTransformations(w: DailyWeather, ts: Transformation[]): DailyWeather {
  let out = w;
  for (const t of ts) out = applyTransformation(out, t);
  validateWeather(out);
  return out;
}

/**
 * Daily ET0 aligned with the weather series. Penman-Monteith when the weather carries its inputs
 * (null on a day where any of them is missing, or the dew point exceeds Tmax); Hargreaves
 * otherwise (null where temperature is missing). One method per series, never mixed.
 */
export function et0Series(w: DailyWeather, latitudeDeg: number): (number | null)[] {
  const pm = w.pm;
  return w.tmax.map((hi, i) => {
    const lo = w.tmin[i];
    if (hi == null || lo == null) return null;
    const doy = dayOfYear(w.startDay + i);
    if (!pm) return hargreavesEt0(hi, lo, latitudeDeg, doy);
    const tdew = pm.tdew[i], u2 = pm.wind[i], rs = pm.rs[i];
    if (tdew == null || u2 == null || rs == null || tdew > hi) return null;
    return penmanMonteithEt0({ tmax: hi, tmin: lo, tdew, u2, rs }, latitudeDeg, doy, pm.elevationM);
  });
}

/**
 * FAO-56 Eq. 62 (Kc mid) and Eq. 65 (Kc end) climate adjustment (engine 1.3.0):
 * Kc = Kc(Tab) + [0.04 (u2 − 2) − 0.004 (RHmin − 45)] (h/3)^0.3, with u2 and RHmin the stage means,
 * kept inside FAO-56's stated limits (1 ≤ u2 ≤ 6 m/s, 20 ≤ RHmin ≤ 80 %, 0.1 ≤ h ≤ 10 m).
 */
export function kcClimateAdjust(kcTab: number, u2: number, rhMin: number, h: number): number {
  const u = Math.min(6, Math.max(1, u2));
  const rh = Math.min(80, Math.max(20, rhMin));
  const hh = Math.min(10, Math.max(0.1, h));
  return kcTab + (0.04 * (u - 2) - 0.004 * (rh - 45)) * (hh / 3) ** 0.3;
}

/** Stage means of u2 and RHmin (RHmin = 100 e°(Tdew)/e°(Tmax), FAO-56 Eq. 64 with ea from dew point); null if any day is missing. */
export function stageClimate(w: DailyWeather, from: number, to: number): { u2: number; rhMin: number } | null {
  if (!w.pm || to <= from) return null;
  let su = 0, sr = 0;
  for (let i = from; i < to; i++) {
    const u = w.pm.wind[i], td = w.pm.tdew[i], tx = w.tmax[i];
    if (u == null || td == null || tx == null) return null;
    su += u;
    sr += Math.min(100, (100 * satVp(td)) / satVp(tx));
  }
  return { u2: su / (to - from), rhMin: sr / (to - from) };
}
