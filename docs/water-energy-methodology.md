# Water & Energy planner: methodology

Model version **water-energy 1.2.0** (`WATER_MODEL_VERSION`, `src/domain/water/plan.ts`). Phase 10 (2026-11-05); 1.1.0 (2026-11-06) adds the dry-season groundwater backup (§6a); 1.2.0 (2026-11-06) adds the weather-based dry-season outlook (§6b) and labels backup months taken from it. Results saved under 1.0.0 stay as stored. This module is an **Astrapon product extension** to the rotation comparison. It is not a NASA challenge requirement and not endorsed by NASA.

It answers, for the existing rotation and each feasible alternative of a stored comparison:

> Where could the irrigation water come from, how much must be pumped, how much power and energy does that take, and how large a solar array would supply that energy?

It does **not** select a pump model, design a pipe network, establish water rights, volumes or dry-season availability, or verify that a pump can run at every moment.

## 1. Code layout and boundaries

| Part | Where | Notes |
|---|---|---|
| Pure calculations | `src/domain/water/` (`units`, `distance`, `pump`, `solar`, `demand`, `groundwater`, `coverage`, `surface`, `plan`) | No clock, I/O or randomness; tested in `water.test.ts` (35 tests). |
| Provider clients | `src/server/providers/overpass.ts`, `power-solar.ts`, `groundwater-adapters.ts` | All requests through `fetchText` (allowlist, per-host concurrency, timeouts, bounded retries). |
| Lookups | `src/server/water/lookup.ts` | Bounded, user-triggered; in-memory cache (24 h) keyed by a box rounded to ≈ 100 m. |
| Actions and queries | `src/server/water/actions.ts`, `queries.ts` | Auth + ownership via `field_geometry` (RLS). |
| UI | `src/components/water/`, `/fields/[id]/water`, `/fields/[id]/water/plans/[planId]` (+ `/export`), card on `/runs/[id]` | |
| Storage | `water_energy_plans` (migration `20261105100000`) | Immutable versions; only `name` can change. |

The lookups are an explicit, documented exception to "downloads only in the worker": like place search they are small and interactive (one Overpass query, ≤ 3 station queries, observation requests for the nearest 6 wells per provider, one POWER point request), each with a timeout. Nothing heavy (rasters, bulk files) is fetched.

## 2. Distance to water

- Field outline and source geometry are projected into the field's local East-North-Up tangent plane on the WGS84 ellipsoid (`src/domain/geo/local-frame.ts`); the shortest distance between the outline and the geometry is measured there. At ≤ 25 km the difference from the ellipsoidal geodesic is ≈ d³/2R² (0.2 m at 25 km).
- Point, line (river/canal centreline), multi-line (multipolygon outline) and polygon sources are supported. A source touching, crossing or containing the field is **0 m**.
- A waterway line is a **centreline**; the UI says the bank is closer by about half the channel width. Polygon outlines are mapped banks/shorelines.
- Field-centre distance is never used (a helper exists and must be labelled if ever shown).
- Search boxes that would cross the 180° meridian are refused with a clear message.
- **Straight-line distance is not a pipe route.** Selecting a mapped source pre-fills the route length with the straight-line distance labelled "straight-line minimum"; typing a route changes the basis to the farmer's route. Elevation difference, delivery pressure and route length are separate inputs.
- "No mapped water" is reported with the searched radius and the note that OpenStreetMap may not include it; the farmer can widen the radius or enter a farmer-reported source.

## 3. Water demand

Source: the stored engine result (`docs/scientific-methodology.md` §6). The engine's daily FAO-56 root-zone balance already includes rainfall and stored soil water; under "full irrigation" it applies net irrigation that refills depletion to field capacity whenever it passes RAW. The planner:

1. sums that daily net irrigation by calendar month over the stored replay window (the most recent complete rotation-length years) — this is one historical window, not a forecast or an observed schedule;
2. shows the annual **median and 80th-percentile** net need from the engine's indicators;
3. converts net to gross once: `gross_mm = net_mm ÷ (E_application × E_conveyance)`, and `m³ = mm × ha × 10`.

No effective-rainfall or soil-storage adjustment is applied again. If the comparison was rainfed or soil capacity is unknown, demand is "unavailable" with the reason; the farmer may enter their own daily volume and months, labelled farmer report or hypothetical.

Application efficiency when the farmer does not know it: the **lower end** of the "attainable with good design and management" range for the chosen method, FAO W4367E (Augier, Baudequin & Isbérie, citing Keller 1992), Tables 1/3/5 — e.g. furrow 65–85 %, basin 70–90 %, centre pivot 75–80 %, drip row crops 65–90 %. Real systems can be lower.

Peak period = the month with the highest average daily gross volume. Energy is calculated **per month and summed**, never from one annual average.

## 4. Pump head, power and energy

Total dynamic head per month (VT Extension BSE-346NP, Ignosh, Booher & Iqbal 2024: vertical lift + friction + pressure head; Astrapon adds outlet velocity head explicitly):

