"""extras.py - additive routes for the globe UI: /api/compare, /api/chat/stream (SSE), /api/config, /api/search, /api/place, /api/satellites.
Numbers still come only from change.run_change; this module only loads cached frames and orchestrates."""
import datetime as dt, json, math, os, pathlib, re, threading, time
import numpy as np, xarray as xr
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from fastapi import APIRouter, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import StreamingResponse
import agent, change, geocode, narrate, ops, place, presets
import main                                   # imported while main is still loading: attributes are read at call time

router = APIRouter()


def _warm():
    """Load the primary model into VRAM once at server start (research §3.1). A cold 7B load takes longer than the
    6 s chat timeout, which otherwise makes every request fall back to the small model and evict the big one."""
    try:
        agent._chat(agent.MODELS[0], "Reply with OK.", "OK", max_tokens=2, timeout=180)
    except Exception:
        pass                                                     # Ollama down: the rule router and templates still answer


PREWARM = [("Compare the Palm Jumeirah reclamation between 2000 and 2001", None), ("Palm Jumeirah 2001 to 2008", "palm_jumeirah"),
           ("Palm Jumeirah 2001 to 2024", None), ("Did Lake Mead shrink?", None), ("UAE flood April 2024", None),
           ("Show Palm Jebel Ali", "palm_jebel_ali"), ("Did the Aral Sea shrink?", "aral_sea"), ("Dubai", None), ("Kyoto", None),
           ("Burj Khalifa", None), ("Palm Jumeirah", None), ("أظهر لي جزيرة نخلة جميرا قبل وبعد", None)]


def _prewarm():
    """Model into VRAM, then narrate the pitch stories once: a burst of visitors replays them from the shared cache."""
    _warm()
    if not agent.MODELS:
        return
    for msg, pid in PREWARM:
        try:
            for _ in _safe(StreamReq(message=msg, preset_id=pid)):
                pass
        except Exception:
            continue


@router.on_event("startup")
async def _startup():
    import anyio                                                  # SSE streams wait on I/O; 40 default threads starve static files
    anyio.to_thread.current_default_thread_limiter().total_tokens = int(os.getenv("THREADS", "400"))
    if os.getenv("PREWARM", "1") == "1":
        threading.Thread(target=_prewarm, daemon=True).start()
ROOT = pathlib.Path(__file__).parent
CACHE = ROOT / "cache"
FRAMES = CACHE / "frames"
CURATED = json.loads((ROOT / "presets.json").read_text(encoding="utf-8"))
DEFAULT_YEARS = {"palm_jumeirah": ("2001", "2008")}
YEAR = re.compile(r"^(19|20)\d\d$")
STEPS = ("locate", "scenes", "measure")


# ------------------------------------------------------------------ frames + compare
def frame_years(pid):
    d = FRAMES / pid
    return sorted(p.name for p in d.iterdir() if (p / "meta.json").exists()) if d.exists() else []


def load_frame(pid, year):
    d = FRAMES / pid / year
    m = json.loads((d / "meta.json").read_text())
    z = np.load(d / "bands.npz")
    ds = xr.Dataset({k: (("y", "x"), z[k]) for k in z.files if k not in ("x", "y")}, coords={"x": z["x"], "y": z["y"]})
    return {**m, "ds": ds, "day": dt.date.fromisoformat(m["day"])}


def with_context(a, pid):
    c = CURATED.get(pid, {})
    return {**a, "context": c.get("context")}


