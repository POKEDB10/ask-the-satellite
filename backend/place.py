"""place.py - place knowledge for the globe UI: search suggestions, place-name extraction, Wikipedia summary + nearby highlights.
Everything here is reference context from named sources (OpenStreetMap, Wikipedia) with links. Nothing here is measured by satellite."""
import math, os, re, threading, time, unicodedata
import httpx
import presets

# Wikimedia rejects user agents without a contact URL (HTTP 403), so this one carries a project URL.
UA = os.getenv("PLACE_UA") or "AskTheSatellite-NOVA2026/1.1 (+https://github.com/; NOVA 2026 hackathon demo)"
WIKI = "https://en.wikipedia.org"
_client = httpx.Client(headers={"User-Agent": UA}, timeout=httpx.Timeout(5.0, connect=3.0), follow_redirects=True,
                       limits=httpx.Limits(max_connections=20, max_keepalive_connections=10))


# ------------------------------------------------------------------ tiny TTL cache with in-flight de-duplication
class TTLCache:
    """Many users asking for the same place at once trigger ONE upstream call; the rest wait for it (burst-safe)."""

    def __init__(self, ttl, maxsize=2000):
        self.ttl, self.maxsize, self.data, self.locks, self.lock = ttl, maxsize, {}, {}, threading.Lock()

    def get(self, key, fn):
        hit = self.data.get(key)
        if hit and hit[0] > time.time():
            return hit[1]
        with self.lock:
            kl = self.locks.setdefault(key, threading.Lock())
        with kl:
            hit = self.data.get(key)
            if hit and hit[0] > time.time():
                return hit[1]
            val = fn()
            if val is not None:
                if len(self.data) >= self.maxsize:
                    self.data.pop(next(iter(self.data)))
                self.data[key] = (time.time() + self.ttl, val)
            with self.lock:
                self.locks.pop(key, None)
            return val


_suggest_cache, _wiki_cache = TTLCache(6 * 3600), TTLCache(24 * 3600)


def km(a, b):
    """Great-circle distance in km between [lon, lat] points (geometry, used only to sort and label nearby places)."""
    lo1, la1, lo2, la2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(min(1.0, h)))


# ------------------------------------------------------------------ intent + place-name extraction (rules; work without any LLM)
CHANGE = re.compile(r"chang|compar|before|after|\bsince\b|\bgrow|shrink|expan|reclaim|flood|drought|deforest|burn|wildfire|dried|dry up|"
                    r"construct|sprawl|differen|then and now|over time|evolv|\bvs\b|versus|retreat|erosion|"
                    r"تغير|تغيّر|قبل|بعد|مقارنة|فيضان|جفاف", re.I)
FILLER = re.compile(r"\b(tell me (more )?about|tell me|show me|show|take me to|take me|fly me to|fly to|go to|zoom (in)?to|zoom in on|"
                    r"where is|where's|what is|what's|whats|what about|explore|find|search( for)?|look at|visit|let'?s see|"
                    r"can you|could you|please|i want to see|i'd like to see|info on|information about|about|the city of|"
                    r"me|now|today|currently|place|location|area|region)\b", re.I)


def is_change_question(q):
    return bool(CHANGE.search(q) or re.search(r"\b(19[89]\d|20[0-3]\d)\b", q))


def extract_place(q):
    """'india, gudivada' -> 'india, gudivada'; 'tell me about kyoto please' -> 'kyoto'. Used when the router/LLM found no name."""
    s = re.sub(r"\b(19[89]\d|20[0-3]\d)\b", " ", q)
    s = FILLER.sub(" ", s)
    s = re.sub(r"[?!.\"“”]", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" ,;:-")
    return s if len(s) >= 2 else None


# ------------------------------------------------------------------ search suggestions (Google-Earth style type-ahead)
SPAN = {"PCLI": 6.0, "ADM1": 2.0, "ADM2": 0.6, "PPLC": 0.25, "PPLA": 0.2, "PPLA2": 0.15}   # rough fly-to half-size in degrees


