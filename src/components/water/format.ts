import type { Scenario } from "@/domain/water/plan";
import { formatterFor, localDigits } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/messages";

/** Written-out number formatting (no Intl: identical on server and browser). */
export function num(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const fixed = Math.abs(v) >= 1000 ? Math.round(v).toString() : v.toFixed(digits);
  const [i, d] = fixed.split(".");
  return `${i!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${d ? `.${d}` : ""}`;
}
export const rangeText = (r: Record<Scenario, number> | null | undefined, digits = 1, unit = "") =>
  !r ? "—" : Math.abs(r.low - r.high) < 10 ** -digits ? `${num(r.low, digits)}${unit}` : `${num(r.low, digits)}–${num(r.high, digits)}${unit}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (key: string | null) => (key ? `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}` : "—");

/**
 * The water module's number and month formatting in the reader's language (Bangla digits and
 * month names in Bangla). Same rounding as `num`/`rangeText`, so English output is unchanged.
 */
export function waterFormatter(locale: Locale) {
  const f = formatterFor(locale);
  const d = (s: string) => localDigits(locale, s);
  const n = (v: number | null | undefined, digits = 1) => d(num(v, digits));
  return {
    num: n,
    range: (r: Record<Scenario, number> | null | undefined, digits = 1, unit = "") => d(rangeText(r, digits, unit)),
    /** "May 2018" from "2018-05". */
    month: (key: string | null) => (key ? `${f.monthName(Number(key.slice(5, 7)), true)} ${d(key.slice(0, 4))}` : "—"),
    /** Short month name from 1–12. */
    monthShort: (m: number) => f.monthName(m, true),
    /** Month names joined, in calendar order. */
    monthList: (months: number[]) => [...months].sort((a, b) => a - b).map((m) => f.monthName(m)).join(", "),
    digits: d,
    int: f.int,
    /** Metres below 1 km, otherwise kilometres. */
    km: (m: number) => (m < 1000 ? `${d(String(Math.round(m)))} m` : `${n(m / 1000, 1)} km`),
    date: f.date,
  };
}
export type WaterFormatter = ReturnType<typeof waterFormatter>;