def compare(pid, y1, y2, index="mndwi"):
    """Change between two cached frames, through the unchanged change.run_change."""
    bank = frame_years(pid)
    if y1 not in bank or y2 not in bank or index not in ("mndwi", "ndvi", "ndwi") or y1 == y2:
        raise ValueError(f"years must be two different values from {bank}")
    rel = f"presets/{pid}__{y1}_{y2}" + ("" if index == "mndwi" else f"_{index}")
    out = CACHE / rel
    if (out / "result.json").exists():
        return _radiometry(with_context(json.loads((out / "result.json").read_text()), pid), pid, y1, y2)
    A, B = load_frame(pid, y1), load_frame(pid, y2)
    if A["ds"]["red"].shape != B["ds"]["red"].shape or not (np.allclose(A["ds"].x, B["ds"].x) and np.allclose(A["ds"].y, B["ds"].y)):
        raise ValueError("cached frames are not on one grid")
    r = change.run_change(A, B, A["bounds"], index, out)
    a = dict(analysis_id=rel.replace("/", ":"), mode="preset", title=f"{presets.PRESETS[pid]['title']}, {A['day'].year} to {B['day'].year}",
             index=index, bounds=r["bounds"], scene_before=main._scene(A), scene_after=main._scene(B), stats=r["stats"], quality=r["quality"],
             ranking=None, layers={k: f"/cache/{rel}/{k}.png" for k in ("rgb_before", "rgb_after", "change", "mask")},
             attribution=main._attr(A, B), error=None)
    (out / "result.json").write_text(json.dumps(a, default=str))
    return _radiometry(with_context(a, pid), pid, y1, y2)


def _radiometry(a, pid, y1, y2):
    """Additive scene fields for the Verify modal: the scale and offset actually applied to each frame."""
    for key, y in (("scene_before", y1), ("scene_after", y2)):
        m = json.loads((FRAMES / pid / y / "meta.json").read_text())
        a[key] = {**a[key], "scale": m["scale"], "offset": m["offset"]}
    return a


@router.get("/api/compare")
def api_compare(preset: str, y1: str, y2: str, index: str = "mndwi"):
    if preset not in presets.PRESETS or not (YEAR.match(y1) and YEAR.match(y2)):
        raise HTTPException(404, "unknown preset or year")
    try:
        return compare(preset, y1, y2, index)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.get("/api/frames/{pid}")
def api_frames(pid: str):
    if pid not in presets.PRESETS:
        raise HTTPException(404, "unknown preset")
    rows = []
    for y in frame_years(pid):
        m = json.loads((FRAMES / pid / y / "meta.json").read_text())
        rows.append({k: m[k] for k in ("year", "day", "platform", "sensor", "res", "valid_pct_frame")})
    return rows


# ------------------------------------------------------------------ config
ATTRIBUTIONS = {
    "esri": "Esri, Vantor, Earthstar Geographics, and the GIS User Community",
    "landsat": "Landsat data courtesy of the U.S. Geological Survey",
    "sentinel2": "Contains modified Copernicus Sentinel data, processed by ESA; accessed via Element 84 Earth Search or Microsoft Planetary Computer",
    "naturalearth": "Natural Earth II (public domain), bundled with CesiumJS",
    "cesium": "CesiumJS (Apache-2.0)",
    "geocode": "Search: © OpenStreetMap contributors (Nominatim / Photon, ODbL)",
    "nasa": "Orbit view: NASA Earth Observatory Blue Marble (public domain)",
    "wikipedia": "Place notes: Wikipedia contributors (CC BY-SA 4.0)",
    "celestrak": "Satellite positions: CelesTrak NORAD elements, propagated with satellite.js (MIT)",
}


_cfg_lock, _cfg = threading.Lock(), [0.0, None]


def _refresh_cfg():
    try:
        _cfg[:] = [time.time(), _config()]
    finally:
        _cfg_lock.release()


@router.get("/api/config")
def api_config():
    """Stale-while-revalidate: a burst never waits on the health probe; only the very first request does."""
    if _cfg[1] is None:                                            # cold worker: answer at once without network probes
        if _cfg_lock.acquire(blocking=False):
            threading.Thread(target=_refresh_cfg, daemon=True).start()
        return _config(probe=False)
    if time.time() - _cfg[0] > 15 and _cfg_lock.acquire(blocking=False):
        threading.Thread(target=_refresh_cfg, daemon=True).start()
    return _cfg[1]


