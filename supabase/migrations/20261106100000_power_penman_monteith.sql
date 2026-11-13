-- evidence-1.2.0 / engine 1.3.0: the POWER daily series also store dew point (T2MDEW), 2 m wind
-- (WS2M) and all-sky shortwave radiation (ALLSKY_SFC_SW_DWN) so the engine can compute FAO-56
-- Penman-Monteith reference evapotranspiration. Existing rows are unchanged (immutable).

alter table public.evidence_daily_series drop constraint if exists evidence_daily_series_variable_check;
alter table public.evidence_daily_series add constraint evidence_daily_series_variable_check
  check (variable in ('T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'T2MDEW', 'WS2M', 'ALLSKY_SFC_SW_DWN'));

alter table public.evidence_daily_series drop constraint if exists evidence_daily_series_unit_check;
alter table public.evidence_daily_series add constraint evidence_daily_series_unit_check
  check (unit in ('°C', 'mm/day', 'm/s', 'MJ/m²/day'));