def _openmeteo(q, limit):
    """GeoNames-backed type-ahead (Open-Meteo geocoding API, built for search-as-you-type)."""
    r = _client.get("https://geocoding-api.open-meteo.com/v1/search", params={"name": q, "count": limit, "language": "en"},
                    timeout=httpx.Timeout(3.0, connect=2.0))
    r.raise_for_status()
    out = []
    for x in r.json().get("results", []) or []:
        lon, lat, fc = x["longitude"], x["latitude"], x.get("feature_code", "")
        h = SPAN.get(fc, 0.08 if fc.startswith("PPL") else 0.3)
        sub = ", ".join(v for v in (x.get("admin1"), x.get("country")) if v and v != x["name"])
        out.append(dict(name=x["name"], sub=sub, center=[lon, lat], bbox=[lon - h, lat - h * 0.8, lon + h, lat + h * 0.8],
                        kind="country" if fc == "PCLI" else "region" if fc.startswith("ADM") else "town" if fc.startswith("PPL") else fc.lower(),
                        source="geonames"))
    return out


def _photon(q, limit):
    r = _client.get("https://photon.komoot.io/api/", params={"q": q, "limit": limit, "lang": "en"}, timeout=httpx.Timeout(3.5, connect=2.0))
    r.raise_for_status()
    out = []
    for f in r.json().get("features", []):
        p, (lon, lat) = f["properties"], f["geometry"]["coordinates"]
        ext = p.get("extent")                                       # [minlon, maxlat, maxlon, minlat]
        bb = [ext[0], ext[3], ext[2], ext[1]] if ext else [lon - 0.03, lat - 0.03, lon + 0.03, lat + 0.03]
        sub = ", ".join(x for x in (p.get("city") if p.get("city") != p.get("name") else None, p.get("state"), p.get("country")) if x)
        out.append(dict(name=p.get("name") or q, sub=sub, center=[lon, lat], bbox=bb, kind=(p.get("osm_value") or "").replace("_", " "), source="photon"))
    return out


def _lookup(q, limit):
    for fn in (_openmeteo, _photon):                                # GeoNames first (fast); Photon covers landmarks and streets
        try:
            res = fn(q, limit)
            if res:
                return res
        except Exception:
            continue
    return []


