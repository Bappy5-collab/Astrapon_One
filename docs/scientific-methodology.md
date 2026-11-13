# Scientific methodology: simulation and rotation engine

Engine version **1.4.0** (`src/domain/simulation/engine-version.ts`). 1.4.0 (2026-11-13): daily rain from NASA GPM IMERG V07 at 0.1° (Final Run, else Late Run) when it covers the whole replay window, else NASA POWER; one rain product per run, never mixed (§6.1a). 1.3.1 (2026-11-06): sourced values for chickpea, rapeseed, mustard and jute (crop-parameters v4, §3.1a); local-climate Kc (jute) skip the Eq. 62/65 adjustment. 1.3.0 (2026-11-06): FAO-56 Penman-Monteith ET0 from NASA POWER humidity, wind and radiation (§6.2). This document is the contract for the engine. Any change to a rule, equation or parameter here requires a new engine version. Saved runs keep the version they were computed with.

## 1. Purpose and scope

The engine answers one question:

> Which rotation sequences are feasible for this field under the farmer's constraints, and how do they compare on transparent indicators over the same historical weather?

It compares the **existing practice** (from the farmer's dated crop history) with up to **three agronomically distinct feasible alternatives**. It reports why other options were rejected and which priorities and constraints shaped the ranking.

**It does not predict** yield, profit, income, prices, soil carbon, nutrient balance, fertiliser savings, infiltration, erosion, pest or disease outcomes. Those quantities are never produced. Ranking scores are **relative scores among the options shown**. They are not probabilities, and they are not predictions of outcomes.

**Spatial unit.** The whole field, and (1.2.0) each planting zone that has records of its own. A zone with its own dated history and/or its own soil-test water capacity is run through the same engine on those records (its own history replaces the whole-field history; its own soil value replaces the field's; weather, candidate crops, settings and priorities are shared). A zone without records of its own shares the whole-field result and is listed as such. At most six zones are compared separately. Zone results keep the comparison and indicators; the day-by-day timeline is drawn for the whole field only.

**Time unit.** Daily steps, using calendar days. Results do not depend on the 3D frame rate: the engine has no rendering dependency.

## 2. Inputs and evidence classes

| Input | Source | Evidence class | If missing |
|---|---|---|---|
| Field geometry, latitude | Farmer-drawn boundary (snapshot) | farmer report | Engine refuses to run (no location). |
| Crop history (crop, year, season, planted/harvested dates) | Farmer records (snapshot) | farmer report | Baseline = unknown; alternatives are still listed, and the result asks for history. |
| Candidate crops, rotation length, replay years, irrigation assumption, planting windows, turnaround days, weather transformations | Scenario settings (snapshot) | hypothetical input | Defaults are listed in §8. |
| Irrigation availability and seasonal allocation | Farmer constraints (snapshot) | farmer report | Treated as unknown. No allocation constraint is applied, and this is listed as a gap. |
| Exclusions and priorities (0–5) | Farmer priorities (snapshot) | farmer report | All priorities are equal (3). This is stated. |
| Market preferences | Farmer records (snapshot) | farmer report | Market fit = unknown for that crop. |
| Daily Tmax, Tmin (and dew point, wind, radiation for ET0) | NASA POWER daily (pinned retrieval, normalised daily series) | model-derived | Water and exposure indicators are reported as *insufficient evidence*. |
| Daily precipitation (1.4.0) | NASA GPM IMERG V07 for the field's 0.1° cell: Final Run (gauge-calibrated) or Late Run, from its own pinned retrieval, when it has a value on every day of the replay window; otherwise NASA POWER precipitation (§6.1a) | satellite observation (IMERG) / model-derived (POWER) | Falls back to POWER for the whole run; the reason is listed as a gap. |
| Plant-available water capacity (AWC) | Farmer lab value (`available_water_capacity`, cm/cm) if present; otherwise USDA SSURGO 0–100 cm (pinned retrieval); otherwise (1.3.0) ISRIC SoilGrids 2.0: Σ (θ at 33 kPa − θ at 1500 kPa) × layer thickness over 0–100 cm, layer means, one 250 m pixel (pinned retrieval; listed as a gap) | ground measurement / survey / model estimate | Water-limited uptake = insufficient evidence; only potential demand is shown. |
| Crop parameters | Reference dataset `crop-parameters` (pinned) | reference | Crop not in catalogue: not offered as an alternative; baseline indicators are partial. |
| Planting calendars | Reference datasets `usda-nass-usual-dates-2010` and (1.2.0) `fao-crop-calendar` (both pinned), farmer windows, farmer history dates | survey / farmer report | Crop cannot be scheduled: rejected with the reason "no local planting window". |
| Hydrologic soil group (A–D) for runoff (1.2.0) | Scenario settings (snapshot) | farmer report | No runoff is modelled; listed as a gap with a review question. |

Unknown values stay unknown. The only estimation methods used are the ones listed in this document, and each is shown in the result as an assumption.

## 3. Parameter sources

All values below were checked against the primary source on 2026-11-01.

### 3.1 FAO Irrigation and Drainage Paper 56 (Allen et al., 1998)

Source: https://www.fao.org/4/x0490e/x0490e00.htm

- **Table 12** gives the crop coefficients Kc ini, Kc mid and Kc end.
  - Where an individual crop row leaves Kc ini blank, the group value is used, as Table 12's note states: "one value for Kc ini is listed and it is considered to be representative of the whole group".
  - Where the table gives a range (for example sorghum 1.00–1.10, cotton 1.15–1.20, rapeseed and sunflower 1.0–1.15), both ends are kept. The low end is used for rainfed crops, following footnote 9 for oil crops; for the other crops the midpoint is the base case. The low and high ends are both run as a sensitivity case.
- **Table 11** gives the lengths of the four crop development stages (initial, development, mid-season, late season).
  - These are **regional examples, not universal values**. Rows without a stated region are not used.
  - The engine uses Table 11 **only for stage proportions**, taken from the example whose total length is closest to the local season length. The season length always comes from local evidence (§4).
- **Table 22** gives the maximum effective rooting depth Zr (range) and the depletion fraction p.
  - Following footnote 1, the **larger Zr is used** because the engine models rainfed water stress.
  - p is adjusted daily with p = p_table + 0.04 (5 − ETc), limited to 0.1 ≤ p ≤ 0.8 (FAO-56, Table 22 footnote).

#### 3.1a Crops FAO-56 leaves incomplete (crop-parameters v4, 2026-11-06)

Four crops common in Bangladesh and South Asia were incomplete in FAO-56. Their missing values now come from published field studies, each read in the original PDF. **No crop borrows another crop's values.** Each stage row carries its citation (`source`), and each crop lists its studies in the dataset's citation keys.

| Crop | FAO-56 has | Added (source) |
|---|---|---|
| Chickpea | Kc (Table 12), Zr and p (Table 22) | Stage lengths 20/35/35/20 d (MPKV Rahuri lysimeter, rabi gram sown 14 Dec 2021, PoCRA Phase VIII report, Table 1.1) and 85/35/40/35 d for long winter seasons (Garofalo et al. 2009, Foggia, Table 1). The row closest to the local season length is used, so a ~110-day South Asian season uses Rahuri. |
| Rapeseed / canola | Kc (Table 12), Zr and p (Table 22) | Stage lengths 13/20/32/28 d (Sarma & Bharadwaj 2020, J. Agrometeorol. 22(2), weighing lysimeters, Jorhat, Assam, cv. TS 38 sown 30 Oct). The paper does not state the species of TS 38. |
| Mustard (*B. juncea*) | nothing | Kc mid 1.15, Kc end 0.40 (Pereira et al. 2021, the FAO56 update for field crops, Table 12, standard climate, so Eq. 62/65 still applies); Kc ini 0.35 (FAO-56 Table 12 oil-crops group value, which Pereira et al. did not update); Zr 0.5–1.1 m, h 1.5–2.0 m, p 0.55 (Pereira et al. 2021 Table 15); stage lengths 30/40/40/20 d (Gupta et al. 2017, Curr. Sci. 113(2), weighing lysimeters, New Delhi). |
| Jute (*C. olitorius*) | nothing | Kc 0.72 / 1.26 / 0.46 and stage lengths 25/31/39/20 d measured in Bangladesh (Milla et al. 2018, The Agriculturists 16(2), BARI Gazipur micro-lysimeter with BJRI, BJRI Tosa-2 sown 18 April). These are local-climate values, so the Eq. 62/65 adjustment is **not** applied (`kcLocal`). Kc end is the paper's late-season mean. |

Limits, stated in the catalogue notes:

- **Jute:** no published rooting depth or depletion fraction was found (not in FAO-56, its 2021 update or the jute study). Jute is therefore `potential_only`: crop water use (ETc) is computed, but no root-zone balance or irrigation need. In Bangladesh jute is mostly rainfed in the monsoon.
- **Jute:** the study's development-stage mean Kc (1.39) is above its mid-season value. The FAO-56 curve interpolates between Kc ini and Kc mid in that stage, so development-stage use may be underestimated. Its Table 4 swaps the ETc and ET0 column labels; the Kc values and the 549 mm seasonal ETc agree with the swapped reading.
- **Studies:** each is a single site, one or two seasons. The lysimeter Kc values of the chickpea and rapeseed studies are not used; FAO-56 Table 12 Kc are kept, and only the stage proportions are taken.

Crops with no FAO-56 row and no suitable study (rye, generic cover crops) are still catalogued with their botanical family only. For them the engine returns *insufficient evidence* for daily water indicators.

### 3.2 USDA PLANTS Database

Source: https://plants.usda.gov, PlantProfile API, accessed 2026-11-01.

Botanical **family** for each catalogued crop is taken from the database's own family record. Jute (*Corchorus olitorius*) is listed as Tiliaceae in PLANTS. That record is kept, and the catalogue notes that APG IV places it in Malvaceae. Legumes are crops whose family is Fabaceae.

### 3.3 USDA NASS usual planting and harvesting dates (2010)

Source: *Usual Planting and Harvesting Dates for U.S. Field Crops*, USDA NASS, October 2010, https://esmis.nal.usda.gov/concern/publications/vm40xr56k. The raw text is committed at `data/reference/usda-nass-usual-dates-2010.txt`.

- Gives state-level begin, most-active and end dates for planting and harvesting.
- Used only when the farmer selects that US state as the calendar region in the scenario.
- The source states that the dates do not account for exceptionally early or late plantings or abnormal seasons.

**No calendar is imposed anywhere else.** Outside the US the farmer's own recorded dates, or windows they enter, are the only calendars. Bangladesh seasons (Aus, Aman, Boro, Rabi) are never applied to other places, and they are not applied in Bangladesh either unless the farmer's records or windows say so.

### 3.3a FAO Crop Calendar (1.2.0)

Source: FAO Crop Calendar, https://cropcalendar.apps.fao.org, public API, retrieved 2026-11-05 by `pnpm reference:fao-calendar` into `data/reference/fao-crop-calendar.json` (57 countries; Lesotho's endpoint returned server errors). Each entry gives, per country and agro-ecological zone (AEZ), early and late sowing and early and late harvest dates per season. Only crops that resolve to the catalogue through the engine's own name resolver are kept (3,680 sowing windows); year-round entries and sessions without all four dates are dropped. They are published as reference dataset `fao-crop-calendar` (kind crop_calendar) with region labels "FAO · <country> · <AEZ>". The farmer chooses the zone (the API publishes no zone boundaries); a window is used exactly like a NASS state window (§4), with sowing early–late as the window and harvest early–late as the active harvest range. Licence: © FAO; FAO's open-data policy (CC BY 4.0 for FAO statistical databases) — service-specific terms not found and recorded as unconfirmed.

### 3.3b USDA NRCS curve numbers (1.2.0)

Source: National Engineering Handbook Part 630, Chapter 9 (2004), Table 9-1 "Runoff curve numbers for agricultural lands" (average runoff condition, Ia = 0.2S), checked against the PDF on 2026-11-05; runoff equation from Chapter 10. Values used (hydrologic soil group A/B/C/D): fallow, bare soil 77/86/91/94; row crops, straight row, good 67/78/85/89; small grain, straight row, good 63/75/83/87; close-seeded or broadcast legumes, straight row, good 58/72/81/85. Astrapon's mapping of catalogue crops to these covers (an assumption, stated in every result): small grain = wheat, barley, oats, rye, millet, flax, rapeseed, mustard; close-seeded legumes = lentil, dry pea, common vetch, red clover; every other crop = row crop.

### 3.3c FAO-56 Chapter 7 and Table 19 (1.2.0)

Bare-soil evaporation uses FAO-56 Eq. 71–74 and 77 with Kcb = 0, few = 1 and Kc,max = 1.20 (Eq. 72 without climate correction), and Table 19 (Ze = 0.10 m) for TEW and REW. Because only the soil's water capacity (AWC) is known, the class is inferred from AWC with Table 19's θFC − θWP ranges (an Astrapon assumption): AWC < 110 mm/m → loamy-sand range (TEW 11.5 mm, REW 6 mm, range midpoints); 110–150 → sandy-loam range (17.5, 8); > 150 → loam range (19, 9).

### 3.4 Rotation rules

- **Canola return interval.** Canola Council of Canada, Canola Watch (2021-01-13): at least one year in three for clubroot management, and one year in four largely removes blackleg yield-loss risk. Implemented as a hard constraint: rapeseed/canola at most once in any three consecutive years of the cycle. It is applied **only** to rapeseed/canola, the crop the source covers, not to other brassicas.
- **No other return-interval rule is imposed.** Crop-family repetition is reported as an indicator, not a rule. A change of family does not guarantee disease control (§6.3).

## 4. Scheduling and calendars

**Planting period.** A planting period is a crop, a planting date and a season length in days. Day arithmetic uses an absolute day index. Seasons that cross the calendar year (for example winter wheat planted in October and harvested in July, or a crop planted in December and harvested in May) are handled on the absolute timeline. A planting belongs to the calendar year in which it is planted.

**Sources for the planting date and season length, in order:**

1. **Farmer windows** in the scenario: plant-from, plant-to and length in days. The preferred date is the window midpoint.
2. **Farmer history** for that crop with both dates recorded. The preferred date is the median planted day-of-year. The length is the median recorded duration. The window spans the earliest to the latest recorded planting.
3. **NASS calendar** for the selected US state. The preferred date is the midpoint of the most-active planting range. The length runs from that date to the midpoint of the most-active harvesting range. The window runs from the planting begin date to the planting end date.

No other source is used. If none applies, the crop is rejected with the reason **"no local planting window"**, and the result asks the farmer for one.

**Hemisphere.** Dates come only from local sources, so no hemisphere assumption is needed for scheduling. Season names in the output are months (for example "Oct–Jul"), never "winter" or "summer".

**Sequencing rule.**

- In each year, plantings are scheduled in order.
- A planting starts at max(preferred date, previous harvest + turnaround). It must not start after its window end.
- The cycle is cyclic: the last harvest of the cycle plus the turnaround must not be later than the first planting of the next repetition.

**Turnaround days.** Entered by the farmer. If none is entered, 0 days is used and stated as an assumption, with the local-review question "How many days do you need between harvest and the next planting?".

## 5. Rotation logic

### 5.1 Hard constraints

Hard constraints are applied before any preference ranking.

| Code | Rule |
|---|---|
| `excluded` | The farmer excluded the crop. |
| `no_market_access` | The farmer recorded "no market access" for the crop. |
| `unknown_crop` | The crop is not in the catalogue. It is allowed only in the baseline. |
| `no_window` | No local planting window or season length (§4). |
| `overlap` | Plantings overlap, including turnaround, inside the cycle or across the cycle boundary. |
| `window_missed` | A planting would have to start after its window end. |
| `return_interval` | Canola return interval (§3.4). |
| `water_allocation` | Irrigation is available with a seasonal allocation, and the median-year net irrigation requirement of a year's plantings exceeds it. Applied only when the requirement can be computed (§6). |
| `fallow_year` | The sequence leaves the field without any crop for a whole year (a bare window of 365 days or more). Allowed only if the farmer lists "fallow" as a candidate or in their history. |

A rejected sequence is never shown as an alternative. The result lists rejection counts by reason and examples of rejected sequences.

### 5.2 Candidate generation

- The crops considered are the scenario's candidate crops plus the crops in the farmer's history, minus crop-level rejections.
- A year holds one to three plantings.
- Sequences have the scenario's rotation length, 1 to 4 years.
- Cyclic duplicates (A→B and B→A) are collapsed.
- Enumeration is exhaustive when the number of combinations is at most 50,000. Above that, a deterministic beam search keeps the 2,000 best partial sequences per year, using a fixed-scale proxy (crop and family diversity, cropped share of the year and plantings per year, weighted by the priorities). Partial sequences that already overlap are dropped. The result then states that the search was bounded.

### 5.3 Baseline (existing practice)

- The baseline is the farmer's last *rotation length* years of whole-field history, each planting scheduled with its recorded dates (or §4 sources if dates are missing).
- Years with no record make the baseline incomplete. The result asks for those years and never fills them in.
- The baseline is evaluated on the same weather and period as the alternatives. It is not rejected, but any hard-constraint conflicts it has are reported.

### 5.4 Choosing alternatives

- Feasible sequences are ranked by the farmer's priorities (§7).
- Alternatives are chosen in rank order. Each must differ from the baseline, and from alternatives already chosen, in its **set of crops**; reordering alone does not count.
- When the rotation length is 2 years or more, an alternative must contain at least two different crops. A single crop repeated every year is not offered as a rotation alternative.
- Up to three are shown.
- If fewer than two exist, the result says so and lists the constraints that removed the others.

## 6. Simulation

### 6.1 Weather, replay and transformations

**Historical replay** uses the pinned daily series for the replay years without changes: NASA POWER for temperature, humidity, wind and radiation, and the rain chosen by §6.1a.

A **scenario** applies explicit transformations to a copy of that series:

- precipitation × (1 + Δp/100), with Δp between −50% and +50%;
- temperature + ΔT applied to both Tmax and Tmin, with ΔT between −5 and +5 °C. This keeps Tmax ≥ Tmin.

Every transformation is recorded with its parameters. Applying the same transformation twice raises an error (double-application guard). Precipitation is clamped at ≥ 0. When a scenario has transformations, results are reported for both historical replay and the scenario.

### 6.1a Rain source (1.4.0)

One rain product is used for the whole run, chosen in this order (`src/domain/simulation/rain.ts`):

1. **NASA GPM IMERG Final Run V07** (GPM_3IMERGDF, doi:10.5067/GPM/IMERGDF/DAY/07): merged multi-satellite estimate calibrated to monthly rain-gauge analyses, for the 0.1° cell containing the field. Used when its pinned series has a value on **every** day from 1 January of the first replay year to 31 December of the last. The V07 record ends on 2025-09-30 (NASA is moving to V08), so windows ending in 2025 or later skip it.
2. **NASA GPM IMERG Late Run V07** (GPM_3IMERGDL, doi:10.5067/GPM/IMERGDL/DAY/07): the same algorithm with climatological calibration only, current to the last complete month. Same every-day rule.
3. **NASA POWER** PRECTOTCORR (MERRA-2 bias-corrected reanalysis, ½° × ⅝° cell).

Rules:

- The products are never combined: no day, month or year of one fills a gap in another. IMERG values are placed on the POWER day index; days outside the chosen IMERG record (before 1998, or after its end) stay missing.
- IMERG days run 00–24 UTC; POWER days are local solar time. At a longitude λ the two are offset by about |λ|/15 hours (6 h in Bangladesh). The offset is stated in the result; nothing is shifted.
- The result records `evidence.rainSource` (`gpm-imerg-final`, `gpm-imerg-late` or `nasa-power-daily`) and `evidence.rainRetrievalId`; the assumption line names the product, and a fallback or a skipped Final Run is explained.
- Why Final first: at the Rajshahi test cell the Late Run gave 893 mm for 2024 against 1,407 mm from the Final Run, and single years in 2015–2024 differed by up to a third (`data/verification/gpm-imerg.json`). The Late Run is used only where the Final Run cannot cover the window.
- Scenario precipitation scaling (above) applies to whichever product was chosen.

**Missing days** stay missing (null):

- a planting period with any missing day in a year is excluded from that year's statistics;
- the number of excluded years is reported;
- at least 50% of the replay years must be complete, or the indicator is insufficient evidence.

### 6.2 Reference evapotranspiration

**1.3.0: FAO-56 Penman-Monteith (Eq. 6).** POWER retrievals from processing version evidence-1.2.0 also pin daily dew point (`T2MDEW`), wind speed at 2 m (`WS2M`) and all-sky shortwave radiation (`ALLSKY_SFC_SW_DWN`, MJ m⁻² day⁻¹), plus the POWER cell elevation z. ET0 is then

ET0 = [0.408 Δ (Rn − G) + γ (900 / (T + 273)) u2 (es − ea)] / [Δ + γ (1 + 0.34 u2)]   [mm/day]

- T = (Tmax + Tmin)/2 (Eq. 9); P = 101.3 ((293 − 0.0065 z)/293)^5.26 (Eq. 7); γ = 0.665×10⁻³ P (Eq. 8).
- e°(T) = 0.6108 exp(17.27 T/(T + 237.3)) (Eq. 11); es = [e°(Tmax) + e°(Tmin)]/2 (Eq. 12); ea = e°(Tdew) (Eq. 14, the method FAO-56 prefers); Δ = 4098 e°(T)/(T + 237.3)² (Eq. 13).
- Rso = (0.75 + 2×10⁻⁵ z) Ra (Eq. 37); Rns = (1 − 0.23) Rs (Eq. 38); Rnl = σ [(Tmax,K⁴ + Tmin,K⁴)/2] (0.34 − 0.14 √ea) (1.35 Rs/Rso − 0.35) with Rs/Rso ≤ 1 (Eq. 39); Rn = Rns − Rnl (Eq. 40); G = 0 for daily steps (Eq. 42). u2 is POWER's 2 m wind, used directly.
- A day missing any input (POWER radiation starts in 1984), or with dew point above Tmax, is missing; it is never filled with Hargreaves. A run uses one ET0 method throughout.
- The implementation reproduces FAO-56 Example 18 (Brussels, 6 July: ET0 ≈ 3.9 mm/day; `penman.test.ts`).
- The temperature scenario shifts the dew point with Tmax and Tmin (dew-point depression, and so roughly relative humidity, kept); wind and radiation are unchanged.

**Hargreaves (FAO-56 Eq. 52)** is used only when the pinned retrieval predates evidence-1.2.0 (no humidity, wind or radiation series); the result says so and asks for a weather refresh:

ET0 = 0.0023 (Tmean + 17.8) (Tmax − Tmin)^0.5 Ra   [mm/day]

- Tmean = (Tmax + Tmin)/2.
- Ra is extraterrestrial radiation as equivalent evaporation: 0.408 × Ra in MJ m⁻² day⁻¹ (FAO-56 Eqs. 20–25):
  - Gsc = 0.0820 MJ m⁻² min⁻¹;
  - dr = 1 + 0.033 cos(2πJ/365);
  - δ = 0.409 sin(2πJ/365 − 1.39);
  - ωs = arccos(−tan φ tan δ), clamped for polar day and night.
- The implementation reproduces FAO-56 Example 8: 3 September at 20°S gives Ra = 32.2 MJ m⁻² day⁻¹.

FAO-56 recommends verifying Eq. 52 against Penman-Monteith in each new region; from 1.3.0 Penman-Monteith itself is used whenever the inputs are pinned. ET0 is set to 0 if Tmax < Tmin would make the square root undefined. Such days are flagged; they cannot occur after validation, because the series rejects them.

### 6.2a Kc climate adjustment (1.3.0)

With Penman-Monteith weather, Kc mid and Kc end are adjusted by FAO-56 Eq. 62 and Eq. 65: Kc = Kc(Tab) + [0.04 (u2 − 2) − 0.004 (RHmin − 45)] (h/3)^0.3, where u2 and RHmin are the means over the planting's mid-season (Eq. 62) or late-season (Eq. 65) days, RHmin = 100 e°(Tdew)/e°(Tmax) (FAO-56 Eq. 64 with ea from dew point), and h is the FAO-56 Table 12 maximum crop height (the midpoint of a printed range, e.g. soybean 0.5–1.0 → 0.75 m). FAO-56's limits are observed by clamping (1 ≤ u2 ≤ 6 m/s, 20 ≤ RHmin ≤ 80 %, 0.1 ≤ h ≤ 10 m). Kc end below 0.45 is not adjusted (FAO-56). A crop without a printed height (Table 12 prints none for winter wheat on non-frozen soil) keeps the table values; so does any stage with a missing day. The low/high Kc sensitivity cases pick the table range first, then adjust. Hargreaves runs (older retrievals) are not adjusted.

### 6.2b Bare-window fillers (1.3.0)

For each option the longest scheduled bare window (one cycle year) is compared with every catalogue crop's own planting window from the same sources the engine schedules with (farmer windows, records, the selected NASS/FAO calendar). A crop is listed when it can be planted and harvested inside the window with the turnaround on both sides; legumes first, at most five. The list is dates only: these crops are not compared for water, markets or work, and the result says so. Crops without FAO-56 stage lengths (chickpea, rapeseed/canola, mustard, jute — absent from FAO-56 Table 11, FAO-24 Table 22, FAO Training Manual No. 3 and AquaCrop's calibrated crops, checked 2026-11-06) still get only partial water indicators.

### 6.3 Crop evapotranspiration

**Potential crop ET** (no water limit) is ETc = Kc ET0. Kc follows the FAO-56 single-coefficient curve:

- constant Kc ini during the initial stage;
- linear to Kc mid over development;
- constant Kc mid during mid-season;
- linear to Kc end over the late season.

Stage lengths are the local season length × Table 11 proportions (§3.1).

**Kc ini for winter wheat.** The "frozen soils" value is used when the mean daily Tmin of the initial stage is ≤ 0 °C. Otherwise the "non-frozen soils" value is used.

**No climate adjustment.** Kc mid and Kc end are not adjusted for climate (FAO-56 Eq. 62), because that needs RHmin and wind speed, which are not in the pinned series. Table 12 values assume RHmin ≈ 45% and u2 ≈ 2 m/s. This is a stated limitation.

### 6.4 Root-zone water balance

The balance is FAO-56 Chapter 8, single coefficient. It runs once per planting period, separately for each period.

**Water-holding capacity:**

- Root depth Zr grows linearly from 0.15 m at planting to Zr,max at the end of development, then stays constant. The 0.15 m starting depth is an Astrapon modelling choice, stated in every result.
- TAW = AWC × Zr (Eq. 82), with AWC in mm per m. It is taken from the farmer lab value (cm/cm × 1000) or from SSURGO or SoilGrids (mm in 0–100 cm ÷ 1 m).
- RAW = p TAW (Eq. 83).

**Daily balance:**

Dr,i = Dr,i−1 − (P_i − RO_i) − I_i + ETa,i + DP_i (Eq. 85, with CR = 0)

Ks is evaluated after the day's rain and irrigation have been added.

- Ks = 1 when Dr ≤ RAW. Otherwise Ks = (TAW − Dr)/((1 − p) TAW) (Eq. 84).
- ETa = Ks ETc (Eq. 81).
- Deep percolation (drainage) is DP = max(0, P + I − ETa − Dr,i−1) (Eq. 88).
- Dr is bounded to 0 ≤ Dr ≤ TAW (Eq. 86).
- When roots deepen, the newly added soil layer is assumed to be at the same relative depletion as the existing root zone. This keeps storage continuous. It is an Astrapon assumption.

**Runoff and capillary rise.** (1.2.0) When the farmer gives the hydrologic soil group, daily runoff is RO = (P − 0.2S)² / (P + 0.8S) for P > 0.2S, with S = 25400/CN − 254 mm and CN from §3.3b for the crop's cover (bare fallow between crops), average antecedent condition. Without a soil group RO = 0, all rain enters the balance (this overstates water on slopes and in intense storms) and the result lists the gap. The excess over field capacity drains the same day. Capillary rise is 0, which FAO-56 says is appropriate when the water table is more than about 1 m below the root zone.

**Initial storage.** (1.2.0) Only the first planting of a simulation chain starts at a stated state: field capacity (Dr = 0) in the base case, as FAO-56 suggests "following heavy rain or irrigation", or Dr = RAW in the dry-start sensitivity case. Every later planting starts from the soil water carried over (§6.5).

### 6.5 Continuous soil water across the rotation (1.2.0)

- A strategy is simulated day by day as a chain: crop periods use the balance above; between crops the soil is bare.
- **Bare periods.** The store is the soil down to the previous crop's final root depth, at the previous crop's final relative depletion. Rain enters after curve-number runoff for bare fallow; water above field capacity drains; bare-soil evaporation follows §3.3c: E = Kr · 1.20 · ET0 with Kr = 1 while the evaporable-layer depletion De ≤ REW and Kr = (TEW − De)/(TEW − REW) after; E never exceeds TEW − De or the store's remaining water. Conservation (P − RO − E − DP = ΔS) is checked every bare period.
- **Hand-over.** At each planting the new root zone (0.15 m) starts at the relative depletion carried from the bare store; at each harvest the bare store starts at the crop's final relative depletion (the same assumption the engine already makes when roots deepen).
- **Breaks.** A crop whose water balance is not modelled (rainfed paddy rice, a crop without FAO-56 stages, missing weather) breaks the chain; the next modelled crop starts again at the stated initial storage.
- **Cycle instances.** For a rotation of N years, N chains run through the replay window, starting the cycle in the first N replay years; each start year gives one cycle instance whose water indicators (relative water supply, irrigation requirement, climatic water balance) are computed from that instance's plantings. When a chain holds three or more instances its first is spin-up only and is not counted. Medians, the 80th percentile and the driest/wettest thirds (by the start year's precipitation) are taken over instances. The seasonal allocation constraint uses the median per cycle year over base-case instances.
- Frost and hot days are unaffected (per crop and year, as before).

