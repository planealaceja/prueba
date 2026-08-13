-- =========================================================================
--  VISTA AGREGADA (para el mapa público / mapa de calor)
-- =========================================================================
create or replace view public.public_sector_counts as
select
  s.id            as sector_id,
  s.nombre        as sector_nombre,
  s.tipo          as sector_tipo,
  count(p.id)     as total_personas,
  count(*) filter (where p.en_situacion_riesgo) as total_riesgo,
  st_asgeojson(s.geom)::json as geom
from public.sectors s
left join public.people p on p.sector_id = s.id
group by s.id, s.nombre, s.tipo, s.geom;

-- Esta vista SÍ es de lectura pública: no expone ninguna fila individual,
-- solo conteos por sector. Es la única fuente de datos del mapa de calor.
grant select on public.public_sector_counts to anon, authenticated;

-- =========================================================================
--  FUNCIONES RPC — todo acceso administrativo pasa por aquí (SECURITY DEFINER)
--  Cada una valida rol y escribe en audit_log antes de devolver datos.
-- =========================================================================

-- ---- Helper: valida que quien llama sea admin activo ---------------------
create or replace function public._is_active_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.activo
  );
$$;

-- ---- 1. Listar personas (paginado, sin datos de contacto) ---------------
create or replace function public.rpc_list_people(
  p_sector_id uuid default null,
  p_limit int default 50,
  p_offset int default 0
)
returns setof public.people
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._is_active_admin() then
    raise exception 'No autorizado';
  end if;

  insert into public.audit_log (actor_id, accion, tabla, motivo)
  values (auth.uid(), 'READ_LIST', 'people', 'Listado panel administrativo');

  return query
    select * from public.people p
    where (p_sector_id is null or p.sector_id = p_sector_id)
    order by p.fecha_registro desc
    limit p_limit offset p_offset;
end;
$$;

-- ---- 2. Ver detalle de contacto de UNA persona (exige motivo) -----------
create or replace function public.rpc_get_contact_detail(
  p_person_id uuid,
  p_motivo text
)
returns public.people_contact
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.people_contact;
begin
  if not public._is_active_admin() then
    raise exception 'No autorizado';
  end if;
  if p_motivo is null or length(trim(p_motivo)) < 5 then
    raise exception 'Debe indicar un motivo de consulta (mínimo 5 caracteres)';
  end if;

  select * into v_result from public.people_contact where person_id = p_person_id;

  insert into public.audit_log (actor_id, accion, tabla, registro_id, motivo)
  values (auth.uid(), 'READ_DETAIL', 'people_contact', p_person_id, p_motivo);

  return v_result;
end;
$$;

-- ---- 3. Crear persona + (opcional) datos de contacto ----------------------
create or replace function public.rpc_add_person(
  p_sector_id uuid,
  p_rango_edad text,
  p_identidad_genero text,
  p_orientacion_sexual text,
  p_necesidades text[],
  p_en_riesgo boolean,
  p_consentimiento boolean,
  p_fuente text,
  p_contacto_nombre text default null,
  p_contacto_telefono text default null,
  p_contacto_correo text default null,
  p_contacto_barrio_aprox text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public._is_active_admin() then
    raise exception 'No autorizado';
  end if;
  if p_consentimiento is not true then
    raise exception 'No se puede registrar a una persona sin consentimiento informado';
  end if;

  insert into public.people (
    sector_id, rango_edad, identidad_genero, orientacion_sexual,
    necesidades, en_situacion_riesgo, consentimiento_informado,
    fecha_consentimiento, fuente_registro, registrado_por
  ) values (
    p_sector_id, p_rango_edad, p_identidad_genero, p_orientacion_sexual,
    p_necesidades, coalesce(p_en_riesgo, false), true,
    now(), coalesce(p_fuente, 'presencial'), auth.uid()
  ) returning id into v_id;

  if p_contacto_nombre is not null or p_contacto_telefono is not null then
    insert into public.people_contact (person_id, nombre_completo, telefono, correo, barrio_aprox)
    values (v_id, p_contacto_nombre, p_contacto_telefono, p_contacto_correo, p_contacto_barrio_aprox);
  end if;

  insert into public.audit_log (actor_id, accion, tabla, registro_id, motivo)
  values (auth.uid(), 'CREATE', 'people', v_id, 'Alta de registro con consentimiento informado');

  return v_id;
end;
$$;

-- ---- 4. Actualizar caracterización ---------------------------------------
create or replace function public.rpc_update_person(
  p_person_id uuid,
  p_sector_id uuid,
  p_rango_edad text,
  p_identidad_genero text,
  p_orientacion_sexual text,
  p_necesidades text[],
  p_en_riesgo boolean,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._is_active_admin() then
    raise exception 'No autorizado';
  end if;

  update public.people set
    sector_id = coalesce(p_sector_id, sector_id),
    rango_edad = coalesce(p_rango_edad, rango_edad),
    identidad_genero = coalesce(p_identidad_genero, identidad_genero),
    orientacion_sexual = coalesce(p_orientacion_sexual, orientacion_sexual),
    necesidades = coalesce(p_necesidades, necesidades),
    en_situacion_riesgo = coalesce(p_en_riesgo, en_situacion_riesgo),
    actualizado_en = now()
  where id = p_person_id;

  insert into public.audit_log (actor_id, accion, tabla, registro_id, motivo)
  values (auth.uid(), 'UPDATE', 'people', p_person_id, coalesce(p_motivo, 'Edición desde panel administrativo'));
end;
$$;

-- ---- 5. Eliminar persona (borra también su contacto en cascada) --------
create or replace function public.rpc_delete_person(
  p_person_id uuid,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._is_active_admin() then
    raise exception 'No autorizado';
  end if;
  if p_motivo is null or length(trim(p_motivo)) < 5 then
    raise exception 'Debe indicar un motivo de eliminación';
  end if;

  insert into public.audit_log (actor_id, accion, tabla, registro_id, motivo)
  values (auth.uid(), 'DELETE', 'people', p_person_id, p_motivo);

  delete from public.people where id = p_person_id;
end;
$$;

-- ---- 6. Panel: estadísticas generales -------------------------------------
create or replace function public.rpc_dashboard_stats()
returns table (
  total_personas bigint,
  total_sectores_con_registro bigint,
  total_riesgo bigint,
  registros_ultimos_7_dias bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._is_active_admin() then
    raise exception 'No autorizado';
  end if;

  return query
    select
      (select count(*) from public.people),
      (select count(distinct sector_id) from public.people),
      (select count(*) from public.people where en_situacion_riesgo),
      (select count(*) from public.people where fecha_registro > now() - interval '7 days');
end;
$$;

revoke all on function public.rpc_list_people, public.rpc_get_contact_detail,
  public.rpc_add_person, public.rpc_update_person, public.rpc_delete_person,
  public.rpc_dashboard_stats from public;
grant execute on function public.rpc_list_people, public.rpc_get_contact_detail,
  public.rpc_add_person, public.rpc_update_person, public.rpc_delete_person,
  public.rpc_dashboard_stats to authenticated;
