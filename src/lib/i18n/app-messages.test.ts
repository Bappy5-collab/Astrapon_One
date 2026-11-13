import { describe, expect, it } from "vitest";

import { appBn, appEn, type AppKey } from "./app-messages";
import { MESSAGES } from "./messages";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const keys = Object.keys(appEn) as AppKey[];

describe("app messages (farmer journey, English + Bangla)", () => {
  it("has a non-empty Bangla entry for every English key", () => {
    for (const k of keys) expect(appBn[k]?.trim(), k).toBeTruthy();
    expect(Object.keys(appBn).sort()).toEqual([...keys].sort());
  });

  it("uses the same {placeholders} in both languages", () => {
    for (const k of keys) expect(placeholders(appBn[k]), k).toEqual(placeholders(appEn[k]));
  });

  it("is merged into both message tables", () => {
    for (const k of keys) {
      expect(MESSAGES.en[k]).toBe(appEn[k]);
      expect(MESSAGES.bn[k]).toBe(appBn[k]);
    }
  });

  it("writes Bangla in Bangla script", () => {
    // Entries that are only product names or units may stay identical; everything else needs Bangla letters.
    const bangla = /[ঀ-৿]/;
    const missing = keys.filter((k) => !bangla.test(appBn[k]) && appBn[k] !== appEn[k]);
    expect(missing).toEqual([]);
    const untranslated = keys.filter((k) => appBn[k] === appEn[k]);
    expect(untranslated.length).toBeLessThan(5);
  });
});
