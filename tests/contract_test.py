"""contract_test.py - checks a running server on :8000 against the §5.3 contract plus the additive globe routes.
Run:  .venv\\Scripts\\python tests\\contract_test.py      Prints PASS or the first failure; exits non-zero on failure."""
import json, re, sys
import httpx

BASE = "http://127.0.0.1:8000"
c = httpx.Client(base_url=BASE, timeout=120)
SCENE = {"ids": list, "day": str, "datetime": str, "platform": str, "sensor": str, "resolution_m": int, "catalog": str, "candidates": list}
STATS = ["aoi_km2", "valid_pct_before", "valid_pct_after", "valid_pct_both", "area_before_km2", "area_after_km2", "gain_km2", "loss_km2",
         "net_km2", "football_pitches", "threshold", "min_mapping_unit_px", "ignored_small_km2", "gain_label", "loss_label"]


def fail(msg):
    print("FAIL:", msg)
    sys.exit(1)


def check_analysis(a, where):
    for k in ("analysis_id", "mode", "title", "index", "bounds", "scene_before", "scene_after", "stats", "quality", "ranking", "layers", "attribution", "error"):
        if k not in a:
            fail(f"{where}: missing {k}")
    if len(a["bounds"]) != 4 or not all(isinstance(v, (int, float)) for v in a["bounds"]):
        fail(f"{where}: bounds")
    for s in ("scene_before", "scene_after"):
        for k, t in SCENE.items():
            if not isinstance(a[s].get(k), t):
                fail(f"{where}: {s}.{k} is not {t.__name__}")
    for k in STATS:
        if k not in a["stats"]:
            fail(f"{where}: stats.{k}")
    q = a["quality"]
    if q["confidence"] not in ("HIGH", "MEDIUM", "LOW") or not isinstance(q["flags"], list) or not isinstance(q["headline_hidden"], bool):
        fail(f"{where}: quality")
    for k in ("rgb_before", "rgb_after", "change", "mask"):
        r = c.get(a["layers"][k])
        if r.status_code != 200 or r.headers["content-type"] != "image/png":
            fail(f"{where}: layer {k} not served")


def nums(s):
    return {float(x) for x in re.findall(r"\d+(?:\.\d+)?", s.replace(",", ""))}


def check_numbers(text, a, where):
    """Every number in a card must come from analysis stats or the two dates (rounding allowed)."""
    st = a["stats"]
    allowed = {float(v) for v in st.values() if isinstance(v, (int, float))} | {100 - st["valid_pct_both"]}
    if st["area_before_km2"] > 0:
        allowed.add(abs(round(100 * st["net_km2"] / st["area_before_km2"])))
    for s in ("scene_before", "scene_after"):
        allowed |= nums(a[s]["day"].replace("-", " ")) | nums(a[s]["platform"])
    for n in nums(text):
        if not any(abs(n - v) <= 0.051 or abs(n - round(v)) < 1e-9 for v in allowed):
            fail(f"{where}: number {n} in card is not in analysis.stats or dates: {text!r}")


def sse(body):
    out = []
    with c.stream("POST", "/api/chat/stream", json=body) as r:
        if r.status_code != 200:
            fail(f"stream HTTP {r.status_code}")
        ev = None
        for line in r.iter_lines():
            if line.startswith("event:"):
                ev = line[6:].strip()
            elif line.startswith("data:"):
                out.append((ev, json.loads(line[5:])))
    return out


h = c.get("/api/health").json()
for k in ("online", "stac", "ollama", "model"):
    if k not in h:
        fail(f"health.{k}")
ps = c.get("/api/presets").json()
if not ps or not all({"id", "title", "tier", "cached", "thumb"} <= set(p) for p in ps):
    fail("presets list")
cached = [p["id"] for p in ps if p["cached"]]
for pid in cached:
    a = c.get(f"/api/presets/{pid}").json()
    check_analysis(a, f"preset {pid}")
    if "context" not in a:
        fail(f"preset {pid}: additive context field missing")
    if c.get(f"/api/analysis/{a['analysis_id']}").status_code != 200:
        fail(f"analysis/{a['analysis_id']}")
g = c.get("/api/geocode", params={"q": "Palm Jumeirah"}).json()
for k in ("name", "bbox", "center", "source", "clamped", "preset_id"):
    if k not in g:
        fail(f"geocode.{k}")

for y1, y2 in (("2000", "2001"), ("2001", "2008"), ("2001", "2024")):
    a = c.get("/api/compare", params={"preset": "palm_jumeirah", "y1": y1, "y2": y2}).json()
    check_analysis(a, f"compare {y1}-{y2}")
    if a["scene_before"]["day"][:4] != y1 or a["scene_after"]["day"][:4] != y2:
        fail(f"compare {y1}-{y2}: wrong frames")
if c.get("/api/compare", params={"preset": "palm_jumeirah", "y1": "1990", "y2": "2001"}).status_code != 422:
    fail("compare with a missing year must be 422")
cfg = c.get("/api/config").json()
for k in ("arcgis_key", "basemap_order", "attributions", "model", "online"):
    if k not in cfg:
        fail(f"config.{k}")

r = c.post("/api/chat", json={"message": "Show Palm Jumeirah before and after"}).json()
for k in ("plan", "llm_used", "reply_measured", "reply_quality", "reply_interpretation", "actions", "analysis"):
    if k not in r:
        fail(f"chat.{k}")
if r["analysis"]:
    check_numbers(r["reply_measured"], r["analysis"], "chat measured")

evs = sse({"message": "Compare the Palm Jumeirah reclamation between 2000 and 2001 and show the images and also say what happened and what are the downsides"})
names = [e for e, _ in evs]
for need in ("plan", "progress", "analysis", "cards", "done"):
    if need not in names:
        fail(f"stream: no {need} event (got {names})")
if not evs[0][0] == "plan" or not evs[0][1].get("fly_to"):
    fail("stream: first event must be plan with fly_to")
a = next(d for e, d in evs if e == "analysis")
cards = next(d for e, d in evs if e == "cards")
check_analysis(a, "stream analysis")
check_numbers(cards["measured"], a, "stream measured")
check_numbers(cards["quality"]["text"], a, "stream quality")
for d in a["context"]["downsides"]:
    if not d["source_url"].startswith("https://"):
        fail("downside without source link")
ar = sse({"message": "أظهر لي جزيرة نخلة جميرا قبل وبعد"})
if not any(e == "analysis" for e, _ in ar):
    fail("Arabic Palm query returned no analysis")
oos = sse({"message": "What is the capital of France?"})
if not any(e == "cards" for e, _ in oos) or any(e == "analysis" for e, _ in oos):
    fail("out-of-scope must return a card and no analysis")
print(f"PASS ({len(cached)} cached presets, 3 compares, stream {len(evs)} events)")