def _config(probe=True):
    h = main.health() if probe else dict(online=True, model=agent.MODELS[0] if agent.MODELS else None)
    return dict(arcgis_key=os.getenv("ARCGIS_API_KEY") or None, basemap_order=["esri", "naturalearth"],
                attributions=ATTRIBUTIONS, model=h.get("model"), online=h.get("online", False),
                live=ops.ALLOW_LIVE, narrator=bool(h.get("model")) or narrate.DISK.exists(),
                frames={pid: frame_years(pid) for pid in DEFAULT_YEARS})


# ------------------------------------------------------------------ chat stream (same orchestration as /api/chat)
def _ev(name, data):
    return f"event: {name}\ndata: {json.dumps(data, default=str, ensure_ascii=False)}\n\n"


def _milestone_note(a, pid):
    ms = (CURATED.get(pid, {}).get("context") or {}).get("milestones") or []
    if not ms:
        return None
    d0, d1 = dt.date.fromisoformat(a["scene_before"]["day"]), dt.date.fromisoformat(a["scene_after"]["day"])
    inside = [m for m in ms if d0 <= dt.date(m["year"], m.get("month") or 1, 1) <= d1]
    if inside:
        return None
    first = min(ms, key=lambda m: (m["year"], m.get("month") or 1))
    if dt.date(first["year"], first.get("month") or 1, 1) > d1:
        return f"{first['text']}; this window mostly predates it."
    return f"{max(ms, key=lambda m: (m['year'], m.get('month') or 1))['text']}; this window comes after it."


def _nearest_preset(center):
    def dist(pid):
        b = presets.PRESETS[pid]["bbox"]
        return math.hypot((b[0] + b[2]) / 2 - center[0], (b[1] + b[3]) / 2 - center[1])
    ready = [pid for pid in presets.PRESETS if frame_years(pid) or (CACHE / "presets" / pid / "result.json").exists()]
    return min(ready, key=dist) if ready else None


def _preset_analysis(pid, ys, notes, index="mndwi"):
    """Year handling: the bank decides. Returns an Analysis, or None after adding a note listing what exists."""
    bank = frame_years(pid)
    if bank:
        if len(ys) >= 2:
            y1, y2 = ys[0], ys[-1]
            if y1 in bank and y2 in bank:
                return compare(pid, y1, y2, index)
            missing = [y for y in (y1, y2) if y not in bank]
            notes.append(f"No cached frame for {', '.join(missing)}. Years available: {', '.join(bank)}.")
            return None
        if len(ys) == 1:
            notes.append(f"Name two years to compare. Years available: {', '.join(bank)}.")
            return None
        return compare(pid, *DEFAULT_YEARS.get(pid, (bank[0], bank[-1])))
    return with_context(main.run_preset(pid), pid)


def _next_chips(pid, a):
    chips = list((CURATED.get(pid) or {}).get("next") or [])
    return [c for c in chips if c.get("label") and not (a and c.get("years") == [a["scene_before"]["day"][:4], a["scene_after"]["day"][:4]])]


EO_CHIPS = [dict(label="Compare Palm Jumeirah 2001 → 2008 (MNDWI)", message="Compare Palm Jumeirah 2001 to 2008", preset_id="palm_jumeirah"),
            dict(label="Compare Palm Jumeirah 2000 → 2001", message="Compare Palm Jumeirah 2000 to 2001", preset_id="palm_jumeirah"),
            dict(label="UAE Flood April 2024 Analysis", message="UAE flood, April 2024", preset_id="dubai_flood_2024"),
            dict(label="Did Lake Mead shrink?", message="Did Lake Mead shrink?")]


def _place_chips(name, pid):
    chips = []
    if pid and pid != "palm_jumeirah":
        chips.append(dict(label=f"Watch it change: {presets.PRESETS[pid]['title']}", message=presets.PRESETS[pid]["title"] + " before and after", preset_id=pid))
    if ops.ALLOW_LIVE:
        chips.append(dict(label="Measure change here, 2019 to now", message=f"How has {name} changed since 2019?"))
    return chips + EO_CHIPS                                       # one click from any place into satellite change detection


_geo_cache = place.TTLCache(24 * 3600)
_nominatim_get = geocode._get                                     # geocode._get is the module's own patch point ("one place to patch")


