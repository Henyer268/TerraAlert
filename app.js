/* ═══════════════════════════════════════════
   terraALERT — app.js
   Frontend conectado al backend FastAPI
   ═══════════════════════════════════════════ */

/* ─── SKIP INTRO SI YA FUE VISTO O VIENE DE OAUTH ── */
const _vieneDeOAuth = window.location.hash.includes('access_token') ||
                      window.location.search.includes('code=');

if (sessionStorage.getItem('introVisto') || _vieneDeOAuth) {
  document.getElementById('intro-overlay').style.display = 'none';
  document.getElementById('app').classList.remove('hidden');
  // NO limpiar la URL aquí — Supabase necesita leer el hash/code primero
}

/* ─── CONFIG ──────────────────────────────── */
const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://127.0.0.1:8000'
  : 'https://terraalert-t7t5.onrender.com';

/* ─── SUPABASE ───────────────────────────────── */
const SUPABASE_URL = 'https://oajhwwplkmwdwljokhvk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hamh3d3Bsa213ZHdsam9raHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NDcxMjcsImV4cCI6MjA5NjQyMzEyN30.M7msv2z_hgpYfjcH0JdWkPUb3olKv66cr7YyJ_fQIqo';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let sessionReady = false;
let userPreferences = { umbral_magnitud: 5.0, ciudad: '', zona_interes: '' };

/* ─── INTRO ──────────────────────────────── */
const overlay  = document.getElementById('intro-overlay');
const video    = document.getElementById('intro-video');
const btnEnter = document.getElementById('btn-enter');
const appEl    = document.getElementById('app');

if (video) {
  video.addEventListener('ended', () => btnEnter.classList.add('visible'));
  video.addEventListener('error', () => btnEnter.classList.add('visible'));
  setTimeout(() => btnEnter.classList.contains('visible') || btnEnter.classList.add('visible'), 8000);
}

function enterApp() {
  sessionStorage.setItem('introVisto', 'true');
  overlay.classList.add('fade-out');
  appEl.classList.remove('hidden');
  overlay.addEventListener('transitionend', () => {
    overlay.remove();
    video.pause(); video.src = '';
  }, { once: true });
  initDashboard();

  // Solo actualizar UI si ya hay sesión (sin bloquear entrada)
  if (sessionReady && currentUser) {
    updateMiZonaBtn(true);
    loadUserPreferences();
    showUserMenu();
  }
}

/* ─── DATOS GLOBALES ──────────────────────── */
let allQuakes = [];
let map = null;
let markers = [];

/* ─── INIT DASHBOARD ──────────────────────── */
function initDashboard() {
  initMap();
  loadData();
  setInterval(loadData, 5 * 60 * 1000);
  setInterval(checkSevereQuakes, 5 * 60 * 1000);
}

/* ─── MAPA LEAFLET ───────────────────────── */
function initMap() {
  map = L.map('map', { center: [20, 0], zoom: 2, zoomControl: true, attributionControl: false });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 18 }).addTo(map);
}

/* ─── CARGAR DATOS ───────────────────────── */
async function loadData() {
  const btn = document.querySelector('.btn-refresh');
  if (btn) btn.classList.add('spinning');

  const minMag = document.getElementById('filter-mag').value;

  try {
    const res  = await fetch(`${BACKEND_URL}/sismos?minmagnitud=${minMag}&limite=150`);
    if (!res.ok) throw new Error('Backend no disponible');
    const json = await res.json();

    allQuakes = json.sismos.map(s => ({
      properties: {
        mag:   s.magnitud,
        place: s.lugar,
        time:  new Date(s.hora).getTime(),
        alert: s.alerta,
        tsunami: s.tsunami ? 1 : 0,
        url:   s.url_usgs,
        clasificacion: s.clasificacion,
      },
      geometry: { coordinates: [s.longitud, s.latitud, s.profundidad_km] },
      id: s.id,
    }));

    console.log(`✓ Datos desde backend FastAPI (${allQuakes.length} sismos)`);

  } catch (e) {
    console.warn('Backend no disponible, usando USGS directo:', e.message);
    const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=-1day&minmagnitude=${minMag}&orderby=time&limit=150`;
    const res  = await fetch(url);
    const json = await res.json();
    allQuakes  = json.features;
    console.log(`✓ Datos desde USGS directo (${allQuakes.length} sismos)`);
  }

  renderAll();
  updateLastUpdate();
  if (btn) btn.classList.remove('spinning');
}

function applyFilters() { loadData(); }
async function checkSevereQuakes() {
  const severe = allQuakes.filter(f => (f.properties.mag || 0) >= 6.0);
  if (!severe.length) return;

  const top = severe[0];
  await fetch(`${BACKEND_URL}/push/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `🌍 Sismo M ${top.properties.mag.toFixed(1)}`,
      body:  top.properties.place || 'Ver detalles en terraALERT',
      mag:   top.properties.mag,
      id:    top.id,
      url:   top.properties.url || '/'
    })
  });
}

