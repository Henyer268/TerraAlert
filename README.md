# terraALERT — Monitor Sísmico Global

> Aplicación web PWA de monitoreo sísmico en tiempo real con mapa interactivo, alertas push, zonas personalizadas por usuario y arquitectura full-stack distribuida.
---

## Tabla de Contenidos

- [Demo](#demo)
- [Características](#características)
- [Arquitectura](#arquitectura)
- [Stack Tecnológico](#stack-tecnológico)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Instalación y Desarrollo Local](#instalación-y-desarrollo-local)
- [Variables de Entorno](#variables-de-entorno)
- [Endpoints del Backend](#endpoints-del-backend)
- [Base de Datos (Supabase)](#base-de-datos-supabase)
- [Autenticación (Google OAuth)](#autenticación-google-oauth)
- [Notificaciones Push (Web Push / VAPID)](#notificaciones-push-web-push--vapid)
- [Despliegue](#despliegue)
- [Servicios Externos](#servicios-externos)

---

## Demo

| Servicio | URL |
|----------|-----|
| **Frontend (Vercel)** | `https://terraalert.vercel.app` |
| **Backend (Render)** | `https://terraalert-t7t5.onrender.com` |
| **Microservicio Java (Render)** | `https://terraalert-java.onrender.com` |

---

## Características

### Dashboard Global
- Mapa interactivo mundial con **Leaflet.js** (dark theme CartoDB)
- Visualización de sismos con círculos de color según magnitud (verde → amarillo → naranja → rojo)
- Tabla de eventos recientes con tiempo relativo, lugar y clasificación
- Estadísticas en tiempo real: total de eventos, magnitud promedio, sismo más fuerte, alertas de tsunami
- Auto-refresh cada 5 minutos

### Filtros
- Filtro por magnitud mínima
- Filtro por rango de tiempo (últimas 24h, 7 días, 30 días)
- Popups en el mapa con detalles completos de cada evento

### Mi Zona (requiere login)
- Sistema de múltiples zonas guardadas por usuario
- Cada zona tiene su propio **mini-mapa Leaflet** independiente
- Estadísticas por zona: total de eventos cercanos, magnitud máxima, magnitud promedio, último evento
- Radio de detección de **1000 km** usando la fórmula de Haversine
- Umbral de magnitud personalizable por zona
- Tabla de los 30 eventos más recientes dentro de cada zona
- CRUD completo de zonas guardadas en Supabase

### Notificaciones Push
- Alertas automáticas para sismos globales **≥ 6.0** de magnitud
- Alertas personalizadas por zona (umbral configurable por el usuario)
- Implementadas con **Web Push API + VAPID**
- Service Worker (`sw.js`) para recepción en background
- Deduplicación de notificaciones por `localStorage`

### Progressive Web App (PWA)
- Instalable en dispositivos móviles y desktop
- `manifest.json` con iconos en todos los tamaños (72 → 512px)
- Shortcuts de acceso rápido: "Alertas Críticas" y "Mapa Global"
- Service Worker con caché offline

### Autenticación
- **Google OAuth 2.0** vía Supabase Auth
- Login con modal persistente y redirección automática post-OAuth
- Manejo de race condition entre llegada del token y carga del DOM
- Sesión persistente por `sessionStorage`

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTE (Browser)                       │
│  index.html + app.js + style.css + sw.js (Service Worker)      │
│  Leaflet.js · Supabase JS Client · Web Push API                │
└─────────────────┬───────────────────────────┬───────────────────┘
                  │ fetch()                   │ Supabase JS SDK
                  ▼                           ▼
┌─────────────────────────┐     ┌─────────────────────────────────┐
│   Backend FastAPI        │     │       Supabase                  │
│   (Render / Python)      │     │  - Auth (Google OAuth)          │
│                          │     │  - DB: user_preferences         │
│  GET /sismos             │     │  - DB: push_subscriptions       │
│  GET /sismos/resumen     │     │  - RLS Policies                 │
│  GET /vapid-public-key   │     └─────────────────────────────────┘
│  POST /push/subscribe    │
│  POST /push/notify       │
│  APScheduler (5 min)     │
└─────────┬───────────────┘
          │ httpx
          ▼
┌─────────────────────────┐     ┌─────────────────────────────────┐
│  Microservicio Java      │     │       USGS Earthquake API       │
│  (Render)                │     │  earthquake.usgs.gov/fdsnws     │
│  POST /clasificar        │     │  (fuente primaria de sismos)    │
│  (magnitud → nivel)      │     └─────────────────────────────────┘
└─────────────────────────┘
```

### Flujo de datos
1. El frontend llama a `GET /sismos` en el backend FastAPI cada 5 minutos
2. El backend consulta la **USGS Earthquake API** y para cada sismo llama al **microservicio Java** para clasificarlo (`leve / moderado / fuerte / severo`)
3. Si el microservicio Java no responde, el backend usa un fallback local de clasificación
4. Si el backend no responde, el frontend consulta directamente a USGS como fallback
5. Los datos se renderizan en el mapa, tabla y estadísticas

---

## Stack Tecnológico

### Frontend
| Tecnología | Uso |
|-----------|-----|
| Vanilla JavaScript (ES6+) | Lógica principal |
| HTML5 / CSS3 | Estructura y estilos |
| [Leaflet.js](https://leafletjs.com/) | Mapas interactivos |
| [Supabase JS](https://supabase.com/docs/reference/javascript) | Auth + base de datos desde el cliente |
| Web Push API | Suscripción a notificaciones push |
| Service Worker | Cache offline + recepción de push |

### Backend
| Tecnología | Uso |
|-----------|-----|
| [FastAPI](https://fastapi.tiangolo.com/) | Framework principal |
| [httpx](https://www.python-httpx.org/) | Cliente HTTP async |
| [pywebpush](https://github.com/web-push-libs/pywebpush) | Envío de notificaciones VAPID |
| [APScheduler](https://apscheduler.readthedocs.io/) | Tarea periódica de verificación de sismos |
| uvicorn | Servidor ASGI |

### Servicios Cloud
| Servicio | Rol |
|---------|-----|
| **Vercel** | Hosting del frontend (static site) |
| **Render** | Hosting del backend FastAPI y microservicio Java |
| **Supabase** | Base de datos PostgreSQL + Auth + RLS |
| **Google Cloud** | OAuth 2.0 (Google Sign-In) |
| **GitHub** | Control de versiones y CI/CD |
| **USGS** | Fuente de datos sísmicos en tiempo real |

---

## Estructura del Proyecto

```
Proyecto TerraAlert/
├── index.html              # SPA principal — todo el HTML de la app
├── app.js                  # Lógica frontend (mapa, auth, Mi Zona, push, filtros)
├── style.css               # Estilos globales (dark theme, responsive)
├── sw.js                   # Service Worker (cache + push notifications)
├── manifest.json           # Web App Manifest (PWA)
├── backend/
│   ├── main.py             # Backend FastAPI (endpoints + APScheduler)
│   └── requirements.txt    # Dependencias Python
├── public/
│   └── icon-*.png          # Íconos PWA (72, 96, 128, 144, 152, 192, 384, 512)
├── screenshots/
│   ├── desktop.png
│   └── mobile.png
└── .gitignore
```

---

## Instalación y Desarrollo Local

### Requisitos
- Python 3.10+
- Node.js (opcional, solo si usas live-server)
- Cuenta en Supabase, Google Cloud y Render

### 1. Clonar el repositorio

```bash
git clone https://github.com/tu-usuario/terraalert.git
cd terraalert
```

### 2. Configurar el backend

```bash
cd backend
python -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Crear un archivo `.env` dentro de `backend/`:

```env
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_KEY=tu-anon-key
VAPID_PRIVATE_KEY=tu-vapid-private-key
VAPID_PUBLIC_KEY=tu-vapid-public-key
VAPID_EMAIL=mailto:tu@email.com
JAVA_SERVICE=https://terraalert-java.onrender.com
```

Iniciar el backend:

```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### 3. Servir el frontend

Opción A — con Live Server (VS Code):
- Abrir `index.html` con Live Server en el puerto 5500

Opción B — con Python:
```bash
python -m http.server 5500
```

El frontend detecta automáticamente si está en `localhost` y usa `http://127.0.0.1:8000` como backend.

---

## Variables de Entorno

### Backend (`backend/.env`)

| Variable | Descripción |
|---------|-------------|
| `SUPABASE_URL` | URL de tu proyecto Supabase |
| `SUPABASE_KEY` | Anon key de Supabase |
| `VAPID_PRIVATE_KEY` | Clave privada VAPID para Web Push |
| `VAPID_PUBLIC_KEY` | Clave pública VAPID (también usada en el frontend) |
| `VAPID_EMAIL` | Email del contacto VAPID (`mailto:...`) |
| `JAVA_SERVICE` | URL del microservicio Java de clasificación |

### Frontend (`app.js`)

Las siguientes constantes están definidas directamente en `app.js` (reemplaza con tus valores):

```javascript
const SUPABASE_URL = 'https://tu-proyecto.supabase.co';
const SUPABASE_KEY = 'tu-anon-key';
const BACKEND_URL  = /* auto-detectado */ 'https://tu-backend.onrender.com';
```

---

## Endpoints del Backend

Base URL en producción: `https://terraalert-t7t5.onrender.com`

| Método | Endpoint | Descripción |
|--------|---------|-------------|
| `GET` | `/` | Health check |
| `GET` | `/sismos` | Lista de sismos recientes. Query params: `minmagnitud`, `limite` |
| `GET` | `/sismos/resumen` | Estadísticas generales (total, mag promedio, mag máxima) |
| `GET` | `/vapid-public-key` | Retorna la clave pública VAPID |
| `POST` | `/push/subscribe` | Registra una suscripción push (body: objeto PushSubscription) |
| `POST` | `/push/notify` | Envía una notificación push. Body: `{ title, body, mag, id, url }` |

---

## Base de Datos (Supabase)

### Tabla `user_preferences`

Almacena las zonas guardadas de cada usuario.

| Columna | Tipo | Descripción |
|--------|------|-------------|
| `id` | `uuid` | PK auto-generado |
| `user_id` | `uuid` | FK → `auth.users.id` |
| `pais` | `text` | País de la zona |
| `ciudad` | `text` | Ciudad (opcional) |
| `lat` | `float` | Latitud del centro de la zona |
| `lng` | `float` | Longitud del centro de la zona |
| `umbral_magnitud` | `float` | Magnitud mínima para alertas (default 5.0) |
| `zona_label` | `text` | Etiqueta personalizada |
| `created_at` | `timestamp` | Fecha de creación |

### Tabla `push_subscriptions`

Almacena las suscripciones Web Push de los usuarios.

| Columna | Tipo | Descripción |
|--------|------|-------------|
| `id` | `uuid` | PK auto-generado |
| `user_id` | `uuid` | FK → `auth.users.id` (nullable para subs anónimas) |
| `endpoint` | `text` | Endpoint único de la suscripción push |
| `subscription` | `jsonb` | Objeto PushSubscription completo |
| `created_at` | `timestamp` | Fecha de creación |

### Políticas RLS

Ambas tablas tienen **Row Level Security** activado:
- Los usuarios solo pueden leer, insertar y eliminar sus propias filas (`user_id = auth.uid()`)

---

## Autenticación (Google OAuth)

La autenticación usa **Supabase Auth con proveedor Google**.

### Configuración en Google Cloud Console
1. Crear un proyecto en [Google Cloud Console](https://console.cloud.google.com/)
2. Habilitar **Google+ API** / **Google Identity**
3. Crear credenciales OAuth 2.0 (tipo: Aplicación Web)
4. Agregar como orígenes autorizados: `https://tu-proyecto.vercel.app` y `http://localhost:5500`
5. Agregar como URI de redirección: `https://oajhwwplkmwdwljokhvk.supabase.co/auth/v1/callback`

### Configuración en Supabase
1. Authentication → Providers → Google
2. Pegar el **Client ID** y **Client Secret** de Google Cloud
3. Guardar

### Flujo de login en la app
```
Usuario hace clic en "Iniciar sesión con Google"
→ sb.auth.signInWithOAuth({ provider: 'google', redirectTo: window.location.origin })
→ Redirige a Google
→ Google redirige a Supabase callback
→ Supabase redirige al frontend con token en la URL
→ app.js detecta `access_token` en el hash y salta el intro
→ sb.auth.onAuthStateChange() establece la sesión
```

---

## Notificaciones Push (Web Push / VAPID)

### Generar claves VAPID

```bash
pip install pywebpush
python -c "from pywebpush import vapid; v = vapid.Vapid(); v.generate_keys(); print('Private:', v.private_pem); print('Public:', v.public_key.public_bytes(...))"
```

O usar [web-push-codelab.glitch.me](https://web-push-codelab.glitch.me/) para generar el par de claves.

### Flujo de suscripción
1. El frontend solicita permiso de notificaciones al usuario
2. Se suscribe al Service Worker con la clave pública VAPID (`/vapid-public-key`)
3. El objeto `PushSubscription` se envía a `POST /push/subscribe`
4. El backend lo guarda en Supabase (`push_subscriptions`)
5. Cada 5 minutos, APScheduler verifica sismos severos y envía push a todos los suscriptores relevantes

---

## Despliegue

### Frontend → Vercel

1. Conectar el repositorio de GitHub a [Vercel](https://vercel.com/)
2. Framework Preset: **Other** (sitio estático)
3. Build Command: *(vacío)*
4. Output Directory: `.` (raíz del proyecto)
5. Las variables de entorno del frontend están hardcoded en `app.js`

### Backend → Render

1. Crear un nuevo **Web Service** en [Render](https://render.com/)
2. Conectar el repositorio, apuntar a la carpeta `backend/`
3. Runtime: **Python 3**
4. Build Command: `pip install -r requirements.txt`
5. Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
6. Agregar las variables de entorno del backend en el dashboard de Render

### Microservicio Java → Render

1. Crear otro Web Service en Render apuntando al repo del microservicio Java
2. Start Command según el framework usado (Spring Boot, Quarkus, etc.)
3. Asegurarse que exponga `POST /clasificar` con body `{ magnitud: float }`

---

## Servicios Externos

| Servicio | Para qué se usa | Documentación |
|---------|----------------|--------------|
| [USGS Earthquake API](https://earthquake.usgs.gov/fdsnws/event/1/) | Fuente principal de datos sísmicos en tiempo real | [Docs](https://earthquake.usgs.gov/fdsnws/event/1/) |
| [Supabase](https://supabase.com/) | Base de datos PostgreSQL + autenticación | [Docs](https://supabase.com/docs) |
| [Google Cloud](https://console.cloud.google.com/) | Proveedor OAuth 2.0 para login con Google | [Docs](https://developers.google.com/identity) |
| [Vercel](https://vercel.com/) | Hosting del frontend con CDN global | [Docs](https://vercel.com/docs) |
| [Render](https://render.com/) | Hosting del backend FastAPI y microservicio Java | [Docs](https://render.com/docs) |
| [CartoDB Basemaps](https://carto.com/basemaps/) | Tiles del mapa oscuro para Leaflet | — |

---

## Autores

**Henyer Melendez** **Darilith Ferrer** **Estiven Leon** **Jeison Garcia** — Proyecto académico / personal  
Universidad · Ingeniería de Sistemas

---

## Licencia

Este proyecto es de uso académico/personal. No se distribuye con una licencia open-source formal.