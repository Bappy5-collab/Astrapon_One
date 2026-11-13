-- The map's "Assign crop" form now records the planting and harvest dates too, so a season added
-- there is complete for the comparison (same as "What you grew"). Only the crop step of
-- save_field_workspace changes: it writes planted_on/harvested_on when given.

create or replace function public.save_field_workspace(p_field_id uuid, p_edits jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  z jsonb;
  c jsonb;
  ref_ids jsonb := '{}'::jsonb;
  v_zone_id uuid;
  matches integer;
  zone_ref text;
begin
  if p_edits is null or jsonb_typeof(p_edits) <> 'object' then
    raise exception 'Edits must be an object' using errcode = '22023';
  end if;
  perform 1 from public.fields f where f.id = p_field_id for update;
  if not found then
    raise exception 'Field not found' using errcode = 'P0002';
  end if;

  -- 1. Deleted zones (their zone-specific history and soil rows cascade).
  if jsonb_typeof(p_edits->'deleteZoneIds') = 'array' then
    delete from public.planting_zones
     where field_id = p_field_id
       and id in (select (jsonb_array_elements_text(p_edits->'deleteZoneIds'))::uuid);
  end if;

  -- 2. Boundary (zone containment is re-checked at commit by fields_check_zones_inside).
  if jsonb_typeof(p_edits->'boundary') = 'object' then
    update public.fields
       set boundary = private.multipolygon_from_geojson(p_edits->'boundary'->'geometry'),
           boundary_source = p_edits->'boundary'->>'source'
     where id = p_field_id;
  end if;

  -- 3. Zones: insert new ones (remember ref -> id), update existing ones.
  for z in select * from jsonb_array_elements(coalesce(p_edits->'zones', '[]'::jsonb)) loop
    if z->>'id' is null then
      insert into public.planting_zones (field_id, name, boundary, basis, notes)
      values (p_field_id, z->>'name', private.multipolygon_from_geojson(z->'boundary'), z->>'basis', nullif(z->>'notes', ''))
      returning id into v_zone_id;
      ref_ids := ref_ids || jsonb_build_object(z->>'ref', v_zone_id);
    else
      update public.planting_zones
         set name = z->>'name',
             basis = z->>'basis',
             notes = nullif(z->>'notes', ''),
             boundary = case when jsonb_typeof(z->'boundary') = 'object' then private.multipolygon_from_geojson(z->'boundary') else boundary end
       where id = (z->>'id')::uuid and field_id = p_field_id;
      if not found then
        raise exception 'Planting zone not found' using errcode = 'P0002';
      end if;
      ref_ids := ref_ids || jsonb_build_object(z->>'ref', z->>'id');
    end if;
  end loop;

  -- 4. Crop assignments: set the crop of one (zone or whole field, year, season) record.
  for c in select * from jsonb_array_elements(coalesce(p_edits->'crops', '[]'::jsonb)) loop
    zone_ref := c->>'zoneRef';
    if zone_ref is null then
      v_zone_id := null;
    elsif ref_ids ? zone_ref then
      v_zone_id := (ref_ids->>zone_ref)::uuid;
    else
      v_zone_id := null;
      select pz.id into v_zone_id from public.planting_zones pz where pz.field_id = p_field_id and pz.id::text = zone_ref;
      if v_zone_id is null then
        raise exception 'Planting zone not found' using errcode = 'P0002';
      end if;
    end if;

    select count(*) into matches from public.crop_history h
     where h.field_id = p_field_id and h.zone_id is not distinct from v_zone_id
       and h.season_year = (c->>'seasonYear')::integer and h.season = c->>'season';
    if matches = 0 then
      insert into public.crop_history (field_id, zone_id, season_year, season, crop_name, planted_on, harvested_on)
      values (p_field_id, v_zone_id, (c->>'seasonYear')::integer, c->>'season', c->>'cropName',
              (c->>'plantedOn')::date, (c->>'harvestedOn')::date);
    elsif matches = 1 then
      update public.crop_history h
         set crop_name = c->>'cropName',
             planted_on = coalesce((c->>'plantedOn')::date, h.planted_on),
             harvested_on = coalesce((c->>'harvestedOn')::date, h.harvested_on)
       where h.field_id = p_field_id and h.zone_id is not distinct from v_zone_id
         and h.season_year = (c->>'seasonYear')::integer and h.season = c->>'season';
    else
      raise exception 'There is more than one % % record for that zone; edit it in Crop history instead', c->>'seasonYear', c->>'season' using errcode = 'P0001';
    end if;
  end loop;

  return jsonb_build_object('zoneIds', ref_ids);
end;
$$;


comment on function public.save_field_workspace(uuid, jsonb) is
  'Applies a farmer-confirmed batch of workspace edits atomically. SECURITY INVOKER (RLS applies).';

revoke execute on function public.save_field_workspace(uuid, jsonb) from public, anon;
grant execute on function public.save_field_workspace(uuid, jsonb) to authenticated;