/* ─── RENDER ─────────────────────────────── */
function renderAll() {
  renderStats();
  renderMap();
  renderTable();
  if (typeof actualizarTodasLasZonas === 'function') actualizarTodasLasZonas();
}

/* ─── ESTADÍSTICAS ───────────────────────── */
function renderStats() {
  const q = allQuakes;
  if (!q.length) return;

  const mags   = q.map(f => f.properties.mag).filter(Boolean);
  const maxMag = Math.max(...mags);
  const avgMag = (mags.reduce((a,b) => a+b, 0) / mags.length).toFixed(1);
  const maxQ   = q.find(f => f.properties.mag === maxMag);

  const zones = {};
  q.forEach(f => {
    const zone = (f.properties.place || '').split(', ').pop() || '?';
    zones[zone] = (zones[zone] || 0) + 1;
  });
  const topZone = Object.entries(zones).sort((a,b) => b[1]-a[1])[0];

  document.getElementById('stat-total').textContent = q.length;
  document.getElementById('stat-total-sub').textContent = `filtro ≥ ${document.getElementById('filter-mag').value || '0'}`;
  document.getElementById('stat-max').textContent = maxMag.toFixed(1);
  document.getElementById('stat-max-sub').textContent = maxQ ? shortPlace(maxQ.properties.place) : '';
  document.getElementById('stat-avg').textContent = avgMag;
  document.getElementById('stat-zone').textContent = topZone ? topZone[0] : '—';
  document.getElementById('stat-zone-sub').textContent = topZone ? `${topZone[1]} sismos` : '';

  const severe = q.filter(f => f.properties.mag >= 6).length;
  const badge  = document.getElementById('alert-count');
  badge.textContent = severe;
  badge.classList.toggle('show', severe > 0);
}

/* ─── MAPA ───────────────────────────────── */
function renderMap() {
  markers.forEach(m => map.removeLayer(m));
  markers = [];

  allQuakes.forEach(feature => {
    const mag   = feature.properties.mag || 0;
    const place = feature.properties.place || 'Desconocido';
    const time  = new Date(feature.properties.time);
    const coords = feature.geometry.coordinates;
    const [lng, lat] = coords;
    const clasificacion = feature.properties.clasificacion || clasificarMag(mag);

    const color  = magColor(mag);
    const radius = Math.max(4, mag * 2.5);

    const circle = L.circleMarker([lat, lng], {
      radius, fillColor: color, color, weight: 1, opacity: 0.8, fillOpacity: 0.5
    });

    circle.bindPopup(`
      <div style="font-family:'Share Tech Mono',monospace;font-size:12px;line-height:1.8;color:#e2e2f0;background:#0d0d18;padding:4px 2px;">
        <b style="font-size:16px;color:${color}">M ${mag.toFixed(1)}</b>
        <span style="color:#6b6b90;font-size:10px;margin-left:8px;text-transform:uppercase;">${clasificacion}</span><br>
        ${place}<br>
        <span style="color:#6b6b90">${timeAgo(time)}</span>
      </div>
    `, { className: 'terra-popup' });

    circle.addTo(map);
    markers.push(circle);
  });
}

/* ─── TABLA ──────────────────────────────── */
function renderTable() {
  const tbody = document.getElementById('quake-tbody');
  document.getElementById('quake-count').textContent = `${allQuakes.length} eventos`;

  if (!allQuakes.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="loading-row">Sin datos disponibles</td></tr>';
    return;
  }

  tbody.innerHTML = allQuakes.slice(0, 80).map(f => {
    const mag   = f.properties.mag || 0;
    const place = f.properties.place || 'Desconocido';
    const time  = new Date(f.properties.time);
    const depth = f.geometry.coordinates[2]?.toFixed(0) || '?';
    const clas  = f.properties.clasificacion || clasificarMag(mag);

    return `
      <tr>
        <td><span class="mag-pill ${magClass(mag)}" title="${clas}">${mag.toFixed(1)}</span></td>
        <td><span class="quake-place" title="${place}">${shortPlace(place)}</span></td>
        <td><span class="quake-time">${timeAgo(time)}</span></td>
        <td><span class="quake-depth">${depth} km</span></td>
      </tr>
    `;
  }).join('');
}

/* ─── HELPERS ─────────────────────────────── */
function clasificarMag(mag) {
  if (mag >= 7)   return 'severo';
  if (mag >= 5)   return 'fuerte';
  if (mag >= 3)   return 'moderado';
  return 'leve';
}