**Irrigation.**

- Under full irrigation, net irrigation that refills Dr to 0 is applied whenever Dr > RAW. This is the FAO-56 management-allowed-depletion approach. The total is the **net irrigation requirement**.
- Under rainfed conditions, I = 0.
- "As recorded" follows the field constraints:
  - irrigation "none" means rainfed;
  - any other value means the requirement is computed and checked against the allocation;
  - irrigation unknown means rainfed, flagged as a gap.

**Conservation check.** For every period: Σ(P + I + G) − Σ ETa − Σ DP = ΔS. Here S is the stored available water (TAW − Dr), and G is the available water in soil newly explored as roots deepen. This is checked to 1e-6 mm in tests and at runtime. A failure aborts the run.

**Paddy rice (1.3.0).** FAO-56 gives p for rice as 0.20 *of saturation*, under flooded management, and has no percolation or land-preparation values. Under **full irrigation** the engine follows FAO Irrigation Water Management Training Manual No. 3, *Irrigation Water Needs* (Brouwer & Heibloem 1986), Part II §4.4, per calendar month (`src/domain/simulation/paddy.ts`):

IN = ETcrop + SAT + PERC + WL − Pe   (≥ 0 per month)

- ETcrop = Kc × ET0 with FAO-56 Table 12 rice Kc (ini 1.05, mid 1.20, end 0.90–0.60); FAO-56 notes that initial ETc under 0.10–0.20 m of water is mainly evaporation from the standing water, so no separate Ke is used.
- SAT = 200 mm to saturate the root zone "in the month before sowing or transplanting", spread over the 30 days before planting.
- PERC = 6 mm/day while the crop is in the field, the manual's average ("heavy clay 4, sandy soils 8, on average 6 mm/day"; IRRI reports 1–5 mm/day on heavy clay and up to 25–30 mm/day on sandy soils, Bouman et al. 2007, so local values can differ widely).
- WL = 100 mm to establish the water layer at transplanting; maintaining it is inside PERC.
- Pe = 0.8 P − 25 for P > 75 mm/month, else 0.6 P − 10, never negative (manual §4.2), on each calendar month's rain; a partial month is scaled to a full month and back.
- Under ponding ETa = ETc (no water stress) and percolation is reported as drainage. After draining, the next crop starts at field capacity (FAO-56 Ch. 8, "following heavy rain or irrigation"); the chain is not broken.
- Not included: nursery water (5–10 % of the area, about a month before transplanting), puddling-crack losses, seepage to neighbours and bund overflow; the manual's values are its own placeholders "if no local data".
- Rainfed rice keeps **potential ETc and rainfall only** (no procedure for unirrigated ponding).
- Paddy needs no soil water capacity; a rotation mixing rice with upland crops still needs it for the upland crops.

