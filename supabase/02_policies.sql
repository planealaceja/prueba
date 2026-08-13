-- =========================================================================
--  POLÍTICAS DE SEGURIDAD (Row Level Security)
--  Principio: el rol "anon" (mapa público) SOLO ve agregados por sector.
--  Nunca ve una fila individual de "people" ni nada de "people_contact".
--  Los admins tampoco leen "people" ni "people_contact" directo: todo pasa
--  por funciones RPC que registran el acceso en audit_log (ver 03_functions.sql).
-- =========================================================================

alter table public.profiles       enable row level security;
alter table public.sectors        enable row level security;
alter table public.people         enable row level security;
alter table public.people_contact enable row level security;
alter table public.audit_log      enable row level security;

-- ---- profiles --------------------------------------------------------
-- Cada funcionario puede ver su propio perfil. Solo superadmin ve todos.
create policy profiles_self_select on public.profiles
  for select using (
    id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin')
  );

create policy profiles_superadmin_write on public.profiles
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin')
  );

-- ---- sectors -----------------------------------------------------------
-- Público: lectura libre (son polígonos de barrios/veredas, no datos personales).
create policy sectors_public_read on public.sectors
  for select using (true);

-- Solo admins autenticados pueden modificar las capas geográficas.
create policy sectors_admin_write on public.sectors
  for insert with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.activo)
  );
create policy sectors_admin_update on public.sectors
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.activo)
  );
create policy sectors_admin_delete on public.sectors
  for delete using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.activo)
  );

-- ---- people --------------------------------------------------------------
-- IMPORTANTE: no se crea ninguna política de SELECT para "anon" ni para
-- "authenticated" sobre esta tabla. El mapa público NUNCA consulta esta
-- tabla directamente: consume la vista agregada "public_sector_counts"
-- (ver 03_functions.sql), que no tiene filas por persona, solo conteos.
--
-- Los admins tampoco reciben SELECT directo aquí: usan la función
-- rpc_list_people(), que aplica el mismo filtro pero además registra
-- auditoría y puede paginarse/limitarse.
create policy people_admin_insert on public.people
  for insert with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.activo)
  );
create policy people_admin_update on public.people
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.activo)
  );
create policy people_admin_delete on public.people
  for delete using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.activo)
  );
-- (Sin policy de SELECT deliberadamente. Ver funciones RPC con SECURITY DEFINER.)

-- ---- people_contact --------------------------------------------------------
-- Sin políticas de SELECT en absoluto para ningún rol de base de datos.
-- El único camino de lectura es rpc_get_contact_detail(), que exige
-- 'motivo' (justificación) y escribe en audit_log antes de responder.
create policy people_contact_admin_insert on public.people_contact
  for insert with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.activo)
  );
create policy people_contact_admin_update on public.people_contact
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.activo)
  );
create policy people_contact_admin_delete on public.people_contact
  for delete using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.activo)
  );

-- ---- audit_log --------------------------------------------------------
-- Solo superadmin puede leer la bitácora completa (control de control).
create policy audit_superadmin_read on public.audit_log
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin')
  );
-- Inserciones solo vía funciones SECURITY DEFINER (no directo desde el cliente).
create policy audit_no_direct_insert on public.audit_log
  for insert with check (false);
