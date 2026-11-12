"""geocode.py - preset aliases -> disk cache -> Nominatim (1 req/s, identifying UA) -> Photon. Plus bbox clamp and resolution choice."""
import hashlib, json, math, os, pathlib, threading, time
import httpx
import presets

UA = os.getenv("GEOCODE_UA", "AskTheSatellite-NOVA2026/1.0 (set-your-team-email@example.com)")
CACHE = pathlib.Path(__file__).parent / "cache" / "geocode"
CACHE.mkdir(parents=True, exist_ok=True)
MAX_SIDE_DEG, MIN_HALF_DEG = 0.30, 0.02
_lock, _last = threading.Lock(), [0.0]


def _get(url, params):                                   # one place to patch in tests
    r = httpx.get(url, params=params, headers={"User-Agent": UA}, timeout=8)
    r.raise_for_status()
    return r.json()


def clamp(bbox, max_deg=MAX_SIDE_DEG):
    """Countries and seas come back hundreds of km wide: keep the centre, cap each side, floor at ~4 km."""
    w, s, e, n = bbox
    cx, cy = (w + e) / 2, (s + n) / 2
    hw = max(min((e - w) / 2, max_deg / 2), MIN_HALF_DEG)
    hh = max(min((n - s) / 2, max_deg / 2), MIN_HALF_DEG)
    return [round(cx - hw, 5), round(cy - hh, 5), round(cx + hw, 5), round(cy + hh, 5)], (e - w > max_deg or n - s > max_deg)


def choose_res(bbox, sensors=("sentinel-2",)):
    """<= ~1,600 px per side. Landsat is 30 m native, so one Landsat date forces both dates to 30 m."""
    if "landsat" in sensors:
        return 30
    lat = (bbox[1] + bbox[3]) / 2
    side_km = max((bbox[2] - bbox[0]) * 111.32 * math.cos(math.radians(lat)), (bbox[3] - bbox[1]) * 110.57)
    return 10 if side_km <= 16 else 20 if side_km <= 32 else 30


def _nominatim(q):
    with _lock:                                          # serialise + 1 request per second (OSM policy)
        time.sleep(max(0.0, 1.05 - (time.monotonic() - _last[0])))
        try:
            rows = _get("https://nominatim.openstreetmap.org/search", {"q": q, "format": "jsonv2", "limit": 1})
        finally:
            _last[0] = time.monotonic()
    if not rows:
        return None
    r = rows[0]
    s, n, w, e = (float(v) for v in r["boundingbox"])    # Nominatim order: south, north, west, east
    return dict(name=r["display_name"], bbox=[w, s, e, n], center=[float(r["lon"]), float(r["lat"])], source="nominatim")


def _photon(q):
    j = _get("https://photon.komoot.io/api/", {"q": q, "limit": 1})
    if not j.get("features"):
        return None
    f = j["features"][0]; lon, lat = f["geometry"]["coordinates"]; p = f["properties"]
    ext = p.get("extent")                                # [minlon, maxlat, maxlon, minlat]
    bb = [ext[0], ext[3], ext[2], ext[1]] if ext else [lon - 0.05, lat - 0.05, lon + 0.05, lat + 0.05]
    return dict(name=", ".join(x for x in (p.get("name"), p.get("state"), p.get("country")) if x), bbox=bb, center=[lon, lat], source="photon")


def geocode(q):
    """-> dict(name, bbox(clamped), center, source, clamped, preset_id) or None."""
    pid = presets.match(q)
    if pid:
        pr = presets.PRESETS[pid]; b = pr["bbox"]
        return dict(name=pr["title"], bbox=b, center=[(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], source="preset", clamped=False, preset_id=pid)
    f = CACHE / (hashlib.sha1(q.strip().lower().encode()).hexdigest()[:16] + ".json")
    if f.exists():
        return json.loads(f.read_text())
    hit = None
    for fn in (_nominatim, _photon):
        try:
            hit = fn(q)
        except Exception:                                # 429 / 503 / offline -> next provider
            hit = None
        if hit:
            break
    if not hit:
        return None
    hit["bbox"], hit["clamped"] = clamp(hit["bbox"]); hit["preset_id"] = None
    f.write_text(json.dumps(hit))
    return hit
