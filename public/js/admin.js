// =============================================================================
// PANEL ADMINISTRATIVO — Atlas de Equidad
// Todo acceso a datos de personas pasa por funciones RPC auditadas
// (ver supabase/03_functions.sql). Este archivo nunca hace
// sb.from('people').select() directo: eso está bloqueado por RLS a propósito.
// =============================================================================

const { createClient } = supabase;
const sb = createClient(window.ATLAS_CONFIG.SUPABASE_URL, window.ATLAS_CONFIG.SUPABASE_ANON_KEY);

let currentProfile = null;
let sectorsCache = [];
let peoplePage = 0;
const PAGE_SIZE = 12;
let pendingMotivoAction = null; // función a ejecutar tras confirmar el motivo

// ------------------------------------------------------------------ AUTH ---
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPass').value;
  const msg = document.getElementById('loginMsg');
  msg.textContent = 'Verificando...'; msg.className = 'form-msg';

  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error){
    msg.textContent = 'Credenciales inválidas o cuenta no autorizada.';
    msg.className = 'form-msg error';
    return;
  }
  await boot();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.reload();
});

async function boot(){
  const { data: { session } } = await sb.auth.getSession();
  if (!session){ showLogin(); return; }

  const { data: profile, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (error || !profile || !profile.activo){
    document.getElementById('loginMsg').textContent = 'Tu cuenta no tiene un perfil administrativo activo. Contacta al superadministrador.';
    document.getElementById('loginMsg').className = 'form-msg error';
    await sb.auth.signOut();
    showLogin();
    return;
  }

  currentProfile = profile;
  document.getElementById('userLabel').textContent = `${profile.nombre} · ${profile.role === 'superadmin' ? 'Superadmin' : 'Admin'}`;
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminShell').style.display = 'flex';

  await loadSectorsForForms();
  await loadDashboard();
  initMiniMap();
  wireTabs();
  wirePersonModal();
  wireMotivoModal();
  await loadPeople();
  await loadSectorsTable();
  if (profile.role === 'superadmin') await loadAudit();
}

function showLogin(){
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('adminShell').style.display = 'none';
}

// ------------------------------------------------------------------ TABS ---
function wireTabs(){
  document.querySelectorAll('.side-nav button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.side-nav button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.admin-main > section').forEach(s => s.style.display = 'none');
      document.getElementById('tab-' + btn.dataset.tab).style.display = 'block';
      if (btn.dataset.tab === 'auditoria' && currentProfile.role === 'superadmin') loadAudit();
    });
  });
}

// --------------------------------------------------------------- DASHBOARD --
async function loadDashboard(){
  const { data, error } = await sb.rpc('rpc_dashboard_stats');
  if (error || !data || !data[0]){ return; }
  const s = data[0];
  document.getElementById('statTotal').textContent = s.total_personas;
  document.getElementById('statSectores').textContent = s.total_sectores_con_registro;
  document.getElementById('statRiesgo').textContent = s.total_riesgo;
  document.getElementById('statSemana').textContent = s.registros_ultimos_7_dias;
}

function initMiniMap(){
  const miniMap = L.map('miniMap', { zoomControl: false, attributionControl: false })
    .setView(window.ATLAS_CONFIG.MAPA_CENTRO, window.ATLAS_CONFIG.MAPA_ZOOM - 1);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', { subdomains: 'abcd' }).addTo(miniMap);

  sb.from('public_sector_counts').select('*').then(({ data }) => {
    if (!data) return;
    const max = Math.max(1, ...data.map(d => d.total_personas));
    data.forEach(s => {
      if (!s.geom || s.geom.type === 'LineString') return;
      L.geoJSON(s.geom, {
        style: () => ({
          fillColor: s.total_personas ? '#8b5fc9' : '#23263a',
          fillOpacity: .3 + .5 * (s.total_personas / max),
          color: 'rgba(255,255,255,.15)', weight: 1
        })
      }).bindTooltip(`${s.sector_nombre}: ${s.total_personas}`).addTo(miniMap);
    });
  });
}

