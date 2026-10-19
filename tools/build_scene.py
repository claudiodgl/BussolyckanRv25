"""
build_scene.py — one-shot data prep for the Rv25 story map.

Reads a cached city model (OSM buildings, transit schedules) and bakes a
single regional scene for the 5 Oct 2026 bus accident on riksväg 25:

    static/data/scene.json        places, routes, missions, events, transit
    static/data/buildings.geojson 3D footprints for the involved cities

Network access happens ONLY here (OSRM road routes, vendored JS libs) and
everything is cached under cache/, so re-runs are offline. The browser app
itself reads only static/ (basemap tiles excepted).

    python tools/build_scene.py --city-model C:/path/to/city-model
"""
from __future__ import annotations

import argparse
import ast
import json
import math
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache"
OUT = ROOT / "static" / "data"
VENDOR = ROOT / "static" / "vendor"
UA = "rv25-story-prep/0.1 (claudio.linhares@lnu.se)"

# ── Places ───────────────────────────────────────────────────────────────────
# approx=True → position is a stand-in (e.g. ambulance base placed at its
# hospital); shown with a dashed ring + "ungefärligt läge" in the UI.
PLACES = {
    "vxo_hosp": dict(kind="hospital", sv="Växjö sjukhus (Centrallasarettet)", en="Växjö Hospital (Centrallasarettet)",
                     lat=56.87400, lon=14.80587, approx=False, src="OSM"),
    "lby_hosp": dict(kind="hospital", sv="Ljungby lasarett", en="Ljungby Hospital",
                     lat=56.83586, lon=13.93598, approx=False, src="OSM"),
    "vmo_hosp": dict(kind="hospital", sv="Värnamo sjukhus", en="Värnamo Hospital",
                     lat=57.17364, lon=14.02912, approx=False, src="OSM"),
    "kkr_hosp": dict(kind="hospital", sv="Blekingesjukhuset Karlskrona", en="Blekinge Hospital, Karlskrona",
                     lat=56.18201, lon=15.60523, approx=False, src="OSM"),
    "lnd_hosp": dict(kind="hospital", sv="Skånes universitetssjukhus, Lund", en="Skåne University Hospital, Lund",
                     lat=55.71313, lon=13.20000, approx=False, src="OSM"),
    "lkp_hosp": dict(kind="hospital", sv="Universitetssjukhuset i Linköping", en="Linköping University Hospital",
                     lat=58.40143, lon=15.62014, approx=False, src="OSM"),
    "skarvet": dict(kind="clinic", sv="Vårdcentralen Skärvet", en="Skärvet Health Centre",
                    lat=56.87380, lon=14.78800, approx=True, src="1177: Södra Järnvägsgatan 22"),
    "vxo_amb": dict(kind="ambulance_base", sv="Ambulans Växjö", en="Ambulance base Växjö",
                    lat=56.87530, lon=14.80300, approx=True, src="placed at hospital"),
    "alv_amb": dict(kind="ambulance_base", sv="Ambulans Alvesta", en="Ambulance base Alvesta",
                    lat=56.89976, lon=14.55465, approx=True, src="placed at town centre"),
    "lby_amb": dict(kind="ambulance_base", sv="Ambulans Ljungby", en="Ambulance base Ljungby",
                    lat=56.83450, lon=13.93900, approx=True, src="placed at hospital"),
    "alm_amb": dict(kind="ambulance_base", sv="Ambulans Älmhult", en="Ambulance base Älmhult",
                    lat=56.55130, lon=14.13730, approx=True, src="placed at town centre"),
    "vmo_amb": dict(kind="ambulance_base", sv="Ambulans Värnamo (Region Jönköping)", en="Ambulance base Värnamo (Region Jönköping)",
                    lat=57.17250, lon=14.03150, approx=True, src="placed at hospital"),
    "ron_sar": dict(kind="heli_base", sv="Sjöfartsverkets helikopterbas Ronneby", en="Swedish Maritime Admin. SAR base, Ronneby",
                    lat=56.26862, lon=15.27268, approx=True, src="placed at Ronneby Airport"),
    "vxo_fire": dict(kind="fire_base", sv="Räddningstjänsten Växjö", en="Fire & Rescue Växjö",
                     lat=56.88900, lon=14.78300, approx=True, src="approximate"),
    "alv_fire": dict(kind="fire_base", sv="Räddningstjänsten Alvesta", en="Fire & Rescue Alvesta",
                     lat=56.89700, lon=14.55900, approx=True, src="approximate"),
    "vxo_pol": dict(kind="police", sv="Polisen Växjö", en="Police Växjö",
                    lat=56.87900, lon=14.81200, approx=True, src="approximate"),
    "vxo_resc": dict(kind="station", sv="Växjö resecentrum", en="Växjö travel centre",
                     lat=56.87730, lon=14.80450, approx=False, src="OSM"),
    "kvalleberg": dict(kind="junction", sv="Kvälleberg", en="Kvälleberg",
                       lat=56.89316, lon=14.72363, approx=False, src="OSM"),
    "hanaslov": dict(kind="junction", sv="Trafikplats Hanaslöv", en="Hanaslöv interchange",
                     lat=56.92074, lon=14.59543, approx=False, src="OSM"),
    "langstorp": dict(kind="locality", sv="Långstorp", en="Långstorp",
                      lat=56.90575, lon=14.67163, approx=False, src="OSM"),
    "ljungby": dict(kind="town", sv="Ljungby", en="Ljungby", lat=56.83259, lon=13.93599, approx=False, src="OSM"),
}

