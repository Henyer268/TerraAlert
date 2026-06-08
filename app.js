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

  if (sessionReady && !currentUser) {
    document.getElementById('auth-modal')?.classList.remove('hidden');
  } else if (sessionReady && currentUser) {
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
  const dashTable    = document.getElementById('dashboard-table');
  const statsGrid    = document.querySelector('.stats-grid');
  const mapSection   = document.getElementById('map-section');
  const alertSection = document.getElementById('alerts-section');

  // Ocultar todo
  dashTable?.classList.add('hidden');
  statsGrid?.classList.add('hidden');
  mapSection?.classList.add('hidden');
  alertSection?.classList.add('hidden');

  if (view === 'dashboard') {
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
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    const view = item.dataset.view;
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

function skipAuth() {
  document.getElementById('auth-modal').classList.add('hidden');
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
    document.getElementById('pref-ciudad').value = data.ciudad || '';
    document.getElementById('pref-umbral').value = data.umbral_magnitud || 5.0;
    document.getElementById('pref-zona').value = data.zona_interes || '';
  }
}

async function savePreferences() {
  if (!currentUser) return;
  const prefs = {
    user_id: currentUser.id,
    ciudad: document.getElementById('pref-ciudad').value,
    umbral_magnitud: parseFloat(document.getElementById('pref-umbral').value),
    zona_interes: document.getElementById('pref-zona').value,
    updated_at: new Date().toISOString()
  };

  await sb.from('user_preferences').upsert(prefs, { onConflict: 'user_id' });
  userPreferences = prefs;
  alert('Preferencias guardadas.');
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
  const email = currentUser?.email || '';
  const initials = email.substring(0, 2).toUpperCase();
  const topbar = document.querySelector('.topbar-right');
  const existing = document.getElementById('user-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'user-menu';
  menu.className = 'user-menu';
  menu.innerHTML = `
    <div class="user-avatar" title="${email}">${initials}</div>
    <button class="btn-logout" onclick="logout()">Salir</button>
  `;
  topbar.prepend(menu);
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
  }
  // Si la app ya está visible (vino de OAuth redirect), inicializar dashboard
  if (!appEl.classList.contains('hidden')) {
    initDashboard();
  }
});