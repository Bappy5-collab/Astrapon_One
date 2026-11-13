/**
 * Locale-aware, unambiguous formatting: dates with the month name ("12 May 2018" / "১২ মে ২০১৮"),
 * numbers with the locale's digits. Written out by hand rather than with Intl so the server and
 * every browser produce identical text (ICU data differs, which broke hydration in Bangla).
 * Missing values render as "—" and are announced by the tables. Plain module: usable from server
 * components (`formatterFor(await getLocale())`) and, through useFmt(), from client components.
 */

const MONTHS = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  bn: ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"],
} as const;
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Western digits → Bangla digits when the locale is Bangla. */
export const localDigits = (locale: "en" | "bn", s: string) => (locale === "bn" ? s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]!) : s);

export function formatterFor(locale: "en" | "bn") {
  const digits = (s: string) => localDigits(locale, s);
  const group = (int: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const num = (v: number, d: number) => {
    // Up to d decimals, trailing fractional zeros dropped ("5.00" → "5", "0.890" → "0.89").
    const fixed = d > 0 ? Math.abs(v).toFixed(d).replace(/\.?0+$/, "") : Math.abs(v).toFixed(0);
    const [i, frac] = fixed.split(".");
    const out = `${v < 0 && Number(fixed) !== 0 ? "−" : ""}${group(i!)}${frac ? `.${frac}` : ""}`;
    return digits(out);
  };
  const parts = (iso: string) => ({ y: iso.slice(0, 4), m: Number(iso.slice(5, 7)) - 1, d: Number(iso.slice(8, 10)) });
  const month = (m: number, short: boolean) => (short && locale === "en" ? MONTHS.en[m]!.slice(0, 3) : MONTHS[locale][m]!);
  return {
    locale,
    digits,
    date: (iso: string) => { const p = parts(iso); return digits(`${p.d} ${month(p.m, false)} ${p.y}`); },
    shortDate: (iso: string) => { const p = parts(iso); return digits(`${p.d} ${month(p.m, true)} ${p.y}`); },
    month: (ym: string) => digits(`${month(Number(ym.slice(5, 7)) - 1, false)} ${ym.slice(0, 4)}`),
    /** Month name alone from 1–12 (short in English: "Jan"; Bangla names are already short). */
    monthName: (m: number, short = false) => month(m - 1, short),
    /** "MM-DD" without a year (planting windows recur every year). */
    dayMonth: (md: string) => digits(`${Number(md.slice(3, 5))} ${month(Number(md.slice(0, 2)) - 1, false)}`),
    num: (v: number | null | undefined, d = 1) => (v == null ? "—" : num(v, d)),
    int: (v: number) => num(Math.round(v), 0),
    pct: (v: number | null | undefined) => (v == null ? "—" : `${num(Math.round(v * 100), 0)}%`),
  };
}

export type Formatter = ReturnType<typeof formatterFor>;
