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
    # Fallback
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

    # Clasificar cada sismo con el microservicio Java
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