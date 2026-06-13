/* ═══════════════════════════════════════════
   terraALERT — app.js
   Frontend conectado al backend FastAPI
   ═══════════════════════════════════════════ */

/* ─── SKIP INTRO SI YA FUE VISTO O VIENE DE OAUTH ── */
if (sessionStorage.getItem('introVisto') ||
    window.location.hash.includes('access_token') ||
    window.location.search.includes('code=')) {
  document.getElementById('intro-overlay').style.display = 'none';
  document.getElementById('app').classList.remove('hidden');
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

async function loadUserPreferences() {
  if (!currentUser) return;
  const { data } = await sb
    .from('user_preferences')
    .select('*')
    .eq('user_id', currentUser.id)
    .single();

  if (data) {
    userPreferences = data;
    const paisEl   = document.getElementById('pref-pais');
    const ciudadEl = document.getElementById('pref-ciudad');
    const umbralEl = document.getElementById('pref-umbral');
    if (paisEl)   paisEl.value   = data.pais || '';
    if (ciudadEl) ciudadEl.value = data.ciudad || '';
    if (umbralEl) umbralEl.value = data.umbral_magnitud || 5.0;
    // Si ya tiene zona guardada, cargar datos automáticamente
    if (data.lat && data.lng) {
      mizonaLat   = data.lat;
      mizonaLng   = data.lng;
      mizonaLabel = data.zona_label || data.pais || '';
    }
  }
}

async function savePreferences() {
  if (!currentUser) return;
  const prefs = {
    user_id:         currentUser.id,
    zona_label:      mizonaLabel,
    lat:             mizonaLat,
    lng:             mizonaLng,
    umbral_magnitud: parseFloat(document.getElementById('pref-umbral').value),
    updated_at:      new Date().toISOString()
  };

  await sb.from('user_preferences').upsert(prefs, { onConflict: 'user_id' });
  userPreferences = prefs;

  // Feedback visual
  const msg = document.getElementById('pref-saved-msg');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2500);

  // Cargar datos de la nueva zona
  if (prefs.pais) loadMiZonaData();
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
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { 'Accept-Language': 'es' } }
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

/* ─── MI ZONA — estado ───────────────────── */
let mizonaLat  = null;
let mizonaLng  = null;
let mizonaLabel = '';
let mzMap      = null;
let mzMarkers  = [];

/* Abrir/cerrar panel de configuración */
function toggleMzConfig() {
  const panel = document.getElementById('mz-config-panel');
  const btn   = document.getElementById('mz-btn-config');
  const isOpen = !panel.classList.contains('hidden');
  panel.classList.toggle('hidden', isOpen);
  btn.classList.toggle('open', !isOpen);
}

/* Inicializar el mini-mapa de Mi Zona (solo una vez) */
function initMzMap() {
  if (mzMap) return;
  mzMap = L.map('mz-map', {
    center: [20, 0], zoom: 4,
    zoomControl: true, attributionControl: false
  });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 18
  }).addTo(mzMap);
}

/* Guardar preferencias en Supabase y cargar datos */
async function guardarYCargarMiZona() {
  if (!currentUser) return;

  const pais   = document.getElementById('pref-pais').value;
  const ciudad = document.getElementById('pref-ciudad').value.trim();
  const umbral = parseFloat(document.getElementById('pref-umbral').value);

  if (!pais) {
    alert('Selecciona al menos un país.');
    return;
  }

  // Geocodificar
  const query = ciudad ? `${ciudad}, ${pais}` : pais;
  let lat, lng, label;

  try {
    const res  = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { 'Accept-Language': 'es' } }
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

  // Guardar en Supabase
  const prefs = {
    user_id:         currentUser.id,
    pais,
    ciudad:          ciudad || null,
    umbral_magnitud: umbral,
    zona_label:      label,
    lat,
    lng,
    updated_at:      new Date().toISOString()
  };
  await sb.from('user_preferences').upsert(prefs, { onConflict: 'user_id' });
  userPreferences = prefs;

  // Feedback
  const msg = document.getElementById('pref-saved-msg');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2500);

  // Cerrar panel config
  document.getElementById('mz-config-panel').classList.add('hidden');
  document.getElementById('mz-btn-config').classList.remove('open');

  // Aplicar
  mizonaLat   = lat;
  mizonaLng   = lng;
  mizonaLabel = label;
  loadMiZonaData();
}