**Without AWC.** The engine reports only potential demand: ETc and rainfall during the period, and their difference, labelled "climatic water balance (no soil storage)". Water-limited uptake and the irrigation requirement are insufficient evidence.

## 7. Indicators, ranking and sensitivity

### 7.1 Indicators

All indicators are computed per strategy over the replay years.

| Indicator | Unit | Definition | Support |
|---|---|---|---|
| Scheduled bare-field days | days/year | Days in the cycle with no crop scheduled, ÷ cycle years | Definition (schedule only). Not a measure of observed bare soil. |
| Crop diversity | count | Distinct crops in the cycle | Bowles et al. 2020; Smith et al. 2023 (rotation diversity context, no effect size claimed) |
| Family diversity | count | Distinct botanical families | USDA PLANTS |
| Family repetition | count per cycle | Consecutive plantings (cyclic) of the same family | USDA PLANTS. A family change does not guarantee disease control. |
| Legume plantings | count per cycle | Plantings of Fabaceae crops | USDA PLANTS. No nitrogen credit is assumed (Zhao et al. 2022 caveat). |
| Deep-rooted plantings | count per cycle | Plantings whose FAO-56 Table 22 upper Zr is ≥ 1.5 m (Astrapon display threshold, not an FAO category) | FAO-56 Table 22 |
| Relative water supply (rainfed) | ratio 0–1 | Σ ETa / Σ ETc over all plantings, median across years, plus the driest-third mean | FAO-56 Ch. 8 |
| Net irrigation requirement | mm/year | Median and 80th percentile across years | FAO-56 Ch. 8 |
| Climatic water balance (no AWC) | mm/year | Σ (P − ETc) during plantings | FAO-56 Eq. 6 (or 52) + Table 12 |
| Frost days in growing periods | days/year | Tmin ≤ 0 °C on scheduled crop days (air temperature, coarse cell). Reported, **not scored**: crop- and stage-specific critical temperatures are not sourced, and frost during winter dormancy is normal for winter cereals. | NASA POWER. Exposure only, not crop damage. |
| Hot days in growing periods | days/year | Tmax ≥ 35 °C on scheduled crop days. Reported, **not scored** (same reason). | NASA POWER. Exposure only. |
| Field operations | plantings/year | Plantings per year | Proxy for workload, stated as such. Labour hours are not estimated. |
| Market fit | share | Plantings with a farmer-stated "preferred", "acceptable" or contract market ÷ plantings with any stated preference | Farmer report. Unknown is shown separately. Not income. |
| Cover/legume opportunity | days | Longest scheduled bare window in the cycle and the month it starts. Reported, not scored. Together with the legume and deep-rooted counts it shows where a cover or legume crop could be considered. Whether a specific cover crop fits is a local-review question: cover crops in the catalogue have no sourced season lengths. | Schedule |