// ----------------------------------------------------------------- PEOPLE --
async function loadSectorsForForms(){
  const { data } = await sb.from('sectors').select('id,nombre,tipo').order('nombre');
  sectorsCache = data || [];
  const sel = document.getElementById('pSector');
  const filterSel = document.getElementById('filterSector');
  sel.innerHTML = sectorsCache.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
  filterSel.innerHTML = '<option value="">Todos los sectores</option>' +
    sectorsCache.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
}

async function loadPeople(){
  const sectorFilter = document.getElementById('filterSector').value || null;
  const { data, error } = await sb.rpc('rpc_list_people', {
    p_sector_id: sectorFilter, p_limit: PAGE_SIZE, p_offset: peoplePage * PAGE_SIZE
  });
  const tbody = document.getElementById('peopleTbody');
  if (error){ tbody.innerHTML = `<tr><td colspan="7">Error: ${error.message}</td></tr>`; return; }
  if (!data || !data.length){
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--ink-faint)">Sin registros en esta página.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map(p => {
    const sector = sectorsCache.find(s => s.id === p.sector_id);
    return `
      <tr>
        <td class="mono">${p.codigo_referencia}</td>
        <td>${sector ? sector.nombre : '—'}</td>
        <td>${p.rango_edad || '—'}</td>
        <td>${p.identidad_genero || '—'}</td>
        <td>${p.en_situacion_riesgo ? '<span class="badge risk">Riesgo</span>' : '<span class="badge ok">Estable</span>'}</td>
        <td>${new Date(p.fecha_registro).toLocaleDateString('es-CO')}</td>
        <td class="row-actions">
          <button class="icon-btn" title="Ver contacto" data-action="contact" data-id="${p.id}">👁</button>
          <button class="icon-btn" title="Editar" data-action="edit" data-id="${p.id}">✎</button>
          <button class="icon-btn danger" title="Eliminar" data-action="delete" data-id="${p.id}">🗑</button>
        </td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handlePersonAction(btn.dataset.action, btn.dataset.id, data));
  });
}

document.getElementById('filterSector').addEventListener('change', () => { peoplePage = 0; loadPeople(); });
document.getElementById('prevPage').addEventListener('click', () => { if (peoplePage>0){ peoplePage--; loadPeople(); } });
document.getElementById('nextPage').addEventListener('click', () => { peoplePage++; loadPeople(); });

function handlePersonAction(action, id, currentData){
  const person = currentData.find(p => p.id === id);
  if (action === 'edit') openPersonModal(person);
  if (action === 'delete'){
    openMotivo('Eliminar registro', async (motivo) => {
      const { error } = await sb.rpc('rpc_delete_person', { p_person_id: id, p_motivo: motivo });
      if (!error){ loadPeople(); loadDashboard(); }
      else alert('Error: ' + error.message);
    });
  }
  if (action === 'contact'){
    openMotivo('Consultar datos de contacto', async (motivo) => {
      const { data, error } = await sb.rpc('rpc_get_contact_detail', { p_person_id: id, p_motivo: motivo });
      if (error){ alert('Error: ' + error.message); return; }
      alert(data
        ? `Nombre: ${data.nombre_completo || '—'}\nTeléfono: ${data.telefono || '—'}\nCorreo: ${data.correo || '—'}\nReferencia de ubicación: ${data.barrio_aprox || '—'}`
        : 'Esta persona no tiene datos de contacto registrados.');
    });
  }
}

// ------------------------------------------------------------ PERSON MODAL --
function wirePersonModal(){
  document.getElementById('openAddPerson').addEventListener('click', () => openPersonModal(null));
  document.getElementById('cancelPersonModal').addEventListener('click', closePersonModal);

  document.getElementById('personForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('personFormMsg');
    const necesidades = document.getElementById('pNecesidades').value
      .split(',').map(s => s.trim()).filter(Boolean);

    const payload = {
      p_sector_id: document.getElementById('pSector').value,
      p_rango_edad: document.getElementById('pEdad').value || null,
      p_identidad_genero: document.getElementById('pIdentidad').value || null,
      p_orientacion_sexual: document.getElementById('pOrientacion').value || null,
      p_necesidades: necesidades,
      p_en_riesgo: document.getElementById('pRiesgo').checked,
      p_consentimiento: document.getElementById('pConsentimiento').checked,
      p_fuente: 'presencial',
      p_contacto_nombre: document.getElementById('pNombre').value || null,
      p_contacto_telefono: document.getElementById('pTelefono').value || null,
      p_contacto_correo: document.getElementById('pCorreo').value || null,
      p_contacto_barrio_aprox: document.getElementById('pBarrioAprox').value || null,
    };

    const existingId = document.getElementById('personId').value;

    if (existingId){
      openMotivo('Justificar edición', async (motivo) => {
        const { error } = await sb.rpc('rpc_update_person', {
          p_person_id: existingId, p_sector_id: payload.p_sector_id, p_rango_edad: payload.p_rango_edad,
          p_identidad_genero: payload.p_identidad_genero, p_orientacion_sexual: payload.p_orientacion_sexual,
          p_necesidades: payload.p_necesidades, p_en_riesgo: payload.p_en_riesgo, p_motivo: motivo
        });
        if (error){ msg.textContent = error.message; msg.className='form-msg error'; return; }
        closePersonModal(); loadPeople(); loadDashboard();
      });
      return;
    }

    if (!payload.p_consentimiento){
      msg.textContent = 'Debes confirmar el consentimiento informado para guardar.';
      msg.className = 'form-msg error';
      return;
    }
    const { error } = await sb.rpc('rpc_add_person', payload);
    if (error){ msg.textContent = error.message; msg.className='form-msg error'; return; }
    msg.textContent = 'Registro guardado.'; msg.className = 'form-msg ok';
    setTimeout(() => { closePersonModal(); loadPeople(); loadDashboard(); }, 500);
  });
}

function openPersonModal(person){
  document.getElementById('personModalTitle').textContent = person ? 'Editar persona' : 'Agregar persona';
  document.getElementById('personForm').reset();
  document.getElementById('personId').value = person ? person.id : '';
  document.getElementById('personFormMsg').textContent = '';
  if (person){
    document.getElementById('pSector').value = person.sector_id;
    document.getElementById('pEdad').value = person.rango_edad || '';
    document.getElementById('pIdentidad').value = person.identidad_genero || '';
    document.getElementById('pOrientacion').value = person.orientacion_sexual || '';
    document.getElementById('pNecesidades').value = (person.necesidades || []).join(', ');
    document.getElementById('pRiesgo').checked = !!person.en_situacion_riesgo;
    document.getElementById('pConsentimiento').checked = true;
    document.getElementById('pConsentimiento').disabled = true;
  } else {
    document.getElementById('pConsentimiento').disabled = false;
  }
  document.getElementById('personModal').style.display = 'flex';
}
function closePersonModal(){ document.getElementById('personModal').style.display = 'none'; }

// ------------------------------------------------------------ MOTIVO MODAL --
function wireMotivoModal(){
  document.getElementById('cancelMotivo').addEventListener('click', () => {
    document.getElementById('motivoModal').style.display = 'none';
    pendingMotivoAction = null;
  });
  document.getElementById('confirmMotivo').addEventListener('click', async () => {
    const motivo = document.getElementById('motivoInput').value.trim();
    if (motivo.length < 5){ alert('Escribe un motivo de al menos 5 caracteres.'); return; }
    document.getElementById('motivoModal').style.display = 'none';
    if (pendingMotivoAction) await pendingMotivoAction(motivo);
    pendingMotivoAction = null;
  });
}
function openMotivo(title, action){
  document.getElementById('motivoTitle').textContent = title;
  document.getElementById('motivoInput').value = '';
  pendingMotivoAction = action;
  document.getElementById('motivoModal').style.display = 'flex';
}

// ---------------------------------------------------------------- SECTORES --
async function loadSectorsTable(){
  const { data } = await sb.from('sectors').select('*').order('tipo,nombre');
  const tbody = document.getElementById('sectorsTbody');
  if (!data || !data.length){
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--ink-faint)">Aún no has importado ninguna capa.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map(s => `
    <tr>
      <td>${s.nombre}</td><td>${s.tipo}</td><td class="mono">${s.codigo || '—'}</td>
      <td><button class="icon-btn danger" data-del="${s.id}" title="Eliminar">🗑</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este sector? Si tiene personas asociadas, no se podrá borrar.')) return;
      const { error } = await sb.from('sectors').delete().eq('id', btn.dataset.del);
      if (error) alert('No se pudo eliminar: ' + error.message);
      loadSectorsTable(); loadSectorsForForms();
    });
  });
}

