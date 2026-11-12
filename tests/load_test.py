"""load_test.py - burst test: N visitors arrive at once; each does what a real visitor does in the first minute
(page, app.js, config, stories, one story question over SSE, the two image layers it shows).
Visitors run on a pool of threads with keep-alive connections (httpx's async client is the bottleneck on Windows, not the server).
Start the server with TRUST_PROXY=1 so each visitor gets its own X-Forwarded-For and therefore its own rate-limit bucket:
    .venv\\Scripts\\python tests\\load_test.py --users 1000 --threads 64 --base http://127.0.0.1:8000"""
import argparse, json, random, statistics, threading, time
from concurrent.futures import ThreadPoolExecutor
import httpx

QUESTIONS = [("Palm Jumeirah 2001 to 2008", "palm_jumeirah"), ("Did Lake Mead shrink?", None), ("UAE flood April 2024", None),
             ("Compare the Palm Jumeirah reclamation between 2000 and 2001", None)]
_local = threading.local()


def client(base):
    if not hasattr(_local, "c"):
        _local.c = httpx.Client(base_url=base, timeout=60)
    return _local.c


def visitor(i, base, lat, errors, lock):
    c, h = client(base), {"X-Forwarded-For": f"10.{i // 65536 % 256}.{i // 256 % 256}.{i % 256}"}

    def rec(name, dt, ok, why=""):
        with lock:
            lat.setdefault(name, []).append(dt)
            if not ok:
                errors.append(f"{name}: {why}")

    def get(name, url):
        t = time.perf_counter()
        try:
            r = c.get(url, headers=h)
            rec(name, time.perf_counter() - t, r.status_code == 200, r.status_code)
        except Exception as e:
            rec(name, time.perf_counter() - t, False, type(e).__name__)

    for name, url in (("page", "/"), ("app.js", "/app.js"), ("config", "/api/config"), ("presets", "/api/presets")):
        get(name, url)
    msg, pid = random.choice(QUESTIONS)
    t, first, layers, evs = time.perf_counter(), None, None, []
    try:
        with c.stream("POST", "/api/chat/stream", json={"message": msg, "preset_id": pid}, headers=h) as r:
            ev = None
            for line in r.iter_lines():
                if line.startswith("event:"):
                    ev = line[6:].strip()
                    evs.append(ev)
                    first = first or time.perf_counter() - t
                elif line.startswith("data:") and ev == "analysis":
                    layers = json.loads(line[5:])["layers"]
        rec("stream: first event", first or 0, True)
        rec("stream: complete", time.perf_counter() - t, "done" in evs and "analysis" in evs, f"events {evs[-3:]}")
    except Exception as e:
        rec("stream: complete", time.perf_counter() - t, False, type(e).__name__)
    if layers:
        get("layer png", layers["rgb_after"])
        get("layer png", layers["change"])


def main(a):
    lat, errors, lock = {}, [], threading.Lock()
    t0 = time.perf_counter()
    with ThreadPoolExecutor(a.threads) as ex:
        list(ex.map(lambda i: visitor(i, a.base, lat, errors, lock), range(a.users)))
    wall = time.perf_counter() - t0
    reqs = sum(len(v) for k, v in lat.items() if k != "stream: first event")
    print(f"{a.users} visitors ({a.threads} at a time): {reqs} requests in {wall:.1f} s -> {reqs / wall:.0f} req/s, "
          f"{a.users / wall:.1f} visitors/s, errors: {len(errors)}")
    for k, v in lat.items():
        v.sort()
        q = lambda p: v[min(len(v) - 1, int(p * len(v)))] * 1000
        print(f"  {k:22s} n={len(v):5d}  p50 {statistics.median(v) * 1000:6.0f} ms  p95 {q(.95):6.0f} ms  p99 {q(.99):6.0f} ms")
    for e in sorted(set(errors))[:10]:
        print("  error:", e, f"(x{errors.count(e)})")
    return 1 if errors else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--users", type=int, default=500)
    ap.add_argument("--threads", type=int, default=64)
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    raise SystemExit(main(ap.parse_args()))
