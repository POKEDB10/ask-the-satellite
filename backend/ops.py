"""ops.py - keeps the server smooth under a burst of visitors: per-IP rate limits, concurrency gates for the expensive
paths (live raster analysis, local LLM), HTTP cache headers for static assets, and the cached satellite (TLE) feed."""
import os, pathlib, threading, time
import httpx

ROOT = pathlib.Path(__file__).parent
ALLOW_LIVE = os.getenv("ALLOW_LIVE", "1") != "0"                 # public demo host: set ALLOW_LIVE=0 (pre-computed only)
LIVE_TIMEOUT = float(os.getenv("LIVE_TIMEOUT", "150"))


# ------------------------------------------------------------------ rate limit: token bucket per client IP and route class
LIMITS = {"chat": (20, 40 / 60), "search": (30, 4.0), "analyze": (3, 3 / 60), "default": (120, 20.0)}   # (burst, refill per second)
_buckets, _blk = {}, threading.Lock()


TRUST_PROXY = os.getenv("TRUST_PROXY", "0") == "1"                # set on hosts behind one reverse proxy (Render, Fly, nginx)


def client_ip(request):
    """Visitors can forge X-Forwarded-For, so it is read only behind a trusted proxy, and then the LAST hop (added by the proxy)."""
    fwd = request.headers.get("x-forwarded-for") if TRUST_PROXY else None
    return fwd.split(",")[-1].strip() if fwd else (request.client.host if request.client else "?")


def allow(request, kind="default"):
    burst, rate = LIMITS.get(kind, LIMITS["default"])
    key, now = (client_ip(request), kind), time.monotonic()
    with _blk:
        tokens, last = _buckets.get(key, (burst, now))
        tokens = min(burst, tokens + (now - last) * rate)
        ok = tokens >= 1
        _buckets[key] = (tokens - 1 if ok else tokens, now)
        if len(_buckets) > 50000:                                  # bounded memory under a flood of distinct IPs
            for k in list(_buckets)[:10000]:
                _buckets.pop(k, None)
    return ok


# ------------------------------------------------------------------ concurrency gates
class Gate:
    """At most `n` holders; `try_enter(wait)` gives up after `wait` seconds so requests degrade instead of piling up."""

    def __init__(self, n, max_queue):
        self.sem, self.max_queue, self.waiting, self.lock = threading.BoundedSemaphore(n), max_queue, 0, threading.Lock()

    def try_enter(self, wait):
        with self.lock:
            if self.waiting >= self.max_queue:
                return False
            self.waiting += 1
        try:
            return self.sem.acquire(timeout=wait)
        finally:
            with self.lock:
                self.waiting -= 1

    def leave(self):
        self.sem.release()


LIVE_GATE = Gate(int(os.getenv("LIVE_CONCURRENCY", "1")), max_queue=3)     # one raster job at a time keeps RAM safe (research §5.1)
LLM_GATE = Gate(1, max_queue=4)                                             # one local-model call at a time (8 GB VRAM)


# ------------------------------------------------------------------ cache headers (pure ASGI: safe for streaming responses)
class CacheHeaders:
    RULES = (("/vendor/", "public, max-age=604800"), ("/cache/frames/", "public, max-age=86400"), ("/cache/presets/", "public, max-age=3600"),
             ("/api/presets", "public, max-age=60"), ("/api/satellites", "public, max-age=900"), ("/api/search", "public, max-age=3600"))

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope["path"]
        cc = next((v for p, v in self.RULES if path.startswith(p)), "no-cache" if path in ("/", "/index.html") or path.endswith((".js", ".css")) else None)

        async def send2(msg):
            if msg["type"] == "http.response.start" and cc:
                msg.setdefault("headers", [])
                msg["headers"] = [h for h in msg["headers"] if h[0].lower() != b"cache-control"] + [(b"cache-control", cc.encode())]
            await send(msg)
        await self.app(scope, receive, send2)