# ── Helpers ──────────────────────────────────────────────────────────────────
def fetch(url: str, dest: Path) -> bytes:
    if dest.exists():
        return dest.read_bytes()
    print("  fetch", url)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return data


def haversine(a, b):
    R = 6371000.0
    la1, lo1, la2, lo2 = map(math.radians, (a[1], a[0], b[1], b[0]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def cumlen(coords):
    out, s = [0.0], 0.0
    for i in range(1, len(coords)):
        s += haversine(coords[i - 1], coords[i])
        out.append(round(s, 1))
    return out


def simplify(pts, tol):
    """Douglas–Peucker on planar-ish coords (tol in coord units)."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i0, i1 = stack.pop()
        ax, ay = pts[i0]; bx, by = pts[i1]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy or 1e-18
        best, bi = -1.0, -1
        for i in range(i0 + 1, i1):
            px, py = pts[i]
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
            d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > best:
                best, bi = d, i
        if best > tol * tol and bi > 0:
            keep[bi] = True
            stack += [(i0, bi), (bi, i1)]
    return [p for p, k in zip(pts, keep) if k]


def osrm(a, b, name, via=None):
    pts = [a] + (via or []) + [b]
    coord = ";".join(f"{p[0]:.6f},{p[1]:.6f}" for p in pts)
    url = f"https://router.project-osrm.org/route/v1/driving/{coord}?overview=full&geometries=geojson"
    data = json.loads(fetch(url, CACHE / "osrm" / f"{name}.json"))
    r = data["routes"][0]
    coords = [[round(x, 6), round(y, 6)] for x, y in r["geometry"]["coordinates"]]
    return coords, r["duration"], r["distance"]


def ll(pid):
    p = PLACES[pid]
    return [p["lon"], p["lat"]]


def hm(m):
    m = int(round(m))
    return f"{(m // 60) % 24:02d}:{m % 60:02d}"


# ── City-model readers ───────────────────────────────────────────────────────
def model_cities(src: Path) -> dict:
    src = (src / "osm.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    for node in tree.body:
        if isinstance(node, ast.AnnAssign) and getattr(node.target, "id", "") == "CITIES":
            return ast.literal_eval(node.value)
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "CITIES" for t in node.targets):
            return ast.literal_eval(node.value)
    raise RuntimeError("CITIES not found in osm.py")


def make_unproject(clat, clon):
    mplx = 111_320.0 * math.cos(math.radians(clat))
    def f(x, z):
        return [round(clon + x / mplx, 6), round(clat - z / 111_320.0, 6)]
    return f


def bake_buildings(src: Path, cities: dict, ids: list[str]):
    feats = []
    for cid in ids:
        cj = src / "data" / cid / "city.json"
        if not cj.exists():
            print("  (skip buildings, missing)", cj)
            continue
        c = cities[cid]
        unp = make_unproject(c["center_lat"], c["center_lon"])
        data = json.loads(cj.read_text(encoding="utf-8"))
        n = 0
        for b in data["buildings"]:
            if "tree_species" in b or "water_type" in b:
                continue
            if b.get("area_m2", 0) > 40000 or not b.get("polygon"):
                continue
            ring = [[round(a, 5), round(b_, 5)] for a, b_ in (unp(x, z) for x, z in simplify(b["polygon"], 0.6))]
            if len(ring) < 3:
                continue
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            lv = max(1, int(b.get("levels") or 1))
            feats.append({"type": "Feature",
                          "properties": {"h": round(min(lv, 30) * 3.2, 1), "c": cid},
                          "geometry": {"type": "Polygon", "coordinates": [ring]}})
            n += 1
        print(f"  buildings {cid}: {n}")
    return {"type": "FeatureCollection", "features": feats}


def bake_transit(src: Path, cities: dict, ids: list[str], t0: int, t1: int):
    """Local buses/trams/trains from the city model's schedules, restricted to [t0,t1]."""
    lines, trips = [], []
    for cid in ids:
        sp = src / "data" / cid / "transport_schedule.json"
        if not sp.exists():
            continue
        c = cities[cid]
        unp = make_unproject(c["center_lat"], c["center_lon"])
        s = json.loads(sp.read_text(encoding="utf-8"))
        used = {}
        for t in s["trips"]:
            vt = t["vehicle_type"]
            if vt not in ("bus", "train", "tram"):
                continue
            if t["arrive_minute"] < t0 or t["depart_minute"] > t1:
                continue
            used.setdefault(t["line_id"], []).append(t)
        by_id = {l["id"]: l for l in s["lines"]}
        for lid, ts in used.items():
            l = by_id.get(lid)
            if not l or len(l["polyline"]) < 2:
                continue
            tol = 8.0 if l.get("is_intercity") else 3.0
            coords = [unp(x, z) for x, z in simplify(l["polyline"], tol)]
            key = f"{cid}:{lid}"
            lines.append({"id": key, "type": l["type"], "city": cid,
                          "intercity": bool(l.get("is_intercity")), "coords": coords, "cum": cumlen(coords)})
            for t in ts:
                rev = t["direction"] in ("backward", "in")
                trips.append([key, t["depart_minute"], t["arrive_minute"], 1 if rev else 0])
        print(f"  transit {cid}: {len(used)} lines")
    trips.sort(key=lambda r: r[1])
    return lines, trips


# ── Story: missions + events ─────────────────────────────────────────────────
T_CRASH = 16 * 60 + 30  # 990


def build_story():
    routes = {}

    def route(name, a, b, via=None):
        if name not in routes:
            coords, dur, dist = osrm(a, b, name, via)
            routes[name] = {"coords": coords, "cum": cumlen(coords), "dur": round(dur), "dist": round(dist)}
        return routes[name]

    # Line 845 Växjö → Ljungby along rv25. The crash point is the first
    # westbound vertex past Långstorp ("strax efter Långstorp", SR P4).
    r845 = route("line845_full", ll("vxo_resc"), ll("ljungby"))
    k = next(i for i, p in enumerate(r845["coords"]) if p[0] <= 14.6600)
    crash = r845["coords"][k]
    PLACES["crash"] = dict(kind="crash", sv="Olycksplatsen, rv 25", en="Accident site, Rv 25",
                           lat=crash[1], lon=crash[0], approx=True,
                           src="between Kvälleberg and Hanaslöv, just past Långstorp")
    pre = r845["coords"][: k + 1]
    routes["line845"] = {"coords": pre, "cum": cumlen(pre), "dur": None, "dist": round(cumlen(pre)[-1])}

    # Closed stretch Kvälleberg → Hanaslöv (westbound), from the 845 line.
    i_k = min(range(len(r845["coords"])), key=lambda i: haversine(r845["coords"][i], ll("kvalleberg")))
    i_h = min(range(len(r845["coords"])), key=lambda i: haversine(r845["coords"][i], ll("hanaslov")))
    closure = r845["coords"][min(i_k, i_h): max(i_k, i_h) + 1]
    # Fallback: if 845 doesn't pass Hanaslöv (it heads to Ljungby) route it.
    if len(closure) < 5 or haversine(closure[-1], ll("hanaslov")) > 1500:
        closure = route("closure", ll("kvalleberg"), ll("hanaslov"))["coords"]

    C = [crash[0], crash[1]]
    # A point on the eastbound side so routes leaving towards Växjö don't
    # detour to the next interchange (the median barrier was cut open).
    C_east = [crash[0] + 0.0003, crash[1] - 0.00025]

    missions, events = [], []
    BLUE = 0.80   # blue-light driving vs OSRM car time
    LOADED = 0.95  # patient transport, smoother driving

    def drive(seq, name, a, b, t, factor):
        r = route(name, a, b)
        dt = r["dur"] / 60.0 * factor
        seq.append({"type": "drive", "route": name, "t0": round(t, 2), "t1": round(t + dt, 2)})
        return t + dt

    def hold(seq, at, t0, t1, note=None):
        seq.append({"type": "hold", "at": at, "t0": round(t0, 2), "t1": round(t1, 2), **({"note": note} if note else {})})
        return t1

    def ambulance(mid, base, runs, dispatch, sv, en, mutual=False):
        """runs: list of (dest_place, depart_scene_minute, n_patients)."""
        seq, t = [], dispatch
        t = hold(seq, ll(base), dispatch - 1, dispatch)
        t = drive(seq, f"{mid}_to_scene", ll(base), C, t, BLUE)
        arrivals = []
        for j, (dest, dep, n) in enumerate(runs):
            t = hold(seq, C, t, max(t + 6, dep), "load")
            t = drive(seq, f"{mid}_r{j}_{dest}", C_east, ll(dest), t, LOADED)
            arrivals.append({"place": dest, "t": round(t, 2), "n": n})
            t = hold(seq, ll(dest), t, t + 12, "handover")
            if j < len(runs) - 1:
                t = drive(seq, f"{mid}_r{j}_back", ll(dest), C, t, BLUE)
        missions.append({"id": mid, "vehicle": "ambulance", "sv": sv, "en": en, "base": base,
                         "mutual_aid": mutual, "seq": seq, "arrivals": arrivals, "estimated": True})

    # Ambulance plan: patient COUNTS per hospital are documented (Region
    # Kronoberg press release 22:44); unit assignment + times are modelled.
    ambulance("amb_v1", "vxo_amb", [("vxo_hosp", 17 * 60 + 2, 1), ("vxo_hosp", 0, 1)], T_CRASH + 3, "Ambulans Växjö 1", "Ambulance Växjö 1")
    ambulance("amb_a1", "alv_amb", [("vxo_hosp", 17 * 60 + 0, 1), ("vxo_hosp", 0, 1)], T_CRASH + 3, "Ambulans Alvesta", "Ambulance Alvesta")
    ambulance("amb_v2", "vxo_amb", [("vxo_hosp", 17 * 60 + 1, 1)], T_CRASH + 5, "Ambulans Växjö 2", "Ambulance Växjö 2")
    ambulance("amb_v3", "vxo_amb", [("vxo_hosp", 17 * 60 + 15, 1)], T_CRASH + 8, "Ambulans Växjö 3", "Ambulance Växjö 3")
    ambulance("amb_v4", "vxo_amb", [("vxo_hosp", 17 * 60 + 22, 1)], T_CRASH + 14, "Ambulans Växjö 4 (förstärkning)", "Ambulance Växjö 4 (reinforcement)")
    ambulance("amb_m1", "alm_amb", [("vxo_hosp", 17 * 60 + 35, 1)], T_CRASH + 10, "Ambulans Älmhult", "Ambulance Älmhult")
    ambulance("amb_l1", "lby_amb", [("lby_hosp", 17 * 60 + 25, 1)], T_CRASH + 4, "Ambulans Ljungby 1", "Ambulance Ljungby 1")
    ambulance("amb_l2", "lby_amb", [("lby_hosp", 17 * 60 + 32, 1)], T_CRASH + 7, "Ambulans Ljungby 2", "Ambulance Ljungby 2")
    ambulance("amb_j1", "vmo_amb", [("vmo_hosp", 17 * 60 + 40, 1)], T_CRASH + 12, "Ambulans Värnamo 1", "Ambulance Värnamo 1", mutual=True)
    ambulance("amb_j2", "vmo_amb", [("vmo_hosp", 17 * 60 + 48, 1)], T_CRASH + 15, "Ambulans Värnamo 2", "Ambulance Värnamo 2", mutual=True)

    # dep=0 on a second run means "leave after a 6-minute load" (see hold).

    # Sjöfartsverket SAR helicopter (documented: took part, flew one patient
    # to Karlskrona). Straight-line flight at ~240 km/h; times modelled.
    def fly(seq, a, b, t, kmh=240.0):
        d = haversine(a, b)
        dt = d / (kmh / 3.6) / 60.0
        seq.append({"type": "fly", "a": a, "b": b, "t0": round(t, 2), "t1": round(t + dt, 2)})
        return t + dt
    seq, t = [], T_CRASH + 9
    t = hold(seq, ll("ron_sar"), t - 1, t + 8, "start-up")
    t = fly(seq, ll("ron_sar"), C, t)
    t = hold(seq, C, t, t + 22, "load")
    t = fly(seq, C, ll("kkr_hosp"), t)
    heli_arr = round(t, 2)
    t = hold(seq, ll("kkr_hosp"), t, t + 15, "handover")
    t = fly(seq, ll("kkr_hosp"), ll("ron_sar"), t)
    missions.append({"id": "heli", "vehicle": "helicopter", "sv": "Räddningshelikopter (Sjöfartsverket)",
                     "en": "Rescue helicopter (Swedish Maritime Admin.)", "base": "ron_sar", "seq": seq,
                     "arrivals": [{"place": "kkr_hosp", "t": heli_arr, "n": 1}], "estimated": True})

    # Rescue services + police: arrive, stay until wind-down (19:30, SMP).
    def unit(mid, vehicle, base, dispatch, leave, sv, en):
        seq, t = [], dispatch
        t = hold(seq, ll(base), dispatch - 1, dispatch)
        t = drive(seq, f"{mid}_to_scene", ll(base), C, t, BLUE)
        t = hold(seq, C, t, leave, "on scene")
        t = drive(seq, f"{mid}_home", C_east, ll(base), t, 1.0)
        missions.append({"id": mid, "vehicle": vehicle, "sv": sv, "en": en, "base": base, "seq": seq,
                         "arrivals": [], "estimated": True})
    unit("fire_v1", "fire", "vxo_fire", T_CRASH + 2, 19 * 60 + 35, "Räddningstjänst Växjö 1", "Fire & Rescue Växjö 1")
    unit("fire_v2", "fire", "vxo_fire", T_CRASH + 4, 19 * 60 + 50, "Räddningstjänst Växjö 2", "Fire & Rescue Växjö 2")
    unit("fire_a1", "fire", "alv_fire", T_CRASH + 2, 19 * 60 + 40, "Räddningstjänst Alvesta", "Fire & Rescue Alvesta")
    unit("pol_1", "police", "vxo_pol", T_CRASH + 3, 23 * 60 + 30, "Polis 1", "Police 1")
    unit("pol_2", "police", "vxo_pol", T_CRASH + 6, 22 * 60 + 15, "Polis 2", "Police 2")

    # Lightly injured: by bus to Skärvet (documented); times modelled.
    seq, t = [], 17 * 60 + 25
    t = hold(seq, ll("vxo_resc"), t - 1, t)
    t = drive(seq, "relief_bus_to_scene", ll("vxo_resc"), C, t, 1.0)
    t = hold(seq, C, t, t + 20, "boarding")
    t = drive(seq, "relief_bus_skarvet", C_east, ll("skarvet"), t, 1.0)
    missions.append({"id": "relief_bus", "vehicle": "bus", "sv": "Buss med lindrigt skadade → Skärvet",
                     "en": "Bus with lightly injured → Skärvet", "base": "vxo_resc", "seq": seq,
                     "arrivals": [{"place": "skarvet", "t": round(t, 2), "n": 0, "light": True}], "estimated": True})

    # Onward transfers (Region Kronoberg: "några skickades senare vidare
    # till Linköping och Lund"). Times unknown → placed in the evening.
    for mid, dest, dep, sv, en in [
        ("xfer_lund", "lnd_hosp", 19 * 60 + 40, "Vidaretransport Växjö → Lund", "Onward transfer Växjö → Lund"),
        ("xfer_lkp", "lkp_hosp", 20 * 60 + 40, "Vidaretransport Växjö → Linköping", "Onward transfer Växjö → Linköping"),
    ]:
        seq, t = [], dep
        t = hold(seq, ll("vxo_hosp"), t - 1, t)
        t = drive(seq, f"{mid}_route", ll("vxo_hosp"), ll(dest), t, LOADED)
        missions.append({"id": mid, "vehicle": "ambulance", "sv": sv, "en": en, "base": "vxo_hosp", "seq": seq,
                         "arrivals": [{"place": dest, "t": round(t, 2), "n": 1}], "transfer": True,
                         "estimated": True, "time_unknown": True})

    # The bus itself: line 845 timed to reach the crash point at 16:30.
    d845 = routes["line845"]["dist"]
    dur = (r845["dur"] * (d845 / r845["dist"])) / 60.0 * 1.15 + 2.0  # stops + town traffic
    t_dep = T_CRASH - dur
    missions.append({"id": "bus845", "vehicle": "bus845", "sv": "Linje 845 (dubbeldäckare)",
                     "en": "Line 845 (double-decker)", "base": "vxo_resc",
                     "seq": [{"type": "hold", "at": ll("vxo_resc"), "t0": round(t_dep - 4, 2), "t1": round(t_dep, 2)},
                             {"type": "drive", "route": "line845", "t0": round(t_dep, 2), "t1": T_CRASH},
                             {"type": "crash", "at": C, "t0": T_CRASH, "t1": 30 * 60 + 24}],
                     "arrivals": [], "estimated": True})

    return routes, missions, closure, round(t_dep, 1)


EVENTS = [
    # t (minute), kind (doc|est), camera preset, sv, en, source
    (16 * 60 + 18, "est", "city", "Linje 845 lämnar Växjö", "Line 845 leaves Växjö",
     "Länstrafikens dubbeldäckare på linje 845 (Växjö–Ljungby, Connect Bus) lämnar Växjö västerut på riksväg 25. Drygt 40 personer ombord. Avgångstiden är uppskattad.",
     "Länstrafiken's double-decker on line 845 (Växjö–Ljungby, Connect Bus) heads west on Rv 25. Just over 40 people on board. Departure time is estimated.",
     "SVT; Region Kronoberg"),
    (16 * 60 + 30, "doc", "crash", "16.30 – Bussen kör av vägen och välter", "16:30 – The bus leaves the road and overturns",
     "Mellan Kvälleberg och trafikplats Hanaslöv, strax efter Långstorp i riktning mot Alvesta, kör bussen av vägen och välter i diket. Singelolycka; orsaken är okänd.",
     "Between Kvälleberg and the Hanaslöv interchange, just past Långstorp towards Alvesta, the bus leaves the road and overturns into the ditch. Single-vehicle crash; cause unknown.",
     "Region Kronoberg; SVT; Sveriges Radio P4 Kronoberg"),
    (16 * 60 + 31, "doc", "crash", "16.31 – Larmet", "16:31 – Alarm",
     "Polis, räddningstjänst och ambulans larmas. Tjänsteman i beredskap kontaktar närliggande regioner för att fördela patienter.",
     "Police, fire & rescue and ambulance are dispatched. The duty officer contacts neighbouring regions to share out patients.",
     "Polisen; Region Kronoberg"),
    (16 * 60 + 38, "doc", "region", "Regional stab aktiveras", "Regional crisis staff activated",
     "Strax efter larmet aktiveras den regionala staben. Region Kronoberg och Växjö sjukhus går upp i stabsläge. Exakt klockslag är inte publicerat.",
     "Shortly after the alarm the regional crisis staff is activated. Region Kronoberg and Växjö Hospital go into staff mode. Exact time not published.",
     "Region Kronoberg"),
    (16 * 60 + 45, "est", "crash_close", "Första enheterna på plats", "First units on scene",
     "Ambulanser från Växjö och Alvesta, räddningstjänst och polis når olycksplatsen. Mitträcket på riksväg 25 kapas så att ambulanserna snabbt kan lämna platsen.",
     "Ambulances from Växjö and Alvesta, fire & rescue and police reach the site. The median barrier on Rv 25 is cut so ambulances can leave quickly.",
     "Smålandsposten (mitträcket); arrival times modelled"),
    (16 * 60 + 52, "doc", "corridor", "16.52 – Riksväg 25 stängs", "16:52 – Rv 25 closed",
     "Trafikverket: mycket stor trafikpåverkan mellan Kvälleberg och Hanaslöv. Trafiken leds om västerut via Ör och Moheda och österut via Gemla.",
     "Swedish Transport Administration: very large traffic impact between Kvälleberg and Hanaslöv. Traffic diverted west via Ör and Moheda and east via Gemla.",
     "Polisen; Smålandsposten"),
    (17 * 60 + 2, "doc", "region", "17.02 – Minst tre ambulanser lastade", "17:02 – At least three ambulances loaded",
     "Sveriges Radio rapporterar att minst tre ambulanser lastats. Räddningshelikopter från Sjöfartsverket är på väg.",
     "Swedish Radio reports at least three ambulances loaded. A Swedish Maritime Administration rescue helicopter is en route.",
     "Sveriges Radio P4 Kronoberg; Smålandsposten"),
    (17 * 60 + 20, "doc", "hospitals", "17.20 – Sjukhusen förbereder sig", "17:20 – Hospitals prepare",
     "Akutmottagningarna i Växjö och Ljungby arbetar enligt rutiner för större olyckor. Intensivvård, kirurgi och röntgen förbereds; bemanningen kan snabbt förstärkas.",
     "The emergency departments in Växjö and Ljungby follow major-incident routines. Intensive care, surgery and radiology are readied; staffing can be quickly reinforced.",
     "Region Kronoberg pressmeddelande 17:20"),
    (17 * 60 + 35, "est", "heli", "Helikoptern lyfter mot Karlskrona", "Helicopter lifts off for Karlskrona",
     "En patient flygs med Sjöfartsverkets helikopter till Blekingesjukhuset i Karlskrona. Övriga svårt skadade körs med ambulans till Växjö, Ljungby och Värnamo.",
     "One patient is flown by the Maritime Administration helicopter to Blekinge Hospital in Karlskrona. Other seriously injured go by ambulance to Växjö, Ljungby and Värnamo.",
     "Hallandsposten/TT (helikopter till Karlskrona); time modelled"),
    (17 * 60 + 54, "doc", "overview", "17.54 – Första lägesbilden", "17:54 – First situation report",
     "Region Kronoberg: fyra–sex personer bedöms allvarligt skadade. Skadade förs till sjukhusen i Växjö, Ljungby och Karlskrona.",
     "Region Kronoberg: four to six people assessed as seriously injured. The injured are taken to hospitals in Växjö, Ljungby and Karlskrona.",
     "Region Kronoberg pressmeddelande 17:54"),
    (18 * 60 + 15, "doc", "skarvet", "Lindrigt skadade till Skärvet", "Lightly injured to Skärvet",
     "Lindrigt skadade körs med buss till vårdcentralen Skärvet i Växjö, som snabbt ställer om för att ta emot många patienter. Krisstöd från psykiatri och primärvård finns på plats.",
     "Lightly injured are taken by bus to Skärvet health centre in Växjö, which quickly reorganises to receive many patients. Crisis support from psychiatry and primary care is on site.",
     "Region Kronoberg"),
    (19 * 60 + 30, "doc", "flows", "19.30 – Räddningsinsatsen avvecklas", "19:30 – Rescue operation winds down",
     "Räddningstjänsten börjar avveckla. Region Kronoberg: drygt 40 drabbade, ett tiotal allvarligt skadade. Anhöriga hänvisas till Herkules intill akuten i Växjö.",
     "Fire & rescue begin winding down. Region Kronoberg: over 40 affected, about ten seriously injured. Relatives are directed to the Herkules room next to Växjö A&E.",
     "Smålandsposten; Region Kronoberg pressmeddelande 19:30"),
    (19 * 60 + 45, "est", "xfer", "Vidaretransport till Lund", "Onward transfer to Lund",
     "En patient förs vidare till Skånes universitetssjukhus i Lund. Region Kronoberg anger också att patienter senare skickades till Linköping. Tidpunkter och transportsätt är inte publicerade.",
     "One patient is transferred onward to Skåne University Hospital in Lund. Region Kronoberg also states patients were later sent to Linköping. Times and transport mode not published.",
     "Region Kronoberg; SVT Skåne"),
    (20 * 60 + 28, "doc", "none", "20.28 – Platsen avspärrad", "20:28 – Site cordoned off",
     "Olycksplatsen är avspärrad och tekniker undersöker platsen. Trafiken är fortsatt påverkad.",
     "The site is cordoned off and technicians examine it. Traffic remains affected.",
     "Polisen"),
    (21 * 60 + 28, "doc", "none", "21.28 – En ung man har avlidit", "21:28 – A young man has died",
     "Polisen meddelar att en man i 18-årsåldern, elev vid Katedralskolan i Växjö, har avlidit. Anhöriga är underrättade.",
     "Police announce that a man aged around 18, a student at Katedralskolan in Växjö, has died. Relatives have been notified.",
     "Polisen; SVT"),
    (22 * 60 + 44, "doc", "flows_all", "22.44 – Läget under natten", "22:44 – Overnight status",
     "Tio personer vårdas på sjukhus i Region Kronoberg: åtta i Växjö (två på intensiven) och två i Ljungby. Tidigare har en patient förts till Karlskrona, två till Värnamo och en till Lund.",
     "Ten people are in hospital in Region Kronoberg: eight in Växjö (two in intensive care) and two in Ljungby. Earlier, one patient went to Karlskrona, two to Värnamo and one to Lund.",
     "Region Kronoberg pressmeddelande 22:44"),
    (23 * 60 + 50, "doc", "flows_all", "Natten till tisdag", "Overnight into Tuesday",
     "Tekniker arbetar under natten; bussen bärgas och tas i beslag. Riksväg 25 öppnas tidigast kl. 07.00. Den regionala staben är aktiv till tisdag eftermiddag; tisdag kväll vårdas ingen längre på IVA.",
     "Technicians work overnight; the bus is recovered and seized. Rv 25 reopens at 07:00 at the earliest. The regional staff stays active until Tuesday afternoon; by Tuesday evening no one is in intensive care.",
     "Polisen 06:24; Hallandsposten; Region Kronoberg; SVT"),
    (19 * 60 + 0, "est", "flows", "Patienterna har nått sjukhusen", "Patients have reached the hospitals",
     "De svårt skadade har förts till Växjö (8), Ljungby (2), Värnamo (2) och med helikopter till Karlskrona (1). Linjerna visar var patienterna togs emot; bredden motsvarar antalet. Därefter flyttas fokus till vidaretransporterna.",
     "The seriously injured have been taken to Växjö (8), Ljungby (2), Värnamo (2) and by helicopter to Karlskrona (1). The arcs show where patients were received; width matches the count. Focus then moves to the onward transfers.",
     "Region Kronoberg pressmeddelande 22:44 (antal); tider modellerade"),
    (20 * 60 + 40, "est", "xfer", "Vidaretransport till Linköping", "Onward transfer to Linköping",
     "En patient förs vidare från Växjö sjukhus till Universitetssjukhuset i Linköping. Region Kronoberg uppger att patienter senare skickades till Linköping; tidpunkt, antal och transportsätt är inte publicerade.",
     "A patient is transferred from Växjö Hospital to Linköping University Hospital. Region Kronoberg states patients were later sent to Linköping; time, number and transport mode are not published.",
     "Region Kronoberg"),
    (22 * 60 + 9, "est", "xfer", "Patienten når Lund", "The patient reaches Lund",
     "Ambulansen når Skånes universitetssjukhus i Lund, cirka två och en halv timme efter avfärden från Växjö (modellerad körtid).",
     "The ambulance reaches Skåne University Hospital in Lund, about two and a half hours after leaving Växjö (modelled driving time).",
     "SVT Skåne (patient i Lund); tid modellerad"),
    (23 * 60 + 43, "est", "flows_all", "Patienten når Linköping", "The patient reaches Linköping",
     "Den sista vidaretransporten når Linköping. Under natten vårdas tio personer på sjukhus i Region Kronoberg; ytterligare patienter vårdas i Blekinge, Region Jönköpings län, Skåne och Östergötland.",
     "The last onward transfer reaches Linköping. Overnight ten people are in hospital in Region Kronoberg; further patients are cared for in Blekinge, Jönköping County, Skåne and Östergötland.",
     "Region Kronoberg; tid modellerad"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--city-model", required=True,
                    help="folder with osm.py and data/<city>/{city.json,transport_schedule.json}")
    args = ap.parse_args()
    src = Path(args.city_model)
    OUT.mkdir(parents=True, exist_ok=True)

    print("vendor libs")
    for url, name in [
        ("https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js", "maplibre-gl.js"),
        ("https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css", "maplibre-gl.css"),
        ("https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js", "three.module.js"),
    ]:
        dest = VENDOR / name
        if not dest.exists():
            fetch(url, CACHE / "vendor" / name)
            dest.write_bytes((CACHE / "vendor" / name).read_bytes())

    print("story")
    routes, missions, closure, t845 = build_story()
    for m in missions:
        tt = [s for s in m["seq"] if s["type"] in ("drive", "fly")]
        if tt:
            print(f"  {m['id']:<12} {hm(tt[0]['t0'])} → {hm(tt[-1]['t1'])}  arrivals: " +
                  ", ".join(f"{a['place']}@{hm(a['t'])}" for a in m["arrivals"]))

    print("city model")
    cities = model_cities(src)
    bld_ids = ["vaxjo", "karlskrona", "lund", "linkoping"]
    geo = bake_buildings(src, cities, bld_ids)
    (OUT / "buildings.geojson").write_text(json.dumps(geo, separators=(",", ":")), encoding="utf-8")
    lines, trips = bake_transit(src, cities, bld_ids, 15 * 60 + 30, 24 * 60)

    # Flights at Småland Airport (illustrative evening bank).
    airport = [14.7280, 56.9291]
    flights = [  # [minute, 'dep'|'arr', bearing_deg, sv/en destination]
        [16 * 60 + 5, "arr", 35, "Stockholm Bromma"], [16 * 60 + 40, "dep", 35, "Stockholm Bromma"],
        [18 * 60 + 25, "arr", 210, "Köpenhamn"], [19 * 60 + 5, "dep", 210, "Köpenhamn"],
        [20 * 60 + 50, "arr", 35, "Stockholm Bromma"], [21 * 60 + 25, "dep", 35, "Stockholm Bromma"],
    ]

    scene = {
        "meta": {"title_sv": "Bussolyckan på riksväg 25 – 5 oktober 2026",
                 "title_en": "The Rv 25 bus accident – 5 October 2026",
                 "t_start": 16 * 60 + 10, "t_end": 24 * 60, "t_crash": T_CRASH, "t_845_dep": t845},
        "places": {k: v for k, v in PLACES.items()},
        "routes": routes,
        "closure": {"coords": closure, "t0": 16 * 60 + 31, "t1": 31 * 60},
        "missions": missions,
        "events": [{"t": e[0], "kind": e[1], "cam": e[2], "title_sv": e[3], "title_en": e[4],
                    "body_sv": e[5], "body_en": e[6], "src": e[7]} for e in sorted(EVENTS)],
        "transit": {"lines": lines, "trips": trips},
        "flights": {"airport": airport, "list": flights},
        "documented_totals": {"vxo_hosp": 8, "lby_hosp": 2, "vmo_hosp": 2, "kkr_hosp": 1, "lnd_hosp": 1},
    }
    (OUT / "scene.json").write_text(json.dumps(scene, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for f in OUT.iterdir():
        print(f"  {f.name}: {f.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