document.getElementById('importGeojsonBtn').addEventListener('click', async () => {
  const fileInput = document.getElementById('geojsonFile');
  const msg = document.getElementById('importMsg');
  if (!fileInput.files.length){ msg.textContent = 'Selecciona un archivo primero.'; msg.className='form-msg error'; return; }

  const defaultTipo = document.getElementById('geojsonTipo').value;
  const text = await fileInput.files[0].text();
  let geo;
  try { geo = JSON.parse(text); } catch { msg.textContent = 'El archivo no es JSON válido.'; msg.className='form-msg error'; return; }

  const features = geo.type === 'FeatureCollection' ? geo.features : [geo];
  const rows = features.map(f => ({
    nombre: f.properties?.nombre || 'Sin nombre',
    tipo: f.properties?.tipo || defaultTipo,
    codigo: f.properties?.codigo || null,
    geom: `SRID=4326;${geojsonToWKT(f.geometry)}`
  }));

  msg.textContent = `Importando ${rows.length} elemento(s)...`; msg.className = 'form-msg';
  const { error } = await sb.from('sectors').insert(rows);
  if (error){ msg.textContent = 'Error: ' + error.message; msg.className = 'form-msg error'; return; }
  msg.textContent = `${rows.length} elemento(s) importado(s) correctamente.`; msg.className = 'form-msg ok';
  fileInput.value = '';
  loadSectorsTable(); loadSectorsForForms();
});

