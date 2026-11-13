-- ISRIC SoilGrids 2.0 water retention as a pipeline source (root-zone water capacity outside the
-- US soil survey). Widens the source checks on retrievals and jobs.

alter table public.evidence_retrievals drop constraint evidence_retrievals_source_id_check;
alter table public.evidence_retrievals add constraint evidence_retrievals_source_id_check
  check (source_id in ('nasa-power-daily', 'modis-mod13q1-ornl', 'usda-ssurgo-sda', 'isric-soilgrids-v2'));

alter table public.evidence_jobs drop constraint if exists evidence_jobs_source_id_check;
alter table public.evidence_jobs add constraint evidence_jobs_source_id_check
  check (source_id in ('nasa-power-daily', 'modis-mod13q1-ornl', 'usda-ssurgo-sda', 'isric-soilgrids-v2'));