def suggest(q, limit=6):
    q = q.strip()
    if len(q) < 2:
        return []
    ql = q.lower()
    out = []
    for pid, pr in presets.PRESETS.items():                          # stories first: instant, offline
        if any(a.startswith(ql) or ql in a for a in [pr["title"].lower(), *pr["aliases"]]):
            b = pr["bbox"]
            out.append(dict(name=pr["title"], sub="Story · measured history", center=[(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], bbox=b,
                            kind="story", source="preset", preset_id=pid))
    try:
        out += _suggest_cache.get(("s", ql, limit), lambda: _lookup(q, limit)) or []
    except Exception:
        pass                                                         # offline: stories still suggest
    seen, res = set(), []
    for s in out:
        k = (s["name"].lower(), s.get("sub", "").split(",")[-1].strip().lower())
        if k not in seen:
            seen.add(k)
            res.append(s)
    return res[:limit + 2]


# ------------------------------------------------------------------ Wikipedia: the place itself + nearby highlights
def _summary(title):
    r = _client.get(f"{WIKI}/api/rest_v1/page/summary/{title.replace(' ', '_')}", params={"redirect": "true"})
    if r.status_code != 200:
        return None
    j = r.json()
    if j.get("type") not in ("standard",):
        return None
    c = j.get("coordinates")
    return dict(title=j.get("title"), description=j.get("description"), extract=j.get("extract"),
                thumb=(j.get("thumbnail") or {}).get("source"), url=(j.get("content_urls") or {}).get("desktop", {}).get("page"),
                center=[c["lon"], c["lat"]] if c else None)


def _nearby(center, radius_m=10000, limit=60):
    j = _client.get(f"{WIKI}/w/api.php", params={"action": "query", "list": "geosearch", "gscoord": f"{center[1]}|{center[0]}",
                                                 "gsradius": radius_m, "gslimit": limit, "gsprop": "type", "format": "json"}).json()
    rows = [r for r in j.get("query", {}).get("geosearch", []) if (r.get("type") or "landmark") in STOPS][:20]
    if not rows:
        return []
    ids = "|".join(str(r["pageid"]) for r in rows)
    d = _client.get(f"{WIKI}/w/api.php", params={"action": "query", "pageids": ids, "prop": "extracts|pageimages|description|info|pageviews", "pvipdays": 30,
                                                 "exintro": 1, "explaintext": 1, "exsentences": 2, "piprop": "thumbnail", "pithumbsize": 240, "exlimit": "max",
                                                 "inprop": "url", "format": "json"}).json().get("query", {}).get("pages", {})
    out = []
    for r in rows:
        p = d.get(str(r["pageid"]), {})
        out.append(dict(title=r["title"], description=p.get("description"), extract=p.get("extract"),
                        thumb=(p.get("thumbnail") or {}).get("source"), url=p.get("fullurl"),
                        center=[r["lon"], r["lat"]], dist_km=round(r["dist"] / 1000, 1),
                        views=sum(v or 0 for v in (p.get("pageviews") or {}).values())))
    for o, r in zip(out, rows):
        o["kind"] = r.get("type") or "landmark"
    # geographic and hydrological features first, then infrastructure and landmarks, each by readership
    return sorted(out, key=lambda n: (n["kind"] not in GEO, -n["views"]))


GEO = {"waterbody", "river", "isle", "mountain", "forest", "glacier", "pass"}
STOPS = {"landmark", "mountain", "isle", "waterbody", "forest", "river", "glacier", "pass", "edu"}   # Wikipedia coordinate types worth a stop
BORING = re.compile(r"\b(railway station|bus station|school|college|hospital|bank|constituency|mandal|ward|tehsil|"
                    r"village|neighbourhood|neighborhood|census|post office|road|street|highway|metro station|company|airline|battle|siege|famine|rebellion|timeline|history of|list of|election|incident|attack|earthquake|hotel|resort|restaurant|ristorante|cuisine|dining|bar|pub|cafe|café|nightclub|lounge|mall|shop|shopping|store|retail|boutique|brand)\b", re.I)


def wiki(name, center):
    """-> {main, nearby[]} for a place, from Wikipedia, cached a day. None offline."""
    key = (name.split(",")[0].strip().lower(), round(center[0], 2), round(center[1], 2))

    def fetch():
        main = None
        first = name.split(",")[0].strip()
        plain = unicodedata.normalize("NFKD", first).encode("ascii", "ignore").decode() or first   # "Gudivāda" -> "Gudivada"
        for title in dict.fromkeys([plain, first, name.strip()]):
            s = _summary(title)
            if s and (not s["center"] or km(s["center"], center) < 80) and not BORING.search(s.get("description") or ""):
                main = s                                                    # the article must be about THIS place, not a constituency
                break
        near = _nearby(main["center"] if main and main.get("center") else center)   # the city's own centre, not the region's
        good = [n for n in near if not BORING.search(f"{n['title']} {n.get('description') or ''}") and n.get("extract")]
        if not main and good:                                        # no article for the name: the most-read real place nearby
            main = _summary(good[0]["title"])
        good = [n for n in good if not main or n["title"] != main["title"]]
        if not main and not good:
            return None                                              # likely a transient upstream error: do not cache emptiness
        return dict(main=main, nearby=good[:6])
    try:
        return _wiki_cache.get(key, fetch)
    except Exception:
        return None
