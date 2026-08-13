-- =========================================================================
--  ATLAS DE EQUIDAD — Esquema de base de datos (Supabase / PostgreSQL + PostGIS)
--  Diseño: privacidad por defecto, minimización de datos, acceso auditado.
--  NO se almacenan coordenadas exactas ni direcciones de vivienda de las
--  personas. La ubicación se maneja únicamente a nivel de SECTOR/VEREDA
--  (polígono), nunca a nivel de punto individual.
-- =========================================================================

-- 1. EXTENSIONES ----------------------------------------------------------
create extension if not exists postgis;
create extension if not exists pgcrypto;   -- para gen_random_uuid() y cifrado opcional

-- 2. PERFILES / ROLES -------------------------------------------------------
-- Vinculado 1:1 con auth.users de Supabase. Controla quién puede operar
-- el panel administrativo. Solo 'superadmin' puede crear otros admins.
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  nombre        text not null,
  cargo         text,                                   -- p.ej. "Secretaría de Equidad de Género"
  role          text not null default 'admin_equidad'
                  check (role in ('admin_equidad', 'superadmin')),
  activo        boolean not null default true,
  created_at    timestamptz not null default now()
);

comment on table public.profiles is
  'Funcionarios autorizados a operar el panel administrativo. El rol determina permisos.';

-- 3. SECTORES / VEREDAS / CAPAS GEOGRÁFICAS --------------------------------
-- Aquí van los polígonos y líneas que subes en GeoJSON: barrios, veredas,
-- vías principales, zonas de interés. Es información pública (no sensible).
create table if not exists public.sectors (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  tipo          text not null check (tipo in ('barrio', 'vereda', 'zona', 'via', 'otro')),
  codigo        text,                                    -- código catastral/DANE si aplica
  geom          geometry(Geometry, 4326) not null,        -- Polygon, MultiPolygon o LineString
  color_layer   text default '#29C7AC',                   -- color sugerido para la capa en el mapa
  visible_por_defecto boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists sectors_geom_idx on public.sectors using gist (geom);
create index if not exists sectors_tipo_idx on public.sectors (tipo);

comment on table public.sectors is
  'Capas geográficas del municipio (barrios, veredas, vías, zonas). Dato público, no identifica personas.';

-- 4. PERSONAS — CARACTERIZACIÓN (sin datos identificables) ----------------
-- Esta tabla es la que alimenta las estadísticas y el mapa de calor.
-- Deliberadamente NO contiene nombre, documento, teléfono ni dirección.
create table if not exists public.people (
  id                    uuid primary key default gen_random_uuid(),
  codigo_referencia      text not null unique default ('REF-' || substr(gen_random_uuid()::text, 1, 8)),
  sector_id              uuid not null references public.sectors(id) on delete restrict,
  rango_edad             text check (rango_edad in ('13-17','18-25','26-35','36-45','46-59','60+')),
  identidad_genero       text,        -- texto libre, capturado tal como la persona se autoidentifica
  orientacion_sexual     text,        -- texto libre, autoidentificación (dato sensible, ver políticas)
  necesidades            text[],      -- ej. {'salud','vivienda','empleo','seguridad','educacion'}
  en_situacion_riesgo    boolean not null default false,
  consentimiento_informado boolean not null default false,
  fecha_consentimiento   timestamptz,
  fuente_registro        text default 'presencial' check (fuente_registro in ('presencial','autoregistro','jornada','remision')),
  fecha_registro         timestamptz not null default now(),
  registrado_por         uuid references public.profiles(id),
  actualizado_en         timestamptz not null default now()
);

create index if not exists people_sector_idx on public.people (sector_id);

comment on table public.people is
  'Caracterización agregable de personas. Sin nombre, documento, teléfono ni dirección exacta.';

-- 5. DATOS DE CONTACTO — TABLA SEPARADA Y AISLADA --------------------------
-- Únicamente si la persona autoriza dejar datos de contacto para
-- seguimiento (ej. rutas de atención). Vive separada de "people" a
-- propósito: ningún JOIN automático, solo vía función auditada (sección 8).
create table if not exists public.people_contact (
  person_id       uuid primary key references public.people(id) on delete cascade,
  nombre_completo text,
  telefono        text,
  correo          text,
  barrio_aprox    text,     -- referencia textual libre (NO dirección exacta, NO coordenadas)
  notas           text,
  updated_at      timestamptz not null default now()
);

comment on table public.people_contact is
  'Datos identificables opcionales. Acceso exclusivamente vía funciones auditadas (ver 08_functions.sql).';

-- 6. BITÁCORA DE AUDITORÍA -------------------------------------------------
create table if not exists public.audit_log (
  id            bigint generated always as identity primary key,
  actor_id      uuid references public.profiles(id),
  accion        text not null,              -- 'CREATE' | 'READ_DETAIL' | 'UPDATE' | 'DELETE'
  tabla         text not null,
  registro_id   uuid,
  motivo        text,                       -- justificación opcional del acceso
  ip_origen     text,
  creado_en     timestamptz not null default now()
);

comment on table public.audit_log is
  'Registro inmutable de toda operación de creación, consulta detallada, edición o borrado sobre datos de personas.';

-- Nadie puede editar ni borrar la bitácora, ni siquiera los admins.
revoke update, delete on public.audit_log from public, authenticated, anon;