/* Cargar y renderizar datos de Mi Zona */
function loadMiZonaData() {
  if (!mizonaLat) return;

  const umbral = parseFloat(document.getElementById('pref-umbral')?.value || 5.0);
  const radio  = 500; // km

  const nearby = allQuakes.filter(f => {
    const [fLng, fLat] = f.geometry.coordinates;
    return haversine(mizonaLat, mizonaLng, fLat, fLng) <= radio &&
           (f.properties.mag || 0) >= umbral;
  });

  // Actualizar status bar
  actualizarStatusBar(nearby);

  // Renderizar todo
  renderMzStats(nearby, radio);
  renderMzHighlight(nearby);
  renderMzTable(nearby);
  renderMzMap(nearby);

  // Mostrar/ocultar empty
  document.getElementById('mz-empty').classList.toggle('hidden', true);
}

/* Barra de estado semáforo */
function actualizarStatusBar(nearby) {
  const dot   = document.getElementById('mz-status-dot');
  const label = document.getElementById('mz-status-label');
  const loc   = document.getElementById('mz-status-loc');

  const maxMag = nearby.length ? Math.max(...nearby.map(f => f.properties.mag || 0)) : 0;

  dot.className = 'mz-status-dot';
  if (!nearby.length) {
    label.textContent = 'SIN ACTIVIDAD SÍSMICA EN TU ZONA';
  } else if (maxMag >= 6.0) {
    dot.classList.add('alert');
    label.textContent = `⚠ ALERTA — Sismo M${maxMag.toFixed(1)} detectado cerca`;
  } else if (maxMag >= 4.5) {
    dot.classList.add('moderate');
    label.textContent = `ACTIVIDAD MODERADA — Máx. M${maxMag.toFixed(1)}`;
  } else {
    dot.classList.add('calm');
    label.textContent = `ACTIVIDAD BAJA — ${nearby.length} sismo${nearby.length !== 1 ? 's' : ''} leve${nearby.length !== 1 ? 's' : ''}`;
  }
  loc.textContent = mizonaLabel;
}

/* Stats cards */
function renderMzStats(nearby, radio) {
  if (!nearby.length) {
    document.getElementById('mz-total').textContent     = '0';
    document.getElementById('mz-total-sub').textContent = `radio ${radio} km · sin eventos`;
    document.getElementById('mz-max').textContent       = '—';
    document.getElementById('mz-max-sub').textContent   = 'sin datos';
    document.getElementById('mz-avg').textContent       = '—';
    document.getElementById('mz-last').textContent      = '—';
    document.getElementById('mz-last-sub').textContent  = '—';
    return;
  }
  const mags   = nearby.map(f => f.properties.mag).filter(Boolean);
  const maxMag = Math.max(...mags);
  const avgMag = (mags.reduce((a,b) => a+b, 0) / mags.length).toFixed(1);
  const maxQ   = nearby.find(f => f.properties.mag === maxMag);
  const lastQ  = [...nearby].sort((a,b) => b.properties.time - a.properties.time)[0];

  document.getElementById('mz-total').textContent     = nearby.length;
  document.getElementById('mz-total-sub').textContent = `radio ${radio} km · últimas 24h`;
  document.getElementById('mz-max').textContent       = maxMag.toFixed(1);
  document.getElementById('mz-max-sub').textContent   = maxQ ? shortPlace(maxQ.properties.place) : '';
  document.getElementById('mz-avg').textContent       = avgMag;
  document.getElementById('mz-last').textContent      = shortPlace(lastQ.properties.place);
  document.getElementById('mz-last-sub').textContent  = timeAgo(new Date(lastQ.properties.time));
}

