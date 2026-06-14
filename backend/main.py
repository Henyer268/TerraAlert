from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import httpx
from datetime import datetime, timedelta

app = FastAPI(title="terraALERT API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

USGS_URL     = "https://earthquake.usgs.gov/fdsnws/event/1/query"
JAVA_SERVICE = "https://terraalert-java.onrender.com"

VAPID_PRIVATE_KEY = "2aGVAkMy6sLh_NYV_rgCgbGKnZyJ_JefclrIGrCt_Rc"
VAPID_PUBLIC_KEY  = "BGksutg_PEWXhXQ9abTjm8VupjYOcWbiHKge0zABrG_1hbCJJXp6Ke-A9hoo7K63Wl7T6YXHXahVx7V8RCcS2PY"
VAPID_CLAIMS      = {"sub": "mailto:ais123k2k@gmail.com"}

SUPABASE_URL = "https://oajhwwplkmwdwljokhvk.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hamh3d3Bsa213ZHdsam9raHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NDcxMjcsImV4cCI6MjA5NjQyMzEyN30.M7msv2z_hgpYfjcH0JdWkPUb3olKv66cr7YyJ_fQIqo"
SUPABASE_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}


def clasificar_magnitud(mag: float) -> str:
    """Fallback local si el microservicio Java no responde."""
    if mag < 3.0:   return "leve"
    elif mag < 5.0: return "moderado"
    elif mag < 7.0: return "fuerte"
    else:           return "severo"


async def clasificar_con_java(mag: float) -> dict:
    """Llama al microservicio Java. Si falla, usa el fallback local."""
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.post(f"{JAVA_SERVICE}/clasificar", json={"magnitud": mag})
            if resp.status_code == 200:
                return resp.json()
    except Exception:
        pass
    return {
        "clasificacion": clasificar_magnitud(mag),
        "color": "#60a5fa",
        "nivel": 0,
        "descripcion": ""
    }


def limpiar_sismo(feature: dict, clasificacion_data: dict) -> dict:
    props  = feature["properties"]
    coords = feature["geometry"]["coordinates"]
    mag    = props.get("mag") or 0.0

    return {
        "id":             feature["id"],
        "magnitud":       round(mag, 1),
        "clasificacion":  clasificacion_data.get("clasificacion", clasificar_magnitud(mag)),
        "color":          clasificacion_data.get("color", "#60a5fa"),
        "nivel":          clasificacion_data.get("nivel", 0),
        "descripcion":    clasificacion_data.get("descripcion", ""),
        "lugar":          props.get("place", "Desconocido"),
        "hora":           datetime.utcfromtimestamp(props["time"] / 1000).isoformat(),
        "profundidad_km": round(coords[2], 1) if coords[2] is not None else None,
        "latitud":        coords[1],
        "longitud":       coords[0],
        "alerta":         props.get("alert"),
        "tsunami":        props.get("tsunami", 0) == 1,
        "url_usgs":       props.get("url"),
    }


async def get_subscriptions_from_supabase() -> list:
    """Obtiene todas las suscripciones guardadas en Supabase."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"{SUPABASE_URL}/rest/v1/push_subscriptions?select=subscription",
                headers=SUPABASE_HEADERS
            )
            if resp.status_code == 200:
                rows = resp.json()
                return [row["subscription"] for row in rows]
    except Exception as e:
        print(f"[Supabase] Error obteniendo suscripciones: {e}")
    return []


async def save_subscription_to_supabase(sub: dict):
    """Guarda una suscripción en Supabase (ignora duplicados por endpoint)."""
    endpoint = sub.get("endpoint", "")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            # Verificar si ya existe
            check = await client.get(
                f"{SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.{endpoint}&select=id",
                headers=SUPABASE_HEADERS
            )
            if check.status_code == 200 and check.json():
                return  # ya existe, no duplicar

            # Insertar nueva
            await client.post(
                f"{SUPABASE_URL}/rest/v1/push_subscriptions",
                headers=SUPABASE_HEADERS,
                json={"endpoint": endpoint, "subscription": sub}
            )
    except Exception as e:
        print(f"[Supabase] Error guardando suscripción: {e}")


@app.get("/")
def root():
    return {"status": "ok", "app": "terraALERT API"}


@app.get("/sismos")
async def get_sismos(
    minmagnitud: float = Query(default=4.5),
    horas:       int   = Query(default=24),
    limite:      int   = Query(default=100),
):
    inicio = (datetime.utcnow() - timedelta(hours=horas)).strftime("%Y-%m-%dT%H:%M:%S")
    params = {
        "format":       "geojson",
        "starttime":    inicio,
        "minmagnitude": minmagnitud,
        "orderby":      "time",
        "limit":        limite,
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(USGS_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    sismos = []
    for f in data["features"]:
        mag  = (f["properties"].get("mag") or 0.0)
        clas = await clasificar_con_java(mag)
        sismos.append(limpiar_sismo(f, clas))

    return {
        "total":    len(sismos),
        "sismos":   sismos,
        "generado": datetime.utcnow().isoformat(),
    }


@app.get("/sismos/resumen")
async def get_resumen():
    params = {
        "format":       "geojson",
        "starttime":    (datetime.utcnow() - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%S"),
        "minmagnitude": 2.5,
        "orderby":      "time",
        "limit":        1000,
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(USGS_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    sismos = []
    for f in data["features"]:
        mag  = (f["properties"].get("mag") or 0.0)
        clas = await clasificar_con_java(mag)
        sismos.append(limpiar_sismo(f, clas))

    if not sismos:
        return {"total": 0}

    mags      = [s["magnitud"] for s in sismos]
    max_sismo = max(sismos, key=lambda s: s["magnitud"])

    zonas = {}
    for s in sismos:
        zona = s["lugar"].split(", ")[-1]
        zonas[zona] = zonas.get(zona, 0) + 1
    zona_top = max(zonas, key=zonas.get)

    conteo = {"leve": 0, "moderado": 0, "fuerte": 0, "severo": 0}
    for s in sismos:
        c = s["clasificacion"]
        if c in conteo:
            conteo[c] += 1

    return {
        "total":             len(sismos),
        "magnitud_maxima":   round(max(mags), 1),
        "magnitud_promedio": round(sum(mags) / len(mags), 1),
        "sismo_mayor":       max_sismo,
        "zona_mas_activa":   zona_top,
        "sismos_zona_top":   zonas[zona_top],
        "por_clasificacion": conteo,
        "generado":          datetime.utcnow().isoformat(),
    }


from pywebpush import webpush, WebPushException
import json


@app.get("/vapid-public-key")
def get_vapid_key():
    return {"key": VAPID_PUBLIC_KEY}


@app.post("/push/subscribe")
async def subscribe(sub: dict):
    await save_subscription_to_supabase(sub)
    subscriptions = await get_subscriptions_from_supabase()
    return {"ok": True, "total": len(subscriptions)}


@app.post("/push/notify")
async def notify(payload: dict):
    subscriptions = await get_subscriptions_from_supabase()
    data   = json.dumps(payload)
    failed = []
    for sub in subscriptions:
        try:
            webpush(
                subscription_info=sub,
                data=data,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=VAPID_CLAIMS
            )
        except WebPushException as e:
            failed.append(str(e))
    return {"enviados": len(subscriptions) - len(failed), "errores": failed}