// Conversión mínima GeoJSON → WKT para Polygon/MultiPolygon/LineString.
// Para geometrías complejas o archivos grandes, se recomienda usar
// ogr2ogr / el importador de Supabase (ver README, sección "Importar capas").
function geojsonToWKT(geometry){
  const ring = (coords) => coords.map(c => `${c[0]} ${c[1]}`).join(', ');
  if (geometry.type === 'Polygon'){
    return `POLYGON(${geometry.coordinates.map(r => `(${ring(r)})`).join(', ')})`;
  }
  if (geometry.type === 'MultiPolygon'){
    return `MULTIPOLYGON(${geometry.coordinates.map(poly => `(${poly.map(r => `(${ring(r)})`).join(', ')})`).join(', ')})`;
  }
  if (geometry.type === 'LineString'){
    return `LINESTRING(${ring(geometry.coordinates)})`;
  }
  throw new Error('Tipo de geometría no soportado: ' + geometry.type);
}

// ----------------------------------------------------------------- AUDIT ---
async function loadAudit(){
  const { data, error } = await sb.from('audit_log').select('*').order('creado_en', { ascending: false }).limit(100);
  const tbody = document.getElementById('auditTbody');
  if (error || !data){
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--ink-faint)">No tienes permisos para ver la bitácora.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map(a => `
    <tr>
      <td>${new Date(a.creado_en).toLocaleString('es-CO')}</td>
      <td><span class="badge">${a.accion}</span></td>
      <td>${a.tabla}</td>
      <td>${a.motivo || '—'}</td>
    </tr>`).join('');
}

// ------------------------------------------------------------------ INIT ---
boot();
