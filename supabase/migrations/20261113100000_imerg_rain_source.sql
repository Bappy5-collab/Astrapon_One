-- evidence-1.3.0 / engine 1.4.0: NASA GPM IMERG V07 daily rain as an evidence source.
-- One retrieval stores the gauge-calibrated Final Run (IMERG_FINAL_PRECIP) and the Late Run
-- (IMERG_LATE_PRECIP) as separate daily series (mm/day). They are never written into, or merged with,
-- each other or the NASA POWER series; a run uses one rain product throughout. Existing rows unchanged.

alter table public.evidence_retrievals drop constraint evidence_retrievals_source_id_check;
alter table public.evidence_retrievals add constraint evidence_retrievals_source_id_check
  check (source_id in ('nasa-power-daily', 'gpm-imerg-daily', 'modis-mod13q1-ornl', 'usda-ssurgo-sda', 'isric-soilgrids-v2', 'smap-l3-enhanced'));

alter table public.evidence_jobs drop constraint evidence_jobs_source_id_check;
alter table public.evidence_jobs add constraint evidence_jobs_source_id_check
  check (source_id in ('nasa-power-daily', 'gpm-imerg-daily', 'modis-mod13q1-ornl', 'usda-ssurgo-sda', 'isric-soilgrids-v2', 'smap-l3-enhanced'));

alter table public.evidence_daily_series drop constraint if exists evidence_daily_series_variable_check;
alter table public.evidence_daily_series add constraint evidence_daily_series_variable_check
  check (variable in ('T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'T2MDEW', 'WS2M', 'ALLSKY_SFC_SW_DWN', 'IMERG_FINAL_PRECIP', 'IMERG_LATE_PRECIP'));