/* Card último sismo destacado */
function renderMzHighlight(nearby) {
  const card = document.getElementById('mz-highlight');
  if (!nearby.length) { card.classList.add('hidden'); return; }

  const lastQ = [...nearby].sort((a,b) => b.properties.time - a.properties.time)[0];
  const mag   = lastQ.properties.mag || 0;
  const clas  = lastQ.properties.clasificacion || clasificarMag(mag);
  const depth = lastQ.geometry.coordinates[2]?.toFixed(0) || '?';
  const url   = lastQ.properties.url || '#';

  document.getElementById('mz-hl-mag').textContent   = `M ${mag.toFixed(1)}`;
  document.getElementById('mz-hl-place').textContent = lastQ.properties.place || 'Desconocido';
  document.getElementById('mz-hl-time').textContent  = timeAgo(new Date(lastQ.properties.time));
  document.getElementById('mz-hl-depth').textContent = `↓ ${depth} km`;
  document.getElementById('mz-hl-clas').textContent  = clas.toUpperCase();

  const link = document.getElementById('mz-hl-link');
  link.href = url;
  link.style.display = url === '#' ? 'none' : '';

  // Color del mag según severidad
  const magEl = document.getElementById('mz-hl-mag');
  magEl.style.color = magColor(mag);

  card.classList.remove('hidden');
}

/* Tabla */
function renderMzTable(nearby) {
  const tbody = document.getElementById('mz-tbody');
  document.getElementById('mz-quake-count').textContent = `${nearby.length} eventos`;

  if (!nearby.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="loading-row">Sin sismos en tu zona con este filtro</td></tr>';
    return;
  }

  tbody.innerHTML = [...nearby]
    .sort((a,b) => b.properties.time - a.properties.time)
    .slice(0, 60).map(f => {
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

/* Mini-mapa */
function renderMzMap(nearby) {
  if (!mzMap) return;

  // Limpiar marcadores anteriores
  mzMarkers.forEach(m => mzMap.removeLayer(m));
  mzMarkers = [];

  // Centrar en zona del usuario
  mzMap.setView([mizonaLat, mizonaLng], 5);

  // Marcador de referencia (zona del usuario)
  const iconUser = L.divIcon({
    className: '',
    html: `<div style="width:12px;height:12px;border-radius:50%;
      background:var(--amber);border:2px solid #fff;
      box-shadow:0 0 10px rgba(245,158,11,0.8);"></div>`,
    iconSize: [12, 12], iconAnchor: [6, 6]
  });
  const userMarker = L.marker([mizonaLat, mizonaLng], { icon: iconUser })
    .addTo(mzMap)
    .bindPopup(`<div style="font-family:'Share Tech Mono',monospace;font-size:11px;color:#e2e2f0;background:#0d0d18;padding:4px;">
      <b style="color:var(--amber)">📍 MI ZONA</b><br>${mizonaLabel}
    </div>`, { className: 'terra-popup' });
  mzMarkers.push(userMarker);

  // Sismos cercanos
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

    circle.addTo(mzMap);
    mzMarkers.push(circle);
  });

  // Forzar redibujado
  setTimeout(() => mzMap.invalidateSize(), 100);
}

/* showView — agregar caso mizona */
const _origShowView = showView;
showView = function(view) {
  _origShowView(view);
  if (view === 'mizona') {
    initMzMap();
    // Actualizar tag de usuario
    const tag = document.getElementById('mz-user-tag');
    if (tag && currentUser) tag.textContent = currentUser.email;
    // Si ya tiene zona cargada, renderizar
    if (mizonaLat) loadMiZonaData();
    else document.getElementById('mz-empty').classList.remove('hidden');
  }
};