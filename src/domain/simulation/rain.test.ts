import { describe, expect, it } from "vitest";

import { chooseRain } from "./rain";

/** TEST DATA (synthetic): POWER from 2000-01-01 for 6 years, rain 1 mm every day. */
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
const power = { retrievalId: "power-1", start: "2000-01-01", precip: Array.from({ length: days("2000-01-01", "2005-12-31") }, () => 1) };
const series = (start: string, end: string, v: number) => ({ start, values: Array.from({ length: days(start, end) }, () => v) });

describe("rain source for a run (engine 1.4.0)", () => {
  it("uses POWER when no IMERG is pinned", () => {
    const c = chooseRain(power, null, { fromYear: 2001, toYear: 2004 });
    expect(c).toMatchObject({ source: "nasa-power-daily", retrievalId: "power-1", fallback: null, note: null });
    expect(c.precip).toBe(power.precip);
  });

  it("prefers the gauge-calibrated Final Run when it covers every replay day, aligned to the POWER days", () => {
    const c = chooseRain(power, { retrievalId: "imerg-1", productVersion: "07", final: series("2001-01-01", "2005-06-30", 3), late: series("1998-01-01", "2005-12-31", 2) }, { fromYear: 2001, toYear: 2004 });
    expect(c.source).toBe("gpm-imerg-final");
    expect(c.retrievalId).toBe("imerg-1");
    expect(c.precip).toHaveLength(power.precip.length);
    // 2000 is before the Final record: missing, never filled from POWER or the Late Run.
    expect(c.precip[0]).toBeNull();
    expect(c.precip[days("2000-01-01", "2001-01-01") - 1]).toBe(3);
    expect(c.precip.at(-1)).toBeNull();
    expect(c.precip.every((v) => v === null || v === 3)).toBe(true);
  });

  it("falls to the Late Run, for the whole run, when the Final Run stops inside the window, and says why", () => {
    const c = chooseRain(power, { retrievalId: "imerg-1", productVersion: "07", final: series("1998-01-01", "2005-09-30", 3), late: series("1998-01-01", "2005-12-31", 2) }, { fromYear: 2001, toYear: 2005 });
    expect(c.source).toBe("gpm-imerg-late");
    expect(c.precip.every((v) => v === 2)).toBe(true);
    expect(c.note).toContain("IMERG Final Run covers 1998-01-01 to 2005-09-30");
  });

  it("uses POWER for the whole run when a single replay day is missing in both IMERG runs", () => {
    const late = series("1998-01-01", "2005-12-31", 2);
    late.values[days("1998-01-01", "2003-05-05") - 1] = null as unknown as number;
    const c = chooseRain(power, { retrievalId: "imerg-1", productVersion: "07", final: null, late }, { fromYear: 2001, toYear: 2005 });
    expect(c.source).toBe("nasa-power-daily");
    expect(c.precip).toBe(power.precip);
    expect(c.fallback).toMatch(/IMERG Final Run is not stored; the IMERG Late Run has 1 missing day/);
    expect(c.fallback).toMatch(/never mixed/);
  });
});