function magColor(mag) {
  if (mag >= 7)   return '#ff2200';
  if (mag >= 6)   return '#ff6600';
  if (mag >= 5)   return '#f59e0b';
  if (mag >= 4)   return '#facc15';
  if (mag >= 2.5) return '#4ade80';
  return '#60a5fa';
}

function magClass(mag) {
  if (mag >= 6)   return 'mag-severe';
  if (mag >= 5)   return 'mag-high';
  if (mag >= 3.5) return 'mag-mid';
  return 'mag-low';
}

function shortPlace(place) {
  if (!place) return '—';
  return place.length > 30 ? place.slice(0, 28) + '…' : place;
}

function timeAgo(date) {
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'ahora';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h/24)}d`;
}

function updateLastUpdate() {
  const now = new Date();
  document.getElementById('last-update').textContent =
    `Actualizado: ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
}

/* ─── SONIDO ──────────────────────────────── */
let soundEnabled = true;
let audioCtx = null;
let alertSoundPlayed = false;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playAlertSound(level) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    // Secuencia de tonos tipo "alerta de emergencia"
    const notes = level >= 7
      ? [880, 660, 880, 660, 880]   // épico/gran: más frenético
      : [660, 440, 550];             // fuerte/mayor: dos pulsos
    let t = ctx.currentTime;
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.start(t); osc.stop(t + 0.25);
      t += 0.3;
    });
  } catch(e) { /* contexto de audio no disponible */ }
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  document.getElementById('sound-icon-on').classList.toggle('hidden', !soundEnabled);
  document.getElementById('sound-icon-off').classList.toggle('hidden', soundEnabled);
  document.getElementById('sound-label').textContent = soundEnabled ? 'SFX: ON' : 'SFX: OFF';
  document.getElementById('alert-sound-btn').classList.toggle('active', soundEnabled);
  if (soundEnabled) playAlertSound(5); // preview
}

/* ─── RENDER ALERTAS ─────────────────────── */
function alertCardClass(mag) {
  if (mag >= 8.0) return 'alert-card--epic';
  if (mag >= 7.0) return 'alert-card--gran';
  if (mag >= 6.0) return 'alert-card--mayor';
  return 'alert-card--fuerte';
}

function alertClasLabel(mag) {
  if (mag >= 8.0) return 'ÉPICO';
  if (mag >= 7.0) return 'GRAN SISMO';
  if (mag >= 6.0) return 'MAYOR';
  return 'FUERTE';
}

function renderAlerts() {
  const severe = allQuakes.filter(f => (f.properties.mag || 0) >= 5.0)
    .sort((a, b) => b.properties.mag - a.properties.mag);

  const grid = document.getElementById('alerts-grid');
  const countEl = document.getElementById('alert-banner-count');
  countEl.textContent = `${severe.length} evento${severe.length !== 1 ? 's' : ''} crítico${severe.length !== 1 ? 's' : ''}`;

  if (!severe.length) {
    grid.innerHTML = '<div class="alerts-empty">Sin alertas activas en las últimas 24h</div>';
    return;
  }

  // Sonido si hay sismos ≥ 6.0 nuevos
  const maxSevere = severe[0]?.properties.mag || 0;
  if (!alertSoundPlayed && maxSevere >= 6.0) {
    playAlertSound(maxSevere);
    alertSoundPlayed = true;
  }

  grid.innerHTML = severe.map(f => {
    const mag     = f.properties.mag || 0;
    const place   = f.properties.place || 'Desconocido';
    const time    = new Date(f.properties.time);
    const depth   = f.geometry.coordinates[2]?.toFixed(0) || '?';
    const url     = f.properties.url || '#';
    const tsunami = f.properties.tsunami;
    const cls     = alertCardClass(mag);
    const label   = alertClasLabel(mag);

    return `
      <div class="alert-card ${cls}">
        <div class="alert-card-left">
          <div class="alert-mag">M ${mag.toFixed(1)}</div>
          <span class="alert-clas-badge">${label}</span>
          ${tsunami ? '<span class="alert-tsunami-badge">⚠ TSUNAMI</span>' : ''}
        </div>
        <div class="alert-card-right">
          <div class="alert-card-place" title="${place}">${place}</div>
          <div class="alert-card-meta">
            <span class="alert-card-time">${timeAgo(time)}</span>
            <span class="alert-card-depth">↓ ${depth} km</span>
            ${url !== '#' ? `<a class="alert-card-link" href="${url}" target="_blank" rel="noopener">USGS ↗</a>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/* ─── NAVEGACIÓN ─────────────────────────── */
function showView(view) {
  const dashTable     = document.getElementById('dashboard-table');
  const statsGrid     = document.querySelector('.stats-grid');
  const mapSection    = document.getElementById('map-section');
  const alertSection  = document.getElementById('alerts-section');
  const mizonaSection = document.getElementById('mizona-section');

  // Ocultar todo
  dashTable?.classList.add('hidden');
  statsGrid?.classList.add('hidden');
  mapSection?.classList.add('hidden');
  alertSection?.classList.add('hidden');
  mizonaSection?.classList.add('hidden');

  if (view === 'mizona') {
    mizonaSection?.classList.remove('hidden');
  } else if (view === 'dashboard') {
    statsGrid?.classList.remove('hidden');
    dashTable?.classList.remove('hidden');

  } else if (view === 'map') {
    statsGrid?.classList.remove('hidden');
    mapSection?.classList.remove('hidden');
    if (map) setTimeout(() => map.invalidateSize(), 50);

  } else if (view === 'alerts') {
    alertSection?.classList.remove('hidden');
    alertSoundPlayed = false; // permitir sonido al entrar a la vista
    renderAlerts();
  }
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    const view = item.dataset.view;
    // El botón Mi Zona tiene su propio handler (openMiZona)
    if (item.id === 'btn-mizona') return;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    document.getElementById('page-title').textContent =
      { dashboard:'Dashboard', map:'Mapa Global', alerts:'Alertas Sísmicas' }[view] || view;
    showView(view);
  });
});