def _get_en(url, params):                                         # English place names, so Wikipedia titles match ("Dubai", not "دبي")
    return _nominatim_get(url, {**params, "accept-language": "en"} if "nominatim" in url else params)


geocode._get = _get_en
_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="live")


def _narrator(key):
    _, model = narrate.recorded(key)
    return f"recorded:{model}" if model and not agent.MODELS else f"llm:{model or (agent.MODELS[0] if agent.MODELS else '')}"


def _geocode(name):
    return _geo_cache.get(name.strip().lower(), lambda: geocode.geocode(name))


class Busy(Exception):
    pass


def _run_live(g, p):
    """Live Sentinel-2 run in a worker thread; the generator streams heartbeats so the UI never looks frozen."""
    d_after = dt.date.fromisoformat(p.date_after) if p.date_after else dt.date.today()
    d_before = dt.date.fromisoformat(p.date_before) if p.date_before else max(dt.date(2016, 1, 1), d_after.replace(year=d_after.year - 5))
    d_before = max(d_before, dt.date(2016, 1, 1))

    def job():
        if not ops.LIVE_GATE.try_enter(wait=60):
            raise Busy()
        try:
            return main.analyze(g["bbox"], str(d_before), str(d_after), p.index, "auto", None, (30, 45), 40, title=g["name"])
        finally:
            ops.LIVE_GATE.leave()
    fut, t0 = _POOL.submit(job), time.time()
    while True:
        try:
            return fut.result(timeout=1.5)
        except FuturesTimeout:
            el = int(time.time() - t0)
            if el > ops.LIVE_TIMEOUT:
                raise TimeoutError("live analysis took too long")
            yield _ev("progress", dict(step="scenes", state="active", label=f"Searching Sentinel-2 scenes · {el} s"))


class StreamReq(main.ChatReq):
    place_hint: dict | None = None                                 # {name, center:[lon,lat], bbox:[w,s,e,n]} from /api/search
    index: str | None = None                                       # selector bar: mndwi | ndvi | ndwi for the frame bank