# ------------------------------------------------------------------ satellites: CelesTrak TLEs, cached on disk (offline keeps the last copy)
TLE_DIR = ROOT / "cache" / "tle"
GROUPS = ("resource", "stations")                                  # Earth-observation satellites + space stations
HIGHLIGHT = ("LANDSAT 8", "LANDSAT 9", "SENTINEL-2A", "SENTINEL-2B", "SENTINEL-2C", "ISS (ZARYA)")
_tle_lock = threading.Lock()


def _parse(text):
    lines = [l.rstrip() for l in text.splitlines() if l.strip()]
    out = []
    for i in range(0, len(lines) - 2, 3):
        n, a, b = lines[i:i + 3]
        if a.startswith("1 ") and b.startswith("2 "):
            out.append(dict(name=n.strip(), l1=a, l2=b, norad=a[2:7].strip(), key=n.strip() in HIGHLIGHT))
    return out


def satellites(max_age_h=6):
    """-> {fetched, source, sats[]} newest CelesTrak copy; refreshed at most every 6 h (CelesTrak asks clients not to poll)."""
    TLE_DIR.mkdir(parents=True, exist_ok=True)
    sats, fetched = [], None
    with _tle_lock:
        for g in GROUPS:
            f = TLE_DIR / f"{g}.txt"
            if not f.exists() or time.time() - f.stat().st_mtime > max_age_h * 3600:
                try:
                    r = httpx.get("https://celestrak.org/NORAD/elements/gp.php", params={"GROUP": g, "FORMAT": "tle"},
                                  headers={"User-Agent": "AskTheSatellite-NOVA2026/1.1"}, timeout=10)
                    if r.status_code == 200 and r.text.count("\n") > 3:
                        f.write_text(r.text)
                except Exception:
                    pass                                              # offline: keep the last copy
            if f.exists():
                sats += _parse(f.read_text())
                fetched = max(fetched or 0, f.stat().st_mtime)
    seen, uniq = set(), []
    for s in sats:
        if s["norad"] not in seen:
            seen.add(s["norad"])
            uniq.append(s)
    return dict(fetched=fetched, source="CelesTrak (celestrak.org), NORAD general perturbations", sats=uniq)


# ------------------------------------------------------------------ hot static files from memory
class MemoryStatic:
    """Serves small files under /cache/ (analysis PNGs, result.json) from RAM with ETag/304, re-reading only when the file changes.
    Anything else, or anything not found, falls through to the normal StaticFiles mount."""
    TYPES = {".png": b"image/png", ".json": b"application/json", ".jpg": b"image/jpeg"}

    def __init__(self, app, root, max_bytes=16_000_000, max_files=400):
        self.app, self.root, self.max_bytes, self.max_files = app, pathlib.Path(root).resolve(), max_bytes, max_files
        self.files, self.lock = {}, threading.Lock()

    def _load(self, rel):
        p = (self.root / rel).resolve()
        if not p.is_relative_to(self.root) or p.suffix not in self.TYPES or not p.is_file():
            return None
        stt = p.stat()
        if stt.st_size > self.max_bytes:
            return None
        hit = self.files.get(p)
        if hit and hit[0] == stt.st_mtime_ns:
            return hit
        data = p.read_bytes()
        hit = (stt.st_mtime_ns, data, f'"{stt.st_mtime_ns:x}-{len(data):x}"'.encode(), self.TYPES[p.suffix])
        with self.lock:
            if len(self.files) >= self.max_files:
                self.files.pop(next(iter(self.files)))
            self.files[p] = hit
        return hit

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if scope["type"] != "http" or scope["method"] not in ("GET", "HEAD") or not path.startswith("/cache/") or ".." in path:
            return await self.app(scope, receive, send)
        hit = self._load(path[len("/cache/"):])
        if not hit:
            return await self.app(scope, receive, send)
        _, data, etag, ctype = hit
        inm = dict(scope.get("headers") or []).get(b"if-none-match")
        if inm == etag:
            await send({"type": "http.response.start", "status": 304, "headers": [(b"etag", etag)]})
            return await send({"type": "http.response.body", "body": b""})
        await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", ctype), (b"content-length", str(len(data)).encode()), (b"etag", etag)]})
        await send({"type": "http.response.body", "body": b"" if scope["method"] == "HEAD" else data})