/* ─── AUTH ───────────────────────────────── */
async function handleAuth() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: 'https://terra-alert-jade.vercel.app'
    }
  });
  if (error) console.error(error);
}

/* Abrir Mi Zona: si no hay sesión → modal de login, si hay → vista Mi Zona */
function openMiZona() {
  if (!currentUser) {
    document.getElementById('mizona-auth-modal').classList.remove('hidden');
  } else {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.getElementById('page-title').textContent = 'Mi Zona';
    showView('mizona');
  }
}

function updateMiZonaBtn(loggedIn) {
  const btn = document.getElementById('btn-mizona');
  if (!btn) return;
  if (loggedIn) {
    btn.classList.add('active');
    // Rellenar estrella cuando hay sesión
    const svg = btn.querySelector('svg');
    if (svg) { svg.setAttribute('fill', 'currentColor'); }
  } else {
    btn.classList.remove('active');
    const svg = btn.querySelector('svg');
    if (svg) { svg.setAttribute('fill', 'none'); }
  }
}

async function saveQuake(quake) {
  if (!currentUser) return;
  await sb.from('quake_history').insert({
    user_id: currentUser.id,
    quake_id: quake.id,
    magnitud: quake.properties.mag,
    clasificacion: quake.properties.clasificacion,
    lugar: quake.properties.place,
    hora: new Date(quake.properties.time).toISOString(),
    latitud: quake.geometry.coordinates[1],
    longitud: quake.geometry.coordinates[0],
    profundidad_km: quake.geometry.coordinates[2]
  });
}

