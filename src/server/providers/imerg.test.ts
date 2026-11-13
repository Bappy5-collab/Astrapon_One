import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { imergCell, imergSubmitUrl, parseImergCsv } from "./imerg";

const fx = JSON.parse(readFileSync(path.join(import.meta.dirname, "__fixtures__", "gpm-imerg-late-csv.fixture.json"), "utf8")) as { response: { start: string; end: string; csv: string } };

describe("NASA GPM IMERG provider", () => {
  it("finds the 0.1° cell and asks for a box inside it only", () => {
    const c = imergCell(24.62, 88.56); // Rajshahi test square
    expect(c).toMatchObject({ key: "imerg0.1:r1146c2685", row: 1146, col: 2685, centre: { lat: 24.65, lon: 88.55 }, box: { south: 24.625, north: 24.675, west: 88.525, east: 88.575 } });
    expect(imergCell(-33.95, 151.2).key).toBe("imerg0.1:r560c3312");
    expect(imergCell(90, 180)).toMatchObject({ row: 1799, col: 3599 });
    expect(() => imergCell(91, 0)).toThrow(RangeError);
    const u = new URL(imergSubmitUrl("final", c, "1998-01-01", "2025-09-30"));
    expect(u.hostname).toBe("harmony.earthdata.nasa.gov");
    expect(u.pathname).toBe("/C2723754864-GES_DISC/ogc-api-coverages/1.0.0/collections/GPM_3IMERGDF_07_precipitation/coverage/rangeset");
    expect(u.searchParams.getAll("subset")).toEqual(["lat(24.625:24.675)", "lon(88.525:88.575)", 'time("1998-01-01T00:00:00Z":"2025-09-30T00:00:00Z")']);
    expect(u.searchParams.get("average")).toBe("area");
  });

  it("reads a live Harmony answer (trimmed fixture): 40 consecutive days, in mm/day, for the right cell", () => {
    const s = parseImergCsv(fx.response.csv, "late", fx.response.start, fx.response.end, imergCell(24.62, 88.56));
    const by = Object.fromEntries(s.checks.map((c) => [c.id, c.passed]));
    expect(by).toMatchObject({ "late:variable": true, "late:location": true, "late:days": true, "late:fill": true, "late:values": true });
    // The fixture keeps the header of the whole-record request, so its end date differs from the trimmed rows.
    expect(by["late:period"]).toBe(false);
    expect(s.dates[0]).toBe("1998-01-01");
    expect(s.values).toHaveLength(40);
    expect(s.values.every((v) => v != null && v >= 0)).toBe(true);
  });

  it("keeps fill, empty, negative and implausible values missing (never 0) and catches a gap", () => {
    const cell = imergCell(24.62, 88.56);
    const head = 'User Start Date:,2020-06-01T00:00:00.000Z\nUser End Date:,2020-06-05T00:00:00.000Z\nUser Bounding Box:,"88.525, 24.625, 88.575, 24.675"\nFill Value:,-9999.900390625\n,\ntime,mean_GPM_3IMERGDL_07_precipitation\n';
    const s = parseImergCsv(`${head}2020-06-01T00:00:00,-9999.900390625\n2020-06-02T00:00:00,\n2020-06-03T00:00:00,-1\n2020-06-04T00:00:00,2500\n2020-06-05T00:00:00,30.25\n`, "late", "2020-06-01", "2020-06-05", cell);
    expect(s.values).toEqual([null, null, null, null, 30.25]);
    expect(s.checks.find((c) => c.id === "late:values")).toMatchObject({ passed: false, detail: "2 missing, 1 negative, 1 above 2000 mm" });
    const gap = parseImergCsv(`${head}2020-06-01T00:00:00,1\n2020-06-03T00:00:00,1\n`, "late", "2020-06-01", "2020-06-05", cell);
    expect(gap.checks.find((c) => c.id === "late:days")!.passed).toBe(false);
    const wrong = parseImergCsv(head.replace("GPM_3IMERGDL", "GPM_3IMERGDF"), "late", "2020-06-01", "2020-06-05", cell);
    expect(wrong.checks.find((c) => c.id === "late:variable")!.passed).toBe(false);
    const far = parseImergCsv(head.replace("88.525, 24.625, 88.575, 24.675", "88.5, 24.6, 88.7, 24.7"), "late", "2020-06-01", "2020-06-05", cell);
    expect(far.checks.find((c) => c.id === "late:location")!.passed).toBe(false);
  });
});
