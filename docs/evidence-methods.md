# Evidence pipeline: methods and harmonisation

Processing version: **`evidence-1.3.0`** (`PROCESSING_VERSION` in `src/domain/evidence/catalog.ts`). Every retrieval row and cache key records it. A change to any rule below requires a new processing version.

- **1.3.0** (2026-11-13) adds the source `gpm-imerg-daily`: NASA GPM IMERG V07 daily precipitation for the 0.1° cell containing the field's interior point, both the gauge-calibrated **Final Run** (GPM_3IMERGDF, record 1998-01-01 to its newest granule, 2025-09-30 for V07) and the **Late Run** (GPM_3IMERGDL, 1998-01-01 to the end of the last complete month). Route: NASA Earthdata Harmony with the Giovanni area-average time series (CSV), one job per run over a box ±0.025° around the cell centre, so the average is that one cell; the worker's Earthdata token is required and the account must authorise the NASA GESDISC DATA ARCHIVE application. Checks per run: column = `mean_<variable>`, box inside the cell, start/end, every day once and in order, fill value present; fill (−9999.9), empty, negative and > 2000 mm values become NULL (never 0). Stored as two daily series `IMERG_FINAL_PRECIP` and `IMERG_LATE_PRECIP` (mm/day) on the IMERG retrieval, never written into the POWER rows, plus monthly sums `imerg_final_precip` / `imerg_precip` (every day present). The Late Run is required; a failed Final Run makes the retrieval `partial`. Raw CSV in the disk cache; the whole record takes about 25–55 s per run. Migration `20261113100000_imerg_rain_source.sql`. Verified: the Harmony values equal an OPeNDAP read of the same cell in the daily files for both runs (`pnpm verify:sources imerg` → `data/verification/gpm-imerg.json`).
- **1.2.0** (2026-11-06) adds the optional source `smap-l3-enhanced` (NASA SMAP L3E v006, 9 km EASE-Grid 2.0 cell, last two years, one OPeNDAP request per daily file with the worker's Earthdata token; day value = mean of the AM/PM retrievals; monthly means `smap_sm` (recommended-quality only, flag bit 0 = 0) and `smap_sm_any` (all valid retrievals), missing days stay missing; not used by the engine) and the source `isric-soilgrids-v2`: SoilGrids 2.0 water content at 33 and 1500 kPa for 0–100 cm (REST point query; WCS fallback averaging the valid 250 m pixels within about 330 m, then 1.3 km; the route is recorded), stored as the aggregate `awc_0_100cm` (mm). For POWER it also requests and stores `T2MDEW` (°C), `WS2M` (m/s) and `ALLSKY_SFC_SW_DWN` (MJ/m²/day, POWER units `MJ/m^2/day`, checked per response) as daily series, and records the cell elevation POWER returns (third coordinate) in the retrieval provenance (`elevationM`), for FAO-56 Penman-Monteith ET0 (engine 1.3.0). Radiation is fill (NULL) before 1984. Migration `20261106100000_power_penman_monteith.sql` widens the variable and unit checks.
- **1.1.0** (Phase 5) adds the normalised daily series of `T2M_MAX`, `T2M_MIN` and `PRECTOTCORR` to each POWER retrieval (`public.evidence_daily_series`). The simulation engine reads its weather from these rows, which cannot be updated. A row holds the values after unit and fill checks (missing = NULL), one per consecutive day, with a server-computed SHA-256. Raw provider responses still never enter PostgreSQL.
- **1.0.0** retrievals have no daily series. Refresh the evidence before running a simulation.

## Sources in the pipeline

| Source | Evidence class | Native support | Record used | Why |
|---|---|---|---|---|
| NASA POWER daily, AG community (`T2M`, `T2M_MAX`, `T2M_MIN`, `PRECTOTCORR`, `GWETROOT`; 1.2.0 adds `T2MDEW`, `WS2M`, `ALLSKY_SFC_SW_DWN`) | Model-derived (MERRA-2 / GEOS-IT) | ½° lat × ⅝° lon cell | 1981-01-01 to the end of the last complete month | Global, long, daily. The one temperature, humidity, wind and radiation series; the rain series when IMERG cannot cover a run. |
| NASA GPM IMERG V07 daily precipitation, Final and Late Run (1.3.0) | Satellite observation (merged multi-satellite estimate) | 0.1° cell (≈ 11 km) | 1998-01-01 to 2025-09-30 (Final) / the end of the last complete month (Late) | Finer, observation-driven rain. Engine 1.4.0 uses one run for a whole comparison when it covers every replay day (Final first), else POWER. Default source (part of "Refresh all" and of a new field's first download). |
| MODIS Terra MOD13Q1 v061 NDVI + pixel reliability, via ORNL TESViS | Satellite observation | ≈231.66 m sinusoidal pixels, 16-day composites | 1 January ten years before the latest composite's year, to the latest composite (since 2026-11-04; the full record from 2000-02-18 before) | The complementary NASA product chosen in Phase 1 research: observed vegetation seasonality and trend. **Optional:** fetched only when the user asks, never part of "Refresh all", and never read by the simulation engine. |
| USDA SSURGO via Soil Data Access | Ground / survey | Map-unit polygon | Current survey version | Credible soil water capacity where surveyed (United States only). |

### Not added, and why

- **GPM IMERG** was deferred here until 1.3.0 because its precipitation overlaps POWER `PRECTOTCORR`. It is now added without a blend: each run of the engine uses exactly one rain product (see the scientific methodology §6.1a).
- **SMAP L3:** surface (≈5 cm) volumetric soil moisture is a different depth and quantity from POWER's root-zone wetness fraction. It is not combined, and it needs an asynchronous AppEEARS job. Deferred.
- **NASADEM:** no indicator in this phase uses slope or elevation.
- **ISRIC SoilGrids:** the REST service still returned HTTP 503 on 2026-10-31. Outside the US no survey soil value is shown; farmer soil tests on the Records page remain the source.

## Common analysis period and aggregation

- Climate normals use the WMO standard period **1991–2020**. A month's normal needs ≥ 24 of the 30 years.
- "Recent" summaries use the **last 10 complete calendar years** in the record and need ≥ 8 of them.
- POWER and MODIS are never merged into one number. When they are compared, the shared window is 2001 onwards (MODIS starts 2000-02-18).
- Time standard: POWER daily values are in local solar time (LST). MODIS composites are labelled by their first day; each covers 16 days.
- Temporal aggregation: daily → calendar month (mean for temperature and wetness, sum for precipitation) → three-month seasons named by months (Dec–Feb uses the previous December), so labels are correct in both hemispheres. Annual counts use calendar years.

## Missing data and completeness

- POWER fill values (−999) become `null`. Missing values are never zero and never interpolated.
- A month needs **≥ 90% valid days**. Otherwise the value is empty, and the valid/expected counts are stored and shown.
- Sums over incomplete months are never scaled up.
- An annual count needs **≥ 95% valid days** in the year.
- A dry spell is ended by a missing day, which is not assumed dry. Spells do not carry across years.
- MODIS uses only pixel reliability 0 (good). Marginal, snow/ice, cloudy and fill composites are dropped, not filled.
  - A field composite needs good data for at least half of the field's pixels.
  - An annual peak needs ≥ 8 good composites in the year.
  - A trend needs ≥ 8 years.
- The record ends at the last complete month, so recent near-real-time gaps are not reported as data.

## Spatial support and extraction

- **POWER** is requested at the centre of the POWER grid cell containing the field's interior point. Every field in that cell therefore shares one cached retrieval. The value describes the whole cell and is never shown as varying inside a field.
- **MODIS:**
  - Requested as a grid around the pixel containing the field's interior point. The half-width in whole kilometres covers the field, capped at 4 km.
  - The grid origin and cell size come from the response (`xllcorner`, `yllcorner`, `cellsize`). Pixel footprints are computed exactly from the sinusoidal projection.
  - Far from the central meridian these pixels are sheared parallelograms in lon/lat. Coverage is therefore sampled inside each pixel's own corners, not its lon/lat bounding box.
  - A pixel counts as "in the field" when ≥ 75% of it lies inside the boundary (holes excluded).
  - The field value is the mean of those pixels. If none qualifies, the pixel at the interior point is used and labelled as neighbourhood context.
  - Within-field variation is shown only when at least 2 pixels qualify (and at most 81). No resampling or smoothing creates detail finer than a pixel.
- **SSURGO:** the map unit containing the interior point. Plant-available water capacity is computed over the top 100 cm, weighted by component share. Components with missing horizons are excluded and reported.

## Quantities never combined

| Never combined | Because |
|---|---|
| POWER `GWETROOT` (0–1 root-zone wetness, model) with SMAP surface volumetric moisture | Different depth and quantity |
| `T2M` (daily mean air temperature) with `T2M_MAX`/`T2M_MIN` and land-surface temperature | Different temperature definitions |
| Two precipitation products (POWER `PRECTOTCORR`, IMERG Final, IMERG Late) | Double counting; different calibrations. One product per engine run, per dry-season outlook and per evidence number; a gap in one is never filled from another |
| Evapotranspiration types (reference ET vs actual ET) | None is computed in this phase |

## Indicators

| Indicator | Definition | Limits |
|---|---|---|
| Frost days per year | Days with `T2M_MIN` ≤ 0 °C | Generic threshold; ground frost in hollows can be more frequent |
| Hot days per year | Days with `T2M_MAX` ≥ 35 °C | Generic threshold |
| Longest dry spell; dry spells ≥ 10 days | Consecutive days with precipitation < 1 mm | Ignores irrigation and soil storage |
| Seasonal precipitation vs normal | Season total minus the 1991–2020 season normal; also % of normal | |
| Temperature vs normal | Monthly `T2M` mean minus the 1991–2020 monthly normal | |
| Root-zone soil wetness (model) | Monthly `GWETROOT` mean and its anomaly | Context only, not a field moisture measurement |
| Peak greenness (NDVI) | Highest good composite per year; Theil–Sen slope per decade | Descriptive, with no significance test |
| Plant-available water capacity, 0–100 cm | SSURGO, mm | |

None of these is crop damage, yield, disease, nutrient status or a forecast. NDVI cannot identify a crop.

## Provenance and reproducibility

- **Retrieval row** (`evidence_retrievals`) records:
  - product id and version (POWER API version; MOD13Q1 061; SSURGO survey date) and processing version;
  - cache key;
  - the request without credentials;
  - observation period, which is separate from `retrieved_at` (the earliest network fetch among the chunks used);
  - response SHA-256 over the chunk hashes, response bytes;
  - validation checks and provenance (upstream sources, grid, pixel coverage, quality counts).
- Raw responses are not stored in PostgreSQL. They live in an on-disk chunk cache (`.cache/evidence`, git-ignored). Cache keys include product, location key (POWER cell or MODIS pixel and grid size), period and request parameters.
- **Saved snapshots** (input schema v2) pin each source's newest valid retrieval by id, response hash and a digest of all its aggregate rows.
  - A database foreign key stops a pinned retrieval from being deleted.
  - A refresh creates a new retrieval and never edits an old one (rows are immutable), so a saved snapshot always reproduces.

## Operations

- **Network:** every provider request goes through `fetchText`, which enforces:
  - an allowlist of hosts, HTTPS only;
  - a per-host concurrency limit (ORNL: 1, others: 2);
  - a per-attempt timeout;
  - bounded retries with backoff for timeouts, network errors, 429 and 5xx.
- **Jobs:** `evidence_jobs` is the persisted queue. A user may only enqueue (`request_evidence`, deduplicated per field and source) or cancel. A trigger restricts status changes to the trusted worker.
- **Worker** (`pnpm evidence:worker`) is a separate Node process:
  - Claims jobs with `FOR UPDATE SKIP LOCKED` and a 3-minute lease, renewed on progress; an expired lease is reclaimed.
  - Retries "unavailable" failures with backoff up to 3 attempts; "invalid" and "not applicable" fail at once.
  - Writes each retrieval with its aggregates in one transaction.
  - Reuses the latest retrieval when nothing changed (same cache key and response hash).
- **Timings:**
  - A first MODIS retrieval for a new location took about 18 minutes with the full record: 124 sequential ORNL requests at ≈9 s each. Since 2026-11-04 it fetches the last 10 years plus the current one (≈50 requests) with 4 in flight: a first retrieval near Jessore, Bangladesh took 150 s (2026-11-04); a cached repeat took 0.1 s.
  - The worker claims optional (MODIS) jobs after every required job, so greenness never delays POWER, soil or simulation runs.
  - A first POWER retrieval took about 11 s (five 10-year chunks).
  - Cached repeats take seconds.
  - This is why downloads never run inside a web request. Astrapon does not promise unlimited free processing: the public services are rate-limited and best-effort.
- **Failure handling:** each source fails independently. A failed refresh keeps the previous retrieval visible and marks it **stale**. The UI shows queued, running, failed, stale and complete states with retry and cancel.