async function loadHistory() {
  if (!currentUser) return;
  const { data } = await sb
    .from('quake_history')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(50);

  const tbody = document.getElementById('history-tbody');
  if (!data || !data.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="loading-row">Sin sismos guardados</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(q => `
    <tr>
      <td><span class="mag-pill ${magClass(q.magnitud)}">${q.magnitud?.toFixed(1)}</span></td>
      <td><span class="quake-place">${shortPlace(q.lugar)}</span></td>
      <td><span class="quake-time">${timeAgo(new Date(q.hora))}</span></td>
      <td><span class="quake-depth">${q.profundidad_km?.toFixed(0)} km</span></td>
    </tr>
  `).join('');
}

function showUserMenu() {
  const email    = currentUser?.email || '';
  const initials = email.substring(0, 2).toUpperCase();
  const topbar   = document.querySelector('.topbar-right');
  document.getElementById('user-menu')?.remove();

  const menu = document.createElement('div');
  menu.id    = 'user-menu';
  menu.className = 'user-menu';
  menu.innerHTML = `
    <div class="user-avatar" title="${email}">${initials}</div>
  `;
  topbar.prepend(menu);

  // Mostrar email en el header de Mi Zona
  const tag = document.getElementById('mizona-user-tag');
  if (tag) tag.textContent = email;
}

async function logout() {
  await sb.auth.signOut();
  currentUser = null;
  sessionStorage.removeItem('introVisto');
  document.getElementById('user-menu')?.remove();
}

/* ─── INIT AUTH ──────────────────────────── */
sb.auth.getSession().then(({ data: { session } }) => {
  sessionReady = true;
  if (session?.user) {
    currentUser = session.user;
    loadUserPreferences();
    showUserMenu();
    updateMiZonaBtn(true);
    document.getElementById('mizona-auth-modal')?.classList.add('hidden');
    if (window.location.hash.includes('access_token') || window.location.search.includes('code=')) {
      openMiZona();
    }
  }
  // Limpiar la URL AHORA, después de que Supabase procesó la sesión
  if (window.location.hash.includes('access_token') || window.location.search.includes('code=')) {
    window.history.replaceState({}, document.title, '/');
  }
  // Si la app ya está visible (vino de OAuth redirect), inicializar dashboard
  if (!appEl.classList.contains('hidden')) {
    initDashboard();
  }
});

/* ─── BUSCADOR DEL MAPA (Nominatim) ────────── */
let searchMarker = null;
let activeSearch = null; // { lat, lng, label }

async function searchLocation() {
  const input  = document.getElementById('map-search-input');
  const status = document.getElementById('map-search-status');
  const query  = input.value.trim();
  if (!query) return;

  // Mostrar estado cargando
  status.className = 'map-search-status loading';
  status.textContent = '⟳ Buscando…';
  status.classList.remove('hidden');

  try {
    const res  = await fetch(
  `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&_=${Date.now()}`,
  { headers: { 'Accept-Language': 'es' }, cache: 'no-store' }
);
    const data = await res.json();

    if (!data.length) {
      status.className = 'map-search-status error';
      status.textContent = '✕ Ubicación no encontrada';
      return;
    }

    const { lat, lon, display_name } = data[0];
    const latN = parseFloat(lat);
    const lngN = parseFloat(lon);

    // Mover mapa
    map.flyTo([latN, lngN], 6, { duration: 1.4 });

    // Quitar marcador anterior
    if (searchMarker) map.removeLayer(searchMarker);

    // Marcador especial de búsqueda
    const icon = L.divIcon({
      className: '',
      html: `<div style="
        width:14px;height:14px;border-radius:50%;
        background:var(--blue);border:2px solid #fff;
        box-shadow:0 0 10px rgba(96,165,250,0.7);
      "></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });

    searchMarker = L.marker([latN, lngN], { icon })
      .addTo(map)
      .bindPopup(`
        <div style="font-family:'Share Tech Mono',monospace;font-size:11px;color:#e2e2f0;background:#0d0d18;padding:2px;">
          <b style="color:var(--blue)">📍 BÚSQUEDA</b><br>
          ${display_name.split(',').slice(0, 3).join(',')}
        </div>
      `, { className: 'terra-popup' })
      .openPopup();

    // Guardar búsqueda activa
    activeSearch = { lat: latN, lng: lngN, label: display_name };

    // Actualizar stats con sismos cercanos
    updateStatsForZone(latN, lngN);

    // Mostrar botón limpiar y estado
    document.getElementById('map-search-clear').classList.remove('hidden');
    status.className = 'map-search-status found';
    const shortName = display_name.split(',').slice(0, 2).join(',');
    status.textContent = `✓ ${shortName} — sismos en radio 500 km`;

  } catch (e) {
    status.className = 'map-search-status error';
    status.textContent = '✕ Error al buscar. Intenta de nuevo.';
  }
}

function clearMapSearch() {
  // Quitar marcador
  if (searchMarker) { map.removeLayer(searchMarker); searchMarker = null; }

  // Limpiar estado
  activeSearch = null;
  document.getElementById('map-search-input').value = '';
  document.getElementById('map-search-clear').classList.add('hidden');
  document.getElementById('map-search-status').classList.add('hidden');

  // Volver al mapa global y stats globales
  map.flyTo([20, 0], 2, { duration: 1.2 });
  renderStats(); // vuelve a las cards globales
}

/* Cards de stats filtradas por zona (radio 500km) */
function updateStatsForZone(lat, lng) {
  const radio = 500; // km
  const nearby = allQuakes.filter(f => {
    const [fLng, fLat] = f.geometry.coordinates;
    return haversine(lat, lng, fLat, fLng) <= radio;
  });

  if (!nearby.length) {
    document.getElementById('stat-total').textContent = '0';
    document.getElementById('stat-total-sub').textContent = `radio ${radio} km`;
    document.getElementById('stat-max').textContent = '—';
    document.getElementById('stat-max-sub').textContent = 'sin datos';
    document.getElementById('stat-avg').textContent = '—';
    document.getElementById('stat-zone').textContent = '—';
    document.getElementById('stat-zone-sub').textContent = `0 sismos cercanos`;
    return;
  }

  const mags   = nearby.map(f => f.properties.mag).filter(Boolean);
  const maxMag = Math.max(...mags);
  const avgMag = (mags.reduce((a, b) => a + b, 0) / mags.length).toFixed(1);
  const maxQ   = nearby.find(f => f.properties.mag === maxMag);
  // Último evento
  const lastQ  = nearby.sort((a, b) => b.properties.time - a.properties.time)[0];

  document.getElementById('stat-total').textContent = nearby.length;
  document.getElementById('stat-total-sub').textContent = `radio ${radio} km`;
  document.getElementById('stat-max').textContent = maxMag.toFixed(1);
  document.getElementById('stat-max-sub').textContent = maxQ ? shortPlace(maxQ.properties.place) : '';
  document.getElementById('stat-avg').textContent = avgMag;
  document.getElementById('stat-zone').textContent = shortPlace(lastQ.properties.place);
  document.getElementById('stat-zone-sub').textContent = timeAgo(new Date(lastQ.properties.time));
}

/* Fórmula Haversine para distancia entre 2 coordenadas (km) */
function haversine(lat1, lng1, lat2, lng2) {
  const R  = 6371;
  const dL = (lat2 - lat1) * Math.PI / 180;
  const dG = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(dL/2)**2 +
             Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dG/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/* ─── MI ZONA — multi-zonas ──────────────── */
let zonasGuardadas = []; // [{id, pais, ciudad, umbral_magnitud, zona_label, lat, lng, map, markers}]

/* Abrir/cerrar panel de configuración */
function toggleMzConfig() {
  const panel = document.getElementById('mz-config-panel');
  const btn   = document.getElementById('mz-btn-config');
  const isOpen = !panel.classList.contains('hidden');
  panel.classList.toggle('hidden', isOpen);
  btn.classList.toggle('open', !isOpen);
}

/* Cargar todas las zonas guardadas del usuario */
async function loadUserPreferences() {
  if (!currentUser) return;

  const { data, error } = await sb
    .from('user_preferences')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error cargando zonas:', error);
    return;
  }

  zonasGuardadas = (data || []).map(z => ({ ...z, map: null, markers: [] }));
  renderZonasContainer();
}

/* Agregar nueva zona (INSERT, no upsert) */
async function agregarZona() {
  if (!currentUser) return;

  const pais   = document.getElementById('pref-pais').value;
  const ciudad = document.getElementById('pref-ciudad').value.trim();
  const umbral = parseFloat(document.getElementById('pref-umbral').value);

  if (!pais) {
    alert('Selecciona al menos un país.');
    return;
  }

  const query = ciudad ? `${ciudad}, ${pais}` : pais;
  let lat, lng, label;

  try {
    const res  = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&_=${Date.now()}`,
      { headers: { 'Accept-Language': 'es' }, cache: 'no-store' }
    );
    const data = await res.json();
    if (!data.length) throw new Error('No encontrado');
    lat   = parseFloat(data[0].lat);
    lng   = parseFloat(data[0].lon);
    label = data[0].display_name.split(',').slice(0, 2).join(',').trim();
  } catch {
    alert('No se pudo encontrar esa ubicación. Intenta con otro nombre.');
    return;
  }

  const nuevaZona = {
    user_id:         currentUser.id,
    pais,
    ciudad:          ciudad || null,
    umbral_magnitud: umbral,
    zona_label:      label,
    lat,
    lng,
    updated_at:      new Date().toISOString()
  };

  const { data: inserted, error } = await sb
    .from('user_preferences')
    .insert(nuevaZona)
    .select()
    .single();

  if (error) {
    console.error('Error guardando zona:', error);
    alert('Error al guardar la zona. Revisa la consola.');
    return;
  }

  zonasGuardadas.push({ ...inserted, map: null, markers: [] });

  const msg = document.getElementById('pref-saved-msg');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2500);

  document.getElementById('pref-pais').value = '';
  document.getElementById('pref-ciudad').value = '';

  document.getElementById('mz-config-panel').classList.add('hidden');
  document.getElementById('mz-btn-config').classList.remove('open');

  renderZonasContainer();
}

/* Borrar una zona */
async function borrarZona(zonaId) {
  if (!confirm('¿Borrar esta zona guardada?')) return;

  const { error } = await sb
    .from('user_preferences')
    .delete()
    .eq('id', zonaId);

  if (error) {
    console.error('Error borrando zona:', error);
    alert('Error al borrar la zona.');
    return;
  }

  zonasGuardadas = zonasGuardadas.filter(z => z.id !== zonaId);
  renderZonasContainer();
}

/* Renderizar el contenedor de tarjetas */
function renderZonasContainer() {
  const container = document.getElementById('mz-zonas-container');
  const empty     = document.getElementById('mz-empty');

  if (!zonasGuardadas.length) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  container.innerHTML = zonasGuardadas.map(zona => {
    const titulo = zona.ciudad ? `${zona.ciudad}, ${zona.pais}` : zona.pais;
    return `
      <div class="mz-zona-card" data-zona-id="${zona.id}">
        <div class="mz-zona-header">
          <div class="mz-zona-title">
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            ${titulo}
          </div>
          <button class="mz-zona-delete" onclick="borrarZona('${zona.id}')">✕ BORRAR</button>
        </div>

        <div class="mz-zona-status" id="mz-status-${zona.id}">
          <span class="mz-status-dot" id="mz-status-dot-${zona.id}"></span>
          <span id="mz-status-label-${zona.id}">Cargando...</span>
        </div>

        <div class="mz-zona-stats" id="mz-stats-${zona.id}">
          <div class="stat-card">
            <div class="stat-label">Sismos</div>
            <div class="stat-value" id="mz-total-${zona.id}">—</div>
            <div class="stat-sub">radio 500 km</div>
          </div>
          <div class="stat-card stat-card--warn">
            <div class="stat-label">Mag. Máx.</div>
            <div class="stat-value" id="mz-max-${zona.id}">—</div>
            <div class="stat-sub" id="mz-max-sub-${zona.id}">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Mag. Prom.</div>
            <div class="stat-value" id="mz-avg-${zona.id}">—</div>
            <div class="stat-sub">≥ ${zona.umbral_magnitud}</div>
          </div>
          <div class="stat-card stat-card--danger">
            <div class="stat-label">Último</div>
            <div class="stat-value stat-value--sm" id="mz-last-${zona.id}">—</div>
            <div class="stat-sub" id="mz-last-sub-${zona.id}">—</div>
          </div>
        </div>

        <div class="mz-zona-body">
          <div class="mz-zona-table-wrap table-panel">
            <div class="panel-header">
              <span class="panel-title">SISMOS CERCANOS</span>
              <span class="panel-count" id="mz-count-${zona.id}">—</span>
            </div>
            <table class="quake-table">
              <thead><tr><th>Mag.</th><th>Lugar</th><th>Hora</th><th>Prof.</th></tr></thead>
              <tbody id="mz-tbody-${zona.id}">
                <tr><td colspan="4" class="loading-row">Cargando...</td></tr>
              </tbody>
            </table>
          </div>
          <div class="mz-zona-map" id="mz-map-${zona.id}"></div>
        </div>
      </div>
    `;
  }).join('');

  zonasGuardadas.forEach(zona => {
    initZonaMap(zona);
    actualizarZonaData(zona);
  });
}

/* Inicializar mini-mapa de una zona */
function initZonaMap(zona) {
  const el = document.getElementById(`mz-map-${zona.id}`);
  if (!el) return;

  zona.map = L.map(el, {
    center: [zona.lat, zona.lng], zoom: 5,
    zoomControl: true, attributionControl: false
  });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 18
  }).addTo(zona.map);

  const iconUser = L.divIcon({
    className: '',
    html: `<div style="width:12px;height:12px;border-radius:50%;
      background:var(--amber);border:2px solid #fff;
      box-shadow:0 0 10px rgba(245,158,11,0.8);"></div>`,
    iconSize: [12, 12], iconAnchor: [6, 6]
  });
  L.marker([zona.lat, zona.lng], { icon: iconUser })
    .addTo(zona.map)
    .bindPopup(`<div style="font-family:'Share Tech Mono',monospace;font-size:11px;color:#e2e2f0;background:#0d0d18;padding:4px;">
      <b style="color:var(--amber)">📍 ${zona.zona_label || zona.pais}</b>
    </div>`, { className: 'terra-popup' });

  setTimeout(() => zona.map.invalidateSize(), 100);
}