```
H = static lift + p/(ρg) + f (L/D) v²/2g + ΣK v²/2g + v²/2g
static lift (well)    = pumping water level depth (or static depth + drawdown, once) + delivery height above the well head
static lift (surface) = delivery height above the water surface (negative = gravity-assisted)
f: Swamee–Jain for Re ≥ 2000 (transitional flagged), 64/Re laminar; ν = 1.004e-6 m²/s (20 °C)
Q = V_day / (runtime_h × 3600)
P_hydraulic = ρ g Q H;   P_electrical = P_hydraulic / η_pump+motor   (motor terminals)
E_kWh = ρ g V H / (3.6e6 η)   per month, summed; 0 when V = 0 or H ≤ 0 (never negative)
```

ρ = 1000 kg/m³ and g = 9.81 m/s² are stated in every result. Pipe roughness presets follow Moody (1944): plastic 0.0015 mm, commercial steel 0.045 mm, galvanised iron 0.15 mm, cast iron 0.26 mm.

Uncertain inputs (depth, drawdown, route length, Σ K, delivery height) are **ranges**; results show a low and a high scenario. When more than half of the head at peak is friction, the result says so and names the velocity (no unsourced velocity threshold is applied).

Groundwater depth handling: a measured pumping level already includes drawdown; a static level needs an explicit drawdown range; negative (artesian) depths stay negative; borehole/construction depth is metadata, never a lift. A nearby monitoring well can be used only as a **proxy scenario** (min–max of its 20 most recent returned depths below ground, with distance, dates and aquifer shown); it is never labelled a field measurement. With "I don't know", the pump calculation stops with "Groundwater depth unavailable for this location" while demand and the rotation comparison continue. GRACE/GRACE-FO, soil moisture or imagery are never used to derive a depth.

Scope limits: no pump curve or operating point, no suction-lift/NPSH check, steady flow within a month.

### Unit-test reference (synthetic, never farm data)

ρ = 1000, g = 9.81, V = 50 m³/day, H = 30 m, η = 0.50, 5 h/day → Q = 10 m³/h, P = 1.635 kW, E = 8.175 kWh/day; with 4.5 peak sun hours and PR 0.75 → 2.422 kWp (`water.test.ts`).

## 5. Solar

- NASA POWER daily `ALLSKY_SFC_SW_DWN`, community **RE** (kWh/m²/day per the response metadata; MJ would be divided by 3.6 only if the response said MJ), the 10 most recent complete calendar years. `-999` is missing, never zero; a month needs ≥ 80 % valid days.
- Peak sun hours = daily irradiation ÷ 1 kW/m² (never daylight length). **Horizontal** irradiation of a ≈ 1° grid cell: no tilt or orientation control is offered because no transposition model is implemented; local shading is unknown.
- Energy boundary: motor-terminal energy ÷ controller/inverter efficiency (once) = array DC output energy. `PV_kWp = E_array (kWh/day) ÷ (PSH × PR)`, with PR the array performance ratio **excluding** the controller.
- Sizing mode: kWp needed in each irrigated month; the critical month is the largest; a "low-sun day" figure uses the month's 10th-percentile day. Evaluate mode: monthly coverage (0–100 %), yearly shortfall, and whether the array at 1 kW/m² can supply the peak electrical power.
- **Operational feasibility is reported as unverified** (daily energy balance only). No hourly series is created from daily data. Batteries are not assumed; a tank is modelled only as "days of peak demand it holds".

## 6. Water supply limits

Source capacity (m³/day) and seasonal allowance (m³/year) are farmer inputs. Without them supply feasibility is **unknown**. With them, monthly and yearly deficits are shown per option. Solar energy never justifies unlimited extraction.

## 6a. Dry-season groundwater backup (1.1.0)

Ponds and rivers can run dry or too low. When the main source is surface water, the farmer may add a backup well (`backup` in the input):

- **Months** (1–12) when the surface source cannot be used: the farmer's statement (`monthsBasis`), never inferred. Astrapon does not observe when a water body dries; this is listed as a gap.
- In those months **all** of that month's gross water is pumped from the well; in the other months from the main source. There is no partial split.
- The well's lift is the same well model as §4 (pumping level, or static level + drawdown counted once, + delivery height above the well head; low/high ranges). The pipe **length** from the well is its own range; diameter, material, fittings, delivery pressure, pump-and-motor efficiency and pumping hours are shared with the main source.
- Each month's head, power and energy use the head of the source that supplies it. Per option the result adds `totals.sources = { main, backup }` with water per year and share, energy, peak flow/head/power and the PV needed in that source's critical month. A well usually needs its own (often submersible) pump, so the two pump points are reported separately; one PV array runs whichever pump is working, and the UI suggests sizing it for the larger of the two.
- Supply: each month is checked against the capacity of the source supplying it (surface capacity or well yield). The seasonal allowance, if given, is compared with the total from both sources. Unknown well yield is a gap ("a pumping test shows the yield").
- A missing backup depth (or a static level without drawdown) stops the pump calculation with a reason, exactly as for a main well; demand is still shown.
- A backup on a main well, or a month listed twice, is rejected.

The "What you would need" list in the UI only restates computed values and inputs (intake below the deepest pumping level in the inputs, pump flow/head/power, PV kWp, pipe length and diameter, a yield test, local permission); it names no product and no price.

