# Atlas de Equidad

Aplicativo web (móvil + escritorio) para la caracterización territorial
**agregada** de la comunidad LGBTIQ+ del municipio, orientado a apoyar la
política pública de la Secretaría de Equidad de Género — **sin exponer
ubicaciones ni datos individuales en el mapa público.**

- **Mapa público** (`public/index.html`): coropletas por sector/vereda,
  capas encendibles (barrios, veredas, vías, zonas), leyenda, popup con
  conteo agregado por sector.
- **Panel administrativo** (`public/admin.html`): login restringido,
  dashboard con estadísticas, mini-mapa, gestión de personas (agregar,
  editar, eliminar) con consentimiento obligatorio y auditoría, gestión de
  capas geográficas (importación de GeoJSON).
- **Backend**: Supabase (Postgres + PostGIS + Auth), con seguridad a nivel
  de fila (RLS) y funciones auditadas para todo acceso a datos sensibles.

## Por qué está diseñado así (léelo antes de personalizar)

El sistema **no guarda direcciones exactas ni coordenadas de vivienda de
ninguna persona**, y el mapa público **nunca** muestra un punto o pin
individual — solo el color de un sector según cuántas personas hay
caracterizadas ahí. Esto es intencional: protege a la comunidad de los
riesgos de exposición, filtración o uso indebido de datos tan sensibles
como la orientación sexual asociada a una dirección. Antes de modificar
este comportamiento, consulta la sección **Consideraciones legales**.

---

## 1. Estructura del proyecto

```
orbit-equidad/
├── public/                  → el sitio web (súbelo tal cual a hosting estático)
│   ├── index.html            → mapa público
│   ├── admin.html            → panel administrativo
│   ├── css/styles.css
│   └── js/
│       ├── config.js          → EDITA aquí tus claves de Supabase
│       ├── map-public.js
│       └── admin.js
├── supabase/                → ejecuta estos scripts en el SQL Editor de Supabase, EN ORDEN
│   ├── 01_schema.sql
│   ├── 02_policies.sql
│   ├── 03_functions.sql
│   └── 04_primer_admin.sql
├── data/
│   └── sectores_ejemplo.geojson   → formato de referencia para tus capas reales
└── docs/
    ├── aviso_de_privacidad.md
    └── formato_consentimiento_informado.md
```

## 2. Crear el proyecto en Supabase

