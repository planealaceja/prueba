// =============================================================================
// MAPA PÚBLICO — Atlas de Equidad
// Consume ÚNICAMENTE la vista agregada "public_sector_counts": nunca recibe
// filas individuales de personas. El "punto" nunca aparece en este mapa,
// solo el sector coloreado según densidad de registros.
// =============================================================================

const { createClient } = supabase;
const sb = createClient(window.ATLAS_CONFIG.SUPABASE_URL, window.ATLAS_CONFIG.SUPABASE_ANON_KEY);

const map = L.map('map', { zoomControl: false, attributionControl: false })
  .setView(window.ATLAS_CONFIG.MAPA_CENTRO, window.ATLAS_CONFIG.MAPA_ZOOM);

L.control.zoom({ position: 'bottomright' }).addTo(map);
L.control.attribution({ position: 'bottomright', prefix: false })
  .addAttribution('© OpenStreetMap contributors')
  .addTo(map);

// Basemap oscuro y discreto para que el color de los sectores sea protagonista.
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
  maxZoom: 19,
  subdomains: 'abcd'
}).addTo(map);

// --- escala de calor propia (no confundir con el degradado de marca) --------
const HEAT_STOPS = ['#23263a', '#3a3d68', '#5b53a8', '#8b5fc9', '#ff7aa8'];

function heatColor(count, max){
  if (!max || count === 0) return HEAT_STOPS[0];
  const t = Math.min(count / max, 1);
  const idx = t * (HEAT_STOPS.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return HEAT_STOPS[lo];
  return mixHex(HEAT_STOPS[lo], HEAT_STOPS[hi], idx - lo);
}
function mixHex(a, b, t){
  const pa = hexToRgb(a), pb = hexToRgb(b);
  const r = Math.round(pa.r + (pb.r - pa.r) * t);
  const g = Math.round(pa.g + (pb.g - pa.g) * t);
  const bl = Math.round(pa.b + (pb.b - pa.b) * t);
  return `rgb(${r},${g},${bl})`;
}
function hexToRgb(hex){
  const v = hex.replace('#','');
  return { r: parseInt(v.substr(0,2),16), g: parseInt(v.substr(2,2),16), b: parseInt(v.substr(4,2),16) };
}

const layerGroups = { barrio: L.layerGroup(), vereda: L.layerGroup(), via: L.layerGroup(), zona: L.layerGroup(), otro: L.layerGroup() };
const TYPE_LABEL = { barrio: 'Barrios', vereda: 'Veredas', via: 'Vías principales', zona: 'Zonas de interés', otro: 'Otros' };

let totalPersonas = 0;

async function loadSectors(){
  const { data, error } = await sb.from('public_sector_counts').select('*');
  if (error){
    console.error(error);
    document.getElementById('statNum').textContent = '—';
    document.getElementById('statLabel').textContent = 'No se pudo cargar la información del mapa.';
    return;
  }

  const maxCount = Math.max(1, ...data.map(d => d.total_personas));
  totalPersonas = data.reduce((acc, d) => acc + Number(d.total_personas), 0);
  document.getElementById('statNum').textContent = totalPersonas;

  const legendPanel = document.getElementById('layerList');
  legendPanel.innerHTML = '';
  const typesPresent = [...new Set(data.map(d => d.sector_tipo))];

  typesPresent.forEach(tipo => {
    const item = document.createElement('label');
    item.className = 'layer-item active';
    item.innerHTML = `
      <input type="checkbox" checked data-tipo="${tipo}">
      <span class="layer-swatch" style="background:${HEAT_STOPS[3]}"></span>
      <span>${TYPE_LABEL[tipo] || tipo}</span>`;
    legendPanel.appendChild(item);
  });

  legendPanel.querySelectorAll('input[type=checkbox]').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const tipo = e.target.dataset.tipo;
      const group = layerGroups[tipo];
      if (!group) return;
      if (e.target.checked) map.addLayer(group); else map.removeLayer(group);
      e.target.closest('.layer-item').classList.toggle('active', e.target.checked);
    });
  });

  data.forEach(sector => {
    if (!sector.geom) return;
    const geojson = parsePostGIS(sector.geom);
    if (!geojson) return;

    const isLine = geojson.type === 'LineString' || geojson.type === 'MultiLineString';
    const style = isLine
      ? { color: '#ffc861', weight: 3, opacity: .85 }
      : {
          fillColor: heatColor(sector.total_personas, maxCount),
          fillOpacity: .68,
          color: 'rgba(255,255,255,.18)',
          weight: 1
        };

    const layer = L.geoJSON(geojson, {
      style: () => style,
      onEachFeature: (feat, lyr) => {
        if (isLine){
          lyr.bindPopup(`<div class="sector-popup"><h4>${sector.sector_nombre}</h4><span class="tag">Vía</span></div>`);
          return;
        }
        lyr.on('mouseover', () => lyr.setStyle({ fillOpacity: .88, weight: 2, color: '#fff' }));
        lyr.on('mouseout', () => lyr.setStyle(style));
        lyr.bindPopup(popupHTML(sector), { className: 'sector-popup-wrap' });
      }
    });

    const group = layerGroups[sector.sector_tipo] || layerGroups.otro;
    layer.addTo(group);
  });

  Object.values(layerGroups).forEach(g => g.addTo(map));
}

function popupHTML(sector){
  const riskNote = sector.total_riesgo > 0
    ? `<div class="risk-note">${sector.total_riesgo} caso(s) señalados en situación de riesgo</div>`
    : '';
  return `
    <div class="sector-popup">
      <span class="tag">${TYPE_LABEL[sector.sector_tipo] || sector.sector_tipo}</span>
      <h4>${sector.sector_nombre}</h4>
      <div class="count">${sector.total_personas}</div>
      <div class="count-label">persona(s) caracterizada(s) en este sector</div>
      ${riskNote}
    </div>`;
}

// PostGIS vía PostgREST puede devolver geometría en GeoJSON si se castea con
// ST_AsGeoJSON en la vista, o como WKB hex si no. Aquí soportamos ambos:
// para producción recomendamos exponer la vista con geom en GeoJSON (ver README).
function parsePostGIS(geom){
  if (typeof geom === 'object') return geom; // ya viene como GeoJSON
  try { return JSON.parse(geom); } catch { return null; }
}

loadSectors();