## 6b. Weather-based dry-season outlook (1.2.0; `src/domain/water/dryseason.ts`, method 1.0.0)

Shown above the backup switch when the main source is surface water. Input: the field's newest stored NASA POWER daily series (T2M_MAX, T2M_MIN, PRECTOTCORR — the rows the engine pins); the page only reads them, never downloads.

- Per calendar month: rainfall P and FAO-56 Hargreaves ET0 (Eq. 52, the engine's ET0) summed for every **complete** month (all days present); the medians over the years are shown with the year count. A month with fewer than 5 complete years makes the outlook "insufficient" with the reason.
- **Dry month:** median P < 0.5 × median ET0, the threshold FAO uses to bound the growing period in its Agro-ecological Zones method (FAO 1978, World Soil Resources Report 48/1; Higgins & Kassam 1981). "Dry in N of M years" applies the same test to each year.
- **Dry season:** the dry months in order after the last wet month (wrapping New Year). For each dry month the deficit Σ(ET0 − P) since the rains is reported; the month where it peaks is named as the month surface water is most likely lowest.
- **Hardest dry season:** the season (a Nov → Apr season spans two years) with the largest Σ(ET0 − P) over the dry months, among seasons with every dry month complete.
- **What you can do** only restates computed facts: use the dry months for the backup (one click; the plan then records `monthsBasis: simulation_output` and a gap saying it is an indicator), untick early months if the pond lasts, each compared rotation's water need in those months (gross from the planner result when computed, otherwise net from the stored comparison, labelled) and that storing that amount before the season would cover it, and testing the well yield before the season.

Limits (shown on the page): a climate indicator, not an observation of any pond or river; upstream inflow, groundwater exchange, canal releases, pond size and depth and other users are ignored; large rivers fed from far upstream can behave differently; not a forecast. The outlook is shown, not saved, and does not change the pump or solar calculation unless the farmer applies the months.

## 6c. Regional water storage from NASA GRACE / GRACE-FO (context only)

Shown at the top of step 1. `pnpm grace:fetch` (monthly) asks CMR for the newest JPL mascon granule (collection C3195527175-POCLOUD, RL06.3Mv04 CRI, doi:10.5067/TEMSC-3JC634), downloads the ~46 MB netCDF once with the Earthdata token, and keeps the land mascons in `data/reference/grace-mascon.json` (series once per 3° mascon in mm; per 0.5° land cell the mascon id and CRI land scale factor). The page reads that file on the server (`src/server/water/grace.ts`) and `src/domain/water/grace.ts` computes, for the cell containing the field:

- the series × the cell's land scale factor (JPL's recommendation for land hydrology), anomaly from the 2004.000–2009.999 mean;
- the least-squares trend of the deseasonalised series (each month minus its calendar-month mean; needs every calendar month and ≥ 8 years);
- the change between the means of the last three and the first three complete years (≥ 11 months each);
- the calendar months of the lowest and highest mean storage and the average swing;
- yearly means (≥ 9 months) for a small line, and the latest month with its uncertainty.

Missing months (including the 2017–2018 gap between the missions) are left out, never filled. It is total water (soil, groundwater, surface water, snow) over about 300 km; it never enters a field calculation, cannot describe a well, and cannot separate pumping from drought. Rajshahi test square: −7.2 mm/yr, −20 cm (2023–25 vs 2003–05), lowest in April (`data/verification/grace-mascon.json`).

## 7. Comparison

All options use the same weather window, efficiencies and pump/solar assumptions. Options are ordered by yearly pumping energy (high scenario) only when every option has energy; otherwise the reason is shown. This ordering is one trade-off; it never changes the engine's ranking, hard constraints or the farmer's priorities.

## 8. Persistence and reproducibility

Saving recomputes the result on the server from the submitted inputs with the same pure function; demand from a comparison is re-derived from the stored run result and must match exactly, and the run's result hash must still equal the stored one. A version stores: inputs (canonical JSON), evidence (selected mapped feature with OSM date and retrieval time; groundwater providers consulted, outcomes and the selected station with up to 20 original observations; NASA POWER provenance), model version, result, and SHA-256 hashes. The guard trigger blocks any change except `name`. Reopening and exporting read the stored row only.

## 9. Evidence classes in UI and exports

Observed record (station observations), Mapped feature (OSM), Modelled estimate (engine demand, NASA POWER, pump/solar model), Your input (farmer report), Hypothetical, Stated assumption (labelled starting values), Unavailable. Inputs carry a `basis` field in exports.

## 10. Known limits

- Overpass public instances can be at capacity (observed 502/timeouts on 2026-11-05); the app tries two listed instances and reports the outage as a service problem.
- USGS `latest-field-measurements` can take 15–25 s.
- Groundwater coverage is uneven: e.g. no wells near Mymensingh or Nairobi in GGMN in the 2026-11-05 tests.
- The dry-season backup months are the farmer's statement; no observed surface-water availability is used. Switching sources within a month is not modelled.
- The Water & Energy page is English only (owner decision of 2026-11-05: no Bangla extension).