1. Ve a [supabase.com](https://supabase.com) → **New project**. Elige una
   contraseña segura para la base de datos y una región cercana a Colombia
   (ej. `sa-east-1`, São Paulo).
2. Una vez creado, entra a **SQL Editor** y ejecuta, en este orden exacto,
   pegando el contenido completo de cada archivo:
   - `supabase/01_schema.sql`
   - `supabase/02_policies.sql`
   - `supabase/03_functions.sql`
3. Ve a **Authentication → Providers** y deja habilitado solo **Email**.
   **Desactiva** "Allow new users to sign up" — las cuentas del panel
   administrativo se crean manualmente por el superadministrador, nunca por
   registro público.
4. Ve a **Authentication → Users → Add user**, crea la cuenta del primer
   funcionario (correo institucional + contraseña temporal).
5. Copia el UUID de ese usuario, pégalo en `supabase/04_primer_admin.sql` y
   ejecútalo en el SQL Editor. Ese usuario queda como `superadmin`.
6. En **Project Settings → API**, copia:
   - `Project URL` → pégalo en `public/js/config.js` como `SUPABASE_URL`
   - `anon public key` → pégalo como `SUPABASE_ANON_KEY`
   - **Nunca** copies ni uses la `service_role key` en el frontend.

## 3. Cargar tus capas geográficas (barrios, veredas, vías)

Tienes dos caminos:

**A. Desde el panel administrativo (recomendado para empezar):**
Inicia sesión → pestaña **Sectores y capas** → sube tu archivo `.geojson`
(uno por tipo: barrios, veredas, vías...) → selecciona el tipo → Importar.
Cada *feature* debe tener `properties.nombre`; si no tiene
`properties.tipo`, se usa el tipo que selecciones en el formulario.

**B. Para archivos grandes o geometrías complejas (recomendado en
producción):** usa [`ogr2ogr`](https://gdal.org) para cargar directo a
Postgres, respetando la tabla `public.sectors` y el SRID 4326:

```bash
ogr2ogr -f PostgreSQL "PG:host=db.TU-PROYECTO.supabase.co user=postgres dbname=postgres password=TU_PASSWORD" \
  barrios.geojson -nln sectors_staging -nlt PROMOTE_TO_MULTI

-- luego, en el SQL Editor, migra desde la tabla staging a "sectors"
-- asignando nombre/tipo desde tus propias columnas.
```

El formato esperado de tus GeoJSON está ilustrado en
`data/sectores_ejemplo.geojson`.

## 4. Publicar el sitio

`public/` es un sitio 100% estático (HTML/CSS/JS, sin build step). Puedes
subirlo tal cual a:

- **Netlify / Vercel**: arrastra la carpeta `public/` o conéctala a un
  repositorio Git (carpeta raíz de publicación = `public`).
- **Supabase Hosting / cualquier hosting estático / servidor propio de la
  Alcaldía.**

No necesitas Node.js, ni build, ni backend propio: todo el backend es
Supabase.

## 5. Responsive / móvil

El diseño usa `dvh`/`vw`, flexbox y un menú tipo *burger* por debajo de
900px de ancho (`public/css/styles.css`, sección `@media`). Pruébalo en
Chrome DevTools en modo dispositivo antes de publicar, y ajusta
`MAPA_ZOOM` en `config.js` según el tamaño de tu municipio.

## 6. Cómo funciona la seguridad (resumen técnico)

| Capa | Quién accede | Cómo |
|---|---|---|
| `public_sector_counts` (vista agregada) | Público (`anon`) | `SELECT` directo — solo conteos por sector, sin filas de personas |
| `sectors` (polígonos) | Público (lectura) / Admins (escritura) | RLS: `select` abierto, `insert/update/delete` solo con perfil activo |
| `people` (caracterización) | Solo admins autenticados | **Sin política de SELECT.** Todo acceso pasa por `rpc_list_people`, `rpc_add_person`, `rpc_update_person`, `rpc_delete_person` (SECURITY DEFINER + `audit_log`) |
| `people_contact` (nombre/teléfono) | Solo admins, con motivo obligatorio | `rpc_get_contact_detail(id, motivo)` — exige justificación y se audita |
| `audit_log` | Solo `superadmin` | Bitácora inmutable; nadie puede editarla ni borrarla, ni siquiera un admin |

Esto significa que, aunque alguien obtenga la `anon key` pública (que
viaja en el navegador de cualquier visitante, como en cualquier app web),
**no puede leer una sola fila de personas**: la tabla no tiene política de
lectura pública ni para usuarios autenticados regulares.

## 7. Consideraciones legales (Colombia)

- La orientación sexual y la identidad de género son **datos sensibles**
  bajo el artículo 5 de la Ley 1581 de 2012: requieren consentimiento
  **previo, expreso e informado**, y está prohibido condicionar cualquier
  servicio a su entrega.
- Usa el `docs/formato_consentimiento_informado.md` en cada registro y
  entrega el `docs/aviso_de_privacidad.md` (ajustado por tu oficina
  jurídica) a cada persona.
- El sistema **exige marcar el consentimiento** antes de guardar un
  registro (`rpc_add_person` rechaza la inserción si `consentimiento =
  false`), pero esto es un control técnico de apoyo — el proceso humano de
  informar y obtener el consentimiento real sigue siendo responsabilidad
  del funcionario.
- Antes de salir a producción, te recomendamos:
  1. Registrar la base de datos ante la SIC si aplica según el volumen de
     datos que manejará la entidad.
  2. Definir internamente quién tiene rol `admin_equidad` vs
     `superadmin`, y revisarlo periódicamente.
  3. Establecer un protocolo de qué pasa con los datos de una persona que
     pide ser eliminada (usa `rpc_delete_person`, que sí borra el registro
     por completo, incluyendo su contacto en cascada).
  4. No agregar nunca un campo de dirección exacta o coordenadas
     individuales a la tabla `people` — el diseño agregado por sector es
     la protección principal de este sistema.

## 8. Próximos pasos sugeridos (opcionales)

- Exportes en PDF/Excel de los reportes del dashboard para informes
  oficiales.
- Notificaciones internas cuando se registra un caso en "riesgo".
- Roles adicionales (ej. solo lectura para enlaces territoriales).
- Autenticación de doble factor para el panel (Supabase Auth lo soporta
  de forma nativa si la entidad lo requiere).

Si quieres que construyamos cualquiera de estos siguientes pasos, o que
ajustemos colores/tipografía a la identidad visual oficial de la Alcaldía,
dímelo y lo desarrollamos sobre esta misma base.