### 7.2 Ranking

The six farmer priorities (0–5) map to indicator groups:

| Priority | Indicator group |
|---|---|
| water use | Rainfed: higher relative water supply. Irrigated: lower irrigation requirement. Without AWC: climatic water balance. |
| soil health | Fewer bare days, fewer family repeats, more legume and deep-rooted plantings. These are *rotation-structure indicators*, not soil measurements. |
| diversification | Crop and family diversity. |
| weather risk | Smaller gap between median-year and driest-third water supply (or irrigation need). Frost and hot days are reported but not scored. |
| workload | Fewer field operations. |
| income stability | Market fit (stated preferences only). No income is computed. |

**Score:**

- Each indicator is min–max normalised to 0–1 across the strategies being compared, so that 1 is better. If all values are equal, it gets 0.5.
- Group score = mean of its available indicators. Score = Σ w·group / Σ w over groups with data.
- Indicators that are insufficient for any compared strategy are dropped for all, so that strategies are compared on common inputs. They are listed as gaps.
- (1.1.0) Indicators are rounded before they are scored, exactly as they are displayed: ratios and shares to 0.001, everything else to 0.1. The score is therefore a function of the published indicator table, and `scoreOptions()` reproduces the stored ranking from it (tested). Each run publishes its indicator definitions (key, priority group, direction, unit, scored or not).
- (1.1.0) The comparison page may *preview* other priority weights by calling the same `scoreOptions()` on the stored base-case table. A preview re-orders only the options already shown; it does not re-select alternatives or re-run the sensitivity cases, and it is labelled as unsaved. Saving the weights and running again is a separate, explicit action.