def _stream(req):
    t0 = time.time()
    last = main.load_analysis(req.last_analysis_id)
    q = (req.message or "").strip()
    rp = agent.rule_router(q, has_last=bool(last))
    gallery = req.preset_id in presets.PRESETS
    if gallery:
        rp.preset_id, rp.index, rp.intent, rp.source = req.preset_id, presets.PRESETS[req.preset_id]["index"], "analyze", "gallery"
    pr = presets.PRESETS.get(rp.preset_id)
    change_q = gallery or place.is_change_question(q)
    yield _ev("plan", dict(plan=rp.model_dump(), fly_to=pr["bbox"] if pr else None, source="rules", mode="change" if change_q else "explore"))
    p = rp
    if rp.intent == "out_of_scope" and not change_q:                  # a bare place name looks out of scope to the keyword router
        guess = place.extract_place(q)
        if guess:
            p = rp = agent.Plan(intent="analyze", place=guess, language=rp.language, source="rules")
    if not (rp.preset_id or rp.intent == "explain_last"):
        yield _ev("progress", dict(step="locate", state="active", label="Reading the question"))
        p = agent.plan(q, has_last=bool(last))
        if p.preset_id and p.preset_id != presets.match(p.place or ""):     # the LLM tied a nearby preset to another place
            p.preset_id = None
        if p.intent == "explain_last":                                     # only the rule router may decide "explain the last map"
            p.intent = "analyze"
        if p.intent == "out_of_scope" and rp.intent == "analyze" and rp.place:
            p.intent = "analyze"                                           # the words name a place: trust the rules over the model
        if p.intent == "analyze" and not p.place and not p.preset_id:
            p.place = rp.place or place.extract_place(q)
        pr = presets.PRESETS.get(p.preset_id)
    lang = req.lang if req.lang in ("en", "ar", "hi") else p.language
    if p.intent == "out_of_scope":
        yield _ev("cards", dict(measured=agent._t(lang)["oos"], kind="info"))
        return
    if p.intent == "explain_last":
        yield _ev("analysis", last)
        yield _ev("cards", dict(measured=agent.explain_last(last, lang), kind="info"))
        return
    notes, ys = [], agent._years(q)
    yield _ev("progress", dict(step="locate", state="active", label="Locating"))
    g = None
    hint = req.place_hint if isinstance(req.place_hint, dict) and len(req.place_hint.get("bbox") or []) == 4 else None
    if hint and not pr:
        b = [float(v) for v in hint["bbox"]]
        g = dict(name=str(hint.get("name") or q)[:120], bbox=geocode.clamp(b)[0], center=[(b[0] + b[2]) / 2, (b[1] + b[3]) / 2],
                 clamped=False, preset_id=None, fly=b)
    elif not pr:
        g = _geocode(p.place) if p.place else None
        if not g:
            yield _ev("cards", dict(measured=f"I could not find “{p.place or q}”. Try a city, landmark or region name, or pick one of the stories.", kind="info"))
            return
        if g.get("preset_id"):
            pr, p.preset_id = presets.PRESETS[g["preset_id"]], g["preset_id"]
    if pr:
        b = pr["bbox"]
        g = g or dict(name=pr["title"], bbox=b, center=[(b[0] + b[2]) / 2, (b[1] + b[3]) / 2])
    fly = g.get("fly") or g["bbox"]
    if not change_q and g.get("clamped"):                              # countries and regions: fly to the whole extent, like Google Earth
        try:
            s = next((s for s in place.suggest(p.place or g["name"], 3) if s["source"] != "preset" and place.km(s["center"], g["center"]) < 300), None)
            fly = s["bbox"] if s else fly
        except Exception:
            pass
    yield _ev("plan", dict(plan=p.model_dump(), fly_to=fly, source="geocode", place=g["name"], mode="change" if change_q else "explore"))
    yield _ev("progress", dict(step="locate", state="done", label="Located"))

    # ---------------- explore: a place, not a change question -> reference card + guide narrative
    if not change_q:
        yield _ev("progress", dict(step="scenes", state="active", label="Reading about this place"))
        label = (pr["title"] if pr else g["name"].split(",")[0] or p.place or "").strip()[:80]   # most specific part of the geocoded name
        w = place.wiki(pr["aliases"][0].title() if pr else label, g["center"])
        main_title = ((w or {}).get("main") or {}).get("title") or label
        if not pr and main_title.isascii() and not label.isascii():
            label = main_title                                        # prefer the English article title for labels and chips
        pkey = ("place", main_title.lower()[:80], round(g["center"][0], 2), round(g["center"][1], 2), lang)   # resolved place, memory only
        yield _ev("place", dict(name=label, full=g["name"], center=g["center"], bbox=g["bbox"], wiki=w, preset_id=p.preset_id,
                                attribution="Wikipedia (CC BY-SA 4.0) · OpenStreetMap contributors (ODbL)"))
        yield _ev("progress", dict(step="scenes", state="done", label="Read"))
        if w and narrate.available(pkey) and lang == "en":
            for s in narrate.stream(narrate.place_prompt(main_title, lang), narrate.place_facts(main_title, w), pkey):
                yield _ev("say", dict(text=s, source=_narrator(pkey)))
        yield _ev("cards", dict(kind="place", next=_place_chips(label, p.preset_id)))
        yield _ev("done", dict(elapsed_s=round(time.time() - t0, 1)))
        return

    # ---------------- change: preset bank or live Sentinel-2
    yield _ev("progress", dict(step="scenes", state="active", label="Picking scenes"))
    if pr:
        a = _preset_analysis(p.preset_id, ys, notes, req.index if req.index in ("mndwi", "ndvi", "ndwi") else "mndwi")
        if a is None:
            yield _ev("cards", dict(measured=notes[-1], kind="info", next=_next_chips(p.preset_id, None)))
            return
    else:
        if ys and min(ys) < "2016":
            notes.append(f"Live history starts in 2016 (Sentinel-2); older history exists only for the stories, so this measures from 2016.")
        if not ops.ALLOW_LIVE:
            yield _ev("cards", dict(measured="Live measuring is switched off on this public demo, so only the pre-computed stories can be measured. "
                                              "Run the app locally to measure any place.", kind="info"))
            return
        a = yield from _run_live(g, p)
        a = {**a, "context": None}
        if g.get("clamped"):
            notes.append("Analysing a 33 km window around the centre.")
    yield _ev("progress", dict(step="scenes", state="done", label="Scenes picked"))
    yield _ev("progress", dict(step="measure", state="done", label="Change measured"))
    yield _ev("analysis", a)
    if p.preset_id:
        n = _milestone_note(a, p.preset_id)
        if n:
            notes.append(n)
    if p.note == "urban_not_measured":
        notes.append("Built-up area is not measured; showing vegetation change.")
    cards = dict(kind="analysis", measured=agent.measured_card(a, lang), quality=agent.quality_card(a, lang), notes=notes,
                 context=a.get("context"), next=_next_chips(p.preset_id, a), interpretation=None)
    told = False
    nkey = ("change", a["analysis_id"], lang)
    # Arabic gets the hand-written Arabic cards only: the names guard cannot check Arabic script
    if narrate.available(nkey) and not a["quality"]["headline_hidden"] and lang == "en":
        ctx_line = pr["context"] if pr else ""
        facts = narrate.change_facts(a, a.get("context"), notes + ([ctx_line] if ctx_line and not a.get("context") else []), cards["measured"])
        for s in narrate.stream(narrate.change_prompt(lang), facts, nkey):
            told = True
            yield _ev("say", dict(text=s, source=_narrator(nkey)))
    if not told and not a.get("context"):
        text, src = agent.interpretation(a, pr["context"] if pr else "", lang, use_llm=False)
        cards["interpretation"] = dict(text=text, source=src)
    yield _ev("cards", cards)
    yield _ev("done", dict(elapsed_s=round(time.time() - t0, 1)))


