import { describe, expect, it } from "vitest";

import { suggestRegions } from "./calendar-suggest";

const us = ["Arkansas", "Kansas", "Virginia", "West Virginia", "North Dakota", "South Dakota", "Iowa"].map((r) => ({ value: r, label: r }));
const pk = ["Central Punjab", "Northern Punjab", "Southern Punjab", "Sindh", "Upper Sindh"].map((z) => ({ value: `FAO · Pakistan · ${z}`, label: z }));
const bd = ["25. Level Barind Tract", "26. High Barind Tract", "21. Sylhet Basin"].map((z) => ({ value: `FAO · Bangladesh · ${z}`, label: z }));

describe("planting-calendar area suggestions", () => {
  it("chooses a US state from the place name, without mixing up similar names", () => {
    expect(suggestRegions(us, ["Kansas"], []).auto?.value).toBe("Kansas");
    expect(suggestRegions(us, ["North Dakota"], []).auto?.value).toBe("North Dakota");
    expect(suggestRegions(us, ["West Virginia"], []).auto?.value).toBe("West Virginia");
    // "Virginia" also appears inside "West Virginia": the exact name wins, both are suggested.
    const va = suggestRegions(us, ["Virginia"], []);
    expect(va.auto?.value).toBe("Virginia");
    expect(va.suggestions.map((s) => s.value)).toEqual(["Virginia", "West Virginia"]);
  });

  it("puts several matching zones first but chooses none of them", () => {
    const r = suggestRegions(pk, ["Punjab"], []);
    expect(r.auto).toBeNull();
    expect(r.suggestions.map((s) => s.value)).toEqual(["FAO · Pakistan · Central Punjab", "FAO · Pakistan · Northern Punjab", "FAO · Pakistan · Southern Punjab"]);
  });

  it("drops words like Division and matches a zone named after the place", () => {
    const r = suggestRegions(bd, ["Sylhet Division", "Sylhet District"], []);
    expect(r.auto).toEqual({ value: "FAO · Bangladesh · 21. Sylhet Basin", reason: "place", place: "Sylhet Division" });
  });

  it("never guesses a zone when no name matches", () => {
    const r = suggestRegions(bd, ["Rajshahi Division", "Rajshahi District"], []);
    expect(r).toEqual({ suggestions: [], auto: null });
  });

  it("uses the farmer's earlier choice on this field first, then this farm", () => {
    const high = "FAO · Bangladesh · 26. High Barind Tract";
    const level = "FAO · Bangladesh · 25. Level Barind Tract";
    expect(suggestRegions(bd, ["Rajshahi Division"], [{ region: high, scope: "this_field" }]).auto).toEqual({ value: high, reason: "this_field" });
    expect(suggestRegions(bd, [], [{ region: level, scope: "this_farm" }]).auto).toEqual({ value: level, reason: "this_farm" });
    // Two different areas on the same farm: both suggested, neither chosen.
    const two = suggestRegions(bd, [], [{ region: level, scope: "this_farm" }, { region: high, scope: "this_farm" }]);
    expect(two.auto).toBeNull();
    expect(two.suggestions).toHaveLength(2);
  });

  it("lists areas used elsewhere without choosing them, and ignores areas not offered", () => {
    const r = suggestRegions(bd, [], [{ region: "FAO · Bangladesh · 21. Sylhet Basin", scope: "other" }, { region: "Iowa", scope: "this_field" }]);
    expect(r.auto).toBeNull();
    expect(r.suggestions).toEqual([{ value: "FAO · Bangladesh · 21. Sylhet Basin", reason: "before" }]);
  });
});