/* Calcular y renderizar datos de una zona específica */
function actualizarZonaData(zona) {
  const radio  = 500;
  const umbral = zona.umbral_magnitud || 5.0;

  const nearby = allQuakes.filter(f => {
    const [fLng, fLat] = f.geometry.coordinates;
    return haversine(zona.lat, zona.lng, fLat, fLng) <= radio &&
           (f.properties.mag || 0) >= umbral;
  });

  const dot   = document.getElementById(`mz-status-dot-${zona.id}`);
  const label = document.getElementById(`mz-status-label-${zona.id}`);
  if (!dot || !label) return;

  const maxMagAll = nearby.length ? Math.max(...nearby.map(f => f.properties.mag || 0)) : 0;

  dot.className = 'mz-status-dot';
  if (!nearby.length) {
    label.textContent = 'SIN ACTIVIDAD SÍSMICA EN ESTA ZONA';
  } else if (maxMagAll >= 6.0) {
    dot.classList.add('alert');
    label.textContent = `⚠ ALERTA — Sismo M${maxMagAll.toFixed(1)} detectado cerca`;
  } else if (maxMagAll >= 4.5) {
    dot.classList.add('moderate');
    label.textContent = `ACTIVIDAD MODERADA — Máx. M${maxMagAll.toFixed(1)}`;
  } else {
    dot.classList.add('calm');
    label.textContent = `ACTIVIDAD BAJA — ${nearby.length} sismo${nearby.length !== 1 ? 's' : ''}`;
  }

  if (!nearby.length) {
    document.getElementById(`mz-total-${zona.id}`).textContent = '0';
    document.getElementById(`mz-max-${zona.id}`).textContent = '—';
    document.getElementById(`mz-max-sub-${zona.id}`).textContent = 'sin datos';
    document.getElementById(`mz-avg-${zona.id}`).textContent = '—';
    document.getElementById(`mz-last-${zona.id}`).textContent = '—';
    document.getElementById(`mz-last-sub-${zona.id}`).textContent = '—';
  } else {
    const mags   = nearby.map(f => f.properties.mag).filter(Boolean);
    const maxMag = Math.max(...mags);
    const avgMag = (mags.reduce((a,b) => a+b, 0) / mags.length).toFixed(1);
    const maxQ   = nearby.find(f => f.properties.mag === maxMag);
    const lastQ  = [...nearby].sort((a,b) => b.properties.time - a.properties.time)[0];

    document.getElementById(`mz-total-${zona.id}`).textContent = nearby.length;
    document.getElementById(`mz-max-${zona.id}`).textContent = maxMag.toFixed(1);
    document.getElementById(`mz-max-sub-${zona.id}`).textContent = maxQ ? shortPlace(maxQ.properties.place) : '';
    document.getElementById(`mz-avg-${zona.id}`).textContent = avgMag;
    document.getElementById(`mz-last-${zona.id}`).textContent = shortPlace(lastQ.properties.place);
    document.getElementById(`mz-last-sub-${zona.id}`).textContent = timeAgo(new Date(lastQ.properties.time));
  }

  const tbody = document.getElementById(`mz-tbody-${zona.id}`);
  document.getElementById(`mz-count-${zona.id}`).textContent = `${nearby.length} eventos`;

  if (!nearby.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="loading-row">Sin sismos en esta zona con el filtro actual</td></tr>';
  } else {
    tbody.innerHTML = [...nearby]
      .sort((a,b) => b.properties.time - a.properties.time)
      .slice(0, 30).map(f => {
        const mag   = f.properties.mag || 0;
        const place = f.properties.place || 'Desconocido';
        const time  = new Date(f.properties.time);
        const depth = f.geometry.coordinates[2]?.toFixed(0) || '?';
        const clas  = f.properties.clasificacion || clasificarMag(mag);
        return `
          <tr>
            <td><span class="mag-pill ${magClass(mag)}" title="${clas}">${mag.toFixed(1)}</span></td>
            <td><span class="quake-place" title="${place}">${shortPlace(place)}</span></td>
            <td><span class="quake-time">${timeAgo(time)}</span></td>
            <td><span class="quake-depth">${depth} km</span></td>
          </tr>`;
      }).join('');
  }

  if (zona.map) {
    zona.markers.forEach(m => zona.map.removeLayer(m));
    zona.markers = [];

    nearby.forEach(feature => {
      const mag    = feature.properties.mag || 0;
      const place  = feature.properties.place || 'Desconocido';
      const time   = new Date(feature.properties.time);
      const [lng, lat] = feature.geometry.coordinates;
      const color  = magColor(mag);
      const radius = Math.max(4, mag * 2.5);

      const circle = L.circleMarker([lat, lng], {
        radius, fillColor: color, color, weight: 1,
        opacity: 0.8, fillOpacity: 0.5
      }).bindPopup(`
        <div style="font-family:'Share Tech Mono',monospace;font-size:11px;line-height:1.8;color:#e2e2f0;background:#0d0d18;padding:4px;">
          <b style="font-size:15px;color:${color}">M ${mag.toFixed(1)}</b><br>
          ${place}<br>
          <span style="color:#6b6b90">${timeAgo(time)}</span>
        </div>
      `, { className: 'terra-popup' });

      circle.addTo(zona.map);
      zona.markers.push(circle);
    });
  }
}

/* Recalcular todas las zonas */
function actualizarTodasLasZonas() {
  zonasGuardadas.forEach(zona => actualizarZonaData(zona));
}

/* showView — al entrar a Mi Zona, refrescar datos */
const _origShowView = showView;
showView = function(view) {
  _origShowView(view);
  if (view === 'mizona') {
    const tag = document.getElementById('mz-user-tag');
    if (tag && currentUser) tag.textContent = currentUser.email;

    if (!zonasGuardadas.length && currentUser) {
      loadUserPreferences();
    } else {
      actualizarTodasLasZonas();
    }
  }
};