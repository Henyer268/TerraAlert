/* ═══════════════════════════════════════════
   terraALERT — sw.js  (Service Worker)
   Cache offline + Push Notifications
   ═══════════════════════════════════════════ */

const VERSION     = 'v2.9';
const CACHE_SHELL = `terraalert-shell-${VERSION}`;
const CACHE_DATA  = `terraalert-data-${VERSION}`;

/* ── Recursos estáticos a cachear al instalar ── */
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/public/icon-192.png',
  '/public/icon-512.png',
  /* CDN externos — se precargan para funcionar offline */
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Share+Tech+Mono&family=Inter:wght@300;400;500;600&display=swap',
];

/* ── Tile base URL de Carto (para cachear tiles de mapa) ── */
const TILE_ORIGIN = 'https://basemaps.cartocdn.com';


/* ═══════════════════════════════════════════
   INSTALL — precache shell
   ═══════════════════════════════════════════ */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_SHELL).then(cache => {
      /* addAll falla si alguna URL falla; usamos add individual con try/catch */
      return Promise.allSettled(
        SHELL_ASSETS.map(url =>
          cache.add(url).catch(() => console.warn(`[SW] No cacheado: ${url}`))
        )
      );
    }).then(() => self.skipWaiting())
  );
});


/* ═══════════════════════════════════════════
   ACTIVATE — limpiar caches viejos
   ═══════════════════════════════════════════ */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_SHELL && k !== CACHE_DATA)
          .map(k => {
            console.log(`[SW] Eliminando cache viejo: ${k}`);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});


/* ═══════════════════════════════════════════
   FETCH — estrategia por tipo de recurso
   ═══════════════════════════════════════════ */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* 1. Tiles del mapa: Cache-First con fallo silencioso */
  if (url.origin === TILE_ORIGIN) {
    event.respondWith(tileStrategy(request));
    return;
  }

  /* 2. API USGS o backend FastAPI: Network-First con fallback a cache */
  if (
    url.hostname.includes('usgs.gov') ||
    url.hostname.includes('onrender.com') ||
    url.pathname.startsWith('/sismos')
  ) {
    event.respondWith(networkFirstData(request));
    return;
  }

  /* 3. Supabase y OAuth redirects: siempre red */
  if (url.hostname.includes('supabase.co') ||
      url.search.includes('code=') ||
      url.hash.includes('access_token')) {
    return; /* dejar pasar sin interceptar */
  }

  /* 3.5 Nominatim: siempre red, nunca cache (búsquedas dinámicas) */
  if (url.hostname.includes('nominatim.openstreetmap.org')) {
    return; /* dejar pasar sin interceptar */
  }

  /* 4. Shell (HTML, CSS, JS, fuentes, iconos): Cache-First */
  event.respondWith(shellStrategy(request));
});


/* ── Estrategias ── */

async function shellStrategy(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type !== 'opaque') {
      const cache = await caches.open(CACHE_SHELL);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    /* Fallback offline: devolver index.html para cualquier navegación */
    if (request.mode === 'navigate') {
      return caches.match('/index.html');
    }
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirstData(request) {
  const cache = await caches.open(CACHE_DATA);
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    /* Respuesta offline vacía con estructura esperada */
    return new Response(
      JSON.stringify({ total: 0, sismos: [], offline: true }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function tileStrategy(request) {
  const cache = await caches.open(CACHE_DATA);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    /* Sin tile → transparente 1×1 px */
    return new Response(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
      { headers: { 'Content-Type': 'image/png' } }
    );
  }
}


/* ═══════════════════════════════════════════
   PUSH NOTIFICATIONS
   ═══════════════════════════════════════════ */
self.addEventListener('push', event => {
  let data = { title: 'terraALERT', body: 'Nuevo sismo detectado', mag: null };

  try { data = { ...data, ...event.data.json() }; } catch {}

  const mag   = data.mag || 0;
  const icon  = mag >= 7 ? '/public/icon-512.png' : '/public/icon-192.png';
const badge = '/public/icon-96.png';

  const title   = data.title || `🌍 Sismo M ${mag.toFixed(1)}`;
  const options = {
    body:    data.body || data.lugar || 'Ver detalles en terraALERT',
    icon,
    badge,
    tag:     `quake-${data.id || Date.now()}`,   /* agrupa notifs del mismo sismo */
    renotify: false,
    vibrate: mag >= 6 ? [200, 100, 200, 100, 400] : [200, 100, 200],
    data:    { url: data.url || '/', mag },
    actions: [
      { action: 'view', title: 'Ver mapa' },
      { action: 'dismiss', title: 'Cerrar' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const target = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      /* Si ya hay una ventana abierta, enfocarla */
      for (const client of list) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({ type: 'QUAKE_ALERT', url: target });
          return;
        }
      }
      /* Si no, abrir una nueva */
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});


/* ═══════════════════════════════════════════
   BACKGROUND SYNC (experimental)
   Reintenta fetch de datos cuando vuelve la red
   ═══════════════════════════════════════════ */
self.addEventListener('sync', event => {
  if (event.tag === 'sync-sismos') {
    event.waitUntil(
      fetch('https://terraalert-t7t5.onrender.com/sismos?minmagnitud=4.5&limite=150')
        .then(r => r.json())
        .then(data => {
          /* Notificar a los clientes abiertos */
          return clients.matchAll({ type: 'window' }).then(list => {
            list.forEach(c => c.postMessage({ type: 'SYNC_UPDATE', data }));
          });
        })
        .catch(() => {/* Silencioso si falla */})
    );
  }
});

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});