**Explanation.** The result shows each group's contribution to each strategy's score, and the rank order with each priority set to 0 in turn (priority ablation). That identifies which priorities changed the ranking.

### 7.3 Sensitivity and stability

The strategies are re-ranked under each case:

1. dry initial storage (Dr = RAW);
2. Kc low and Kc high, where the table gives a range;
3. driest third of replay years only (by precipitation during the plantings);
4. wettest third only.

**Classification:**

- **Stable:** the top-ranked strategy is the same in every case.
- **Fragile:** it changes in at least one case. The result lists the cases that change it.

No probability distributions are assumed or invented.

### 7.4 Data completeness

Completeness is reported as **counts of required inputs available**. Examples:

- "Crop parameters: 3 of 4 plantings";
- "Stage lengths: 2 of 4";
- "Soil water capacity: survey (SSURGO)";
- "Weather: 19 of 20 replay years complete".

It is never converted to a percentage labelled confidence.

## 8. Defaults and assumptions (shown in every result)

- Turnaround: 0 days unless the farmer enters a value.
- Initial storage: field capacity at the start of each simulation chain, with a dry-start sensitivity case; later plantings carry over (§6.5).
- Runoff: NRCS curve numbers when the hydrologic soil group is given, else 0. Capillary rise: 0.
- Bare-soil evaporation: FAO-56 Ch. 7, Kc,max 1.20, TEW/REW from Table 19 for the AWC-implied class.
- Root depth at planting: 0.15 m. Maximum: the FAO-56 Table 22 upper value.
- Kc: Table 12 without climate adjustment. Range midpoint, or the low end for rainfed oil crops.
- ET0: Penman-Monteith (Eq. 6) from POWER cell values (1.3.0); Hargreaves (Eq. 52) only for older retrievals. POWER humidity, wind and radiation describe a ½°–1° cell, not the field.
- All priorities are 3 when the farmer has not set them.
- Whole field, plus each zone with records of its own (§1).

