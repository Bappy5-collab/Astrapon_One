-- NASA SMAP L3 Enhanced soil moisture as an optional evidence source (context only).

alter table public.evidence_retrievals drop constraint evidence_retrievals_source_id_check;
alter table public.evidence_retrievals add constraint evidence_retrievals_source_id_check
  check (source_id in ('nasa-power-daily', 'modis-mod13q1-ornl', 'usda-ssurgo-sda', 'isric-soilgrids-v2', 'smap-l3-enhanced'));

alter table public.evidence_jobs drop constraint evidence_jobs_source_id_check;
alter table public.evidence_jobs add constraint evidence_jobs_source_id_check
  check (source_id in ('nasa-power-daily', 'modis-mod13q1-ornl', 'usda-ssurgo-sda', 'isric-soilgrids-v2', 'smap-l3-enhanced'));