def _safe(req):
    t0 = time.time()
    try:
        done = False
        for chunk in _stream(req):
            done = done or chunk.startswith("event: done")
            yield chunk
        if not done:
            yield _ev("done", dict(elapsed_s=round(time.time() - t0, 1)))
    except Exception as e:                                       # never an HTTP error: a friendly card instead
        kind = type(e).__name__
        msg = {"NoScene": "No clear satellite scene was found for those dates. Try other dates or a story.",
               "Busy": "The live engine is busy measuring for other visitors. Try again in a minute, or open a pre-computed story.",
               "TimeoutError": "The live satellite catalogue is slow right now. Try again shortly, or open a pre-computed story."}.get(
            kind, f"The live data source did not answer ({kind}). Pick a pre-computed story.")
        yield _ev("cards", dict(measured=msg, kind="error"))
        yield _ev("done", dict(elapsed_s=round(time.time() - t0, 1)))


def _limited():
    yield _ev("cards", dict(measured="You are asking faster than the satellites can keep up. Wait a few seconds and try again.", kind="info"))
    yield _ev("done", dict(elapsed_s=0))


@router.post("/api/chat/stream")
def chat_stream(req: StreamReq, request: Request):
    gen = _safe(req) if ops.allow(request, "chat") else _limited()
    return StreamingResponse(gen, media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/api/search")
def api_search(q: str, request: Request):
    if not ops.allow(request, "search"):
        raise HTTPException(429, "Too many searches; slow down a little.")
    return place.suggest(q[:120])


@router.get("/api/place")
def api_place(name: str, lon: float, lat: float, request: Request):
    if not ops.allow(request, "search"):
        raise HTTPException(429, "Too many requests.")
    return place.wiki(name[:120], [lon, lat]) or {}


@router.get("/api/satellites")
def api_satellites():
    return ops.satellites()


main.app.add_middleware(GZipMiddleware, minimum_size=1024)       # JSON only in practice: SSE and images are excluded/incompressible
main.app.add_middleware(ops.MemoryStatic, root=CACHE)              # hot PNG layers and result files served from RAM
main.app.add_middleware(ops.CacheHeaders)                          # outermost: adds Cache-Control to everything above