## 9. Reproducibility and storage

- A run reads only immutable inputs:
  - the input snapshot (scenario, field, history, constraints, priorities and markets, all frozen);
  - the pinned reference dataset versions (crop parameters, calendar);
  - the pinned evidence retrievals: the daily series and the SSURGO aggregate, rows that cannot be updated.
- The worker builds a canonical engine input from these and records its SHA-256 in the result.
- The engine is pure: no clock, no randomness, no I/O. The same input and engine version give byte-identical output. This is tested, and the "Re-run and compare" action checks it against the stored `result_sha256`.
- Results are stored in `simulation_results`, which cannot be updated, together with the engine version, the snapshot id and the input digest.

## 9a. Day-by-day timeline (added in 1.1.0)

Each run also publishes a timeline for the strategies it compares. It is display data for the 3D replay and the selected-date tables; it never feeds the ranking.

- **Window:** the most recent run of rotation-length calendar years inside the replay period in which every day has Tmax, Tmin and precipitation. If none exists, there is no timeline and the result says why.
- **Placement:** each planting's cycle-year offset is placed in those real years. The previous and next repetition of the cycle are also placed where they overlap the window, so a crop that crosses the cycle boundary is shown on both ends.
- **State:** (1.2.0) the window's plantings, preceded by one spin-up cycle, run as one continuous chain through the same code path as the indicators (§6.3–6.5, base case), so bare days carry soil depletion, evaporation, drainage and (when modelled) runoff. The daily Kc, ETc, root depth, root-zone depletion (Dr/TAW), Ks, ETa, irrigation and drainage are stored. When soil water capacity is unknown, or the crop is potential-only, only Kc and ETc are stored.
- **Weather:** the window's daily precipitation, Tmax, Tmin and ET0, after any scenario transformation, are stored with the timeline.
- **Rounding:** Kc, root depth and Ks to 0.01; depletion to 0.001; water quantities to 0.1 mm.
- The 3D growth stage is derived from the FAO-56 stage lengths (initial, development, mid-season, late season); plant height is illustrative.

## 10. Computation bounds

- The replay window is at most 45 years. There are at most 12 candidate crops after merging history, at most 3 plantings per year and at most 4 rotation years.
- Water balances are computed once per (crop, planting slot, year, case) and reused across sequences.
- Search is limited as described in §5.2.
- Runs execute in the background worker (`pnpm evidence:worker` also processes simulation runs), never in a web request.
- A benchmark test bounds the time for a typical run.

## 11. Validation and tests

`src/domain/simulation/*.test.ts` covers:

- unit conversions and FAO-56 Example 8;
- water balance conservation and storage bounds on synthetic cases: no rain, saturating rain, irrigation refill;
- missing inputs giving insufficient evidence;
- cross-year scheduling and cyclic overlap;
- every hard constraint;
- ranking changes when priorities change;
- transformation double-application and physical-range guards;
- identical-input reproducibility, byte for byte;
- a computation benchmark.

The engine has not been validated against field measurements of soil water or ET. Its outputs are planning-level comparisons for local review.

## 12. Known limitations

- Kc climate adjustment (1.3.0) uses POWER cell wind and humidity, not field values; Hargreaves ET0 (older retrievals only) is uncalibrated.
- Runoff needs the farmer's hydrologic soil group; without it no runoff is modelled. Curve numbers come from storm-event data and are applied to daily totals; frozen soil and slope are not separately treated; runoff does not move between zones.
- Carry-over hands the relative depletion across stage changes; the evaporable-layer class is inferred from AWC, not measured.
- Paddy rice irrigation uses FAO TM3 placeholder values (percolation 6 mm/day, 200 mm soaking, 100 mm layer), not local measurements; rainfed rice is potential only.
- Calendars exist for US states (NASS 2010, circa-2009 practice) and for FAO agro-ecological zones in 57 countries (chosen by the farmer). Elsewhere they come only from the farmer's own dates.
- Crops without FAO-56 stage lengths or coefficients get partial indicators.
- Zones are compared on their own history and soil value; weather is the same coarse cell for every zone.
- Equipment needs and forage suitability are not modelled. They appear as local-review questions.
- Coarse weather (POWER cell ≈ 50 km) represents the whole field for temperature, humidity, wind and radiation; rain is from a 0.1° IMERG cell (≈ 11 km) when it covers the window (1.4.0), which is still not a rain gauge in the field.
- The IMERG Late Run (used for windows that reach past 2025-09-30) is not gauge-calibrated and can differ from the Final Run by a third in a single year; IMERG and POWER days have different boundaries (UTC vs local solar time).
