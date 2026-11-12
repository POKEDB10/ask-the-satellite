"""extras.py - additive routes for the globe UI: /api/compare, /api/chat/stream (SSE), /api/config.
Numbers still come only from change.run_change; this module only loads cached frames and orchestrates."""
import datetime as dt, json, math, os, pathlib, re, threading, time
import numpy as np, xarray as xr
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
import agent, change, geocode, presets
import main                                   # imported while main is still loading: attributes are read at call time

router = APIRouter()


def _warm():
    """Load the primary model into VRAM once at server start (research §3.1). A cold 7B load takes longer than the
    6 s chat timeout, which otherwise makes every request fall back to the small model and evict the big one."""
    try:
        agent._chat(agent.MODELS[0], "Reply with OK.", "OK", max_tokens=2, timeout=180)
    except Exception:
        pass                                                     # Ollama down: the rule router and templates still answer


threading.Thread(target=_warm, daemon=True).start()
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
    if y1 not in bank or y2 not in bank or index not in ("mndwi", "ndvi") or y1 == y2:
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
}


@router.get("/api/config")
def api_config():
    h = main.health()
    return dict(arcgis_key=os.getenv("ARCGIS_API_KEY") or None, basemap_order=["esri", "naturalearth"],
                attributions=ATTRIBUTIONS, model=h.get("model"), online=h.get("online", False),
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


def _preset_analysis(pid, ys, notes):
    """Year handling: the bank decides. Returns an Analysis, or None after adding a note listing what exists."""
    bank = frame_years(pid)
    if bank:
        if len(ys) >= 2:
            y1, y2 = ys[0], ys[-1]
            if y1 in bank and y2 in bank:
                return compare(pid, y1, y2)
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


def _stream(req):
    t0 = time.time()
    last = main.load_analysis(req.last_analysis_id)
    q = req.message or ""
    rp = agent.rule_router(q, has_last=bool(last))
    if req.preset_id in presets.PRESETS:
        rp.preset_id, rp.index, rp.intent, rp.source = req.preset_id, presets.PRESETS[req.preset_id]["index"], "analyze", "gallery"
    pr = presets.PRESETS.get(rp.preset_id)
    yield _ev("plan", dict(plan=rp.model_dump(), fly_to=pr["bbox"] if pr else None, source="rules"))
    p = rp
    if not (rp.preset_id or rp.intent == "explain_last"):
        yield _ev("progress", dict(step="locate", state="active", label="Reading the question"))
        p = agent.plan(q, has_last=bool(last))
        if p.preset_id and p.preset_id != presets.match(p.place or ""):     # the LLM tied a nearby preset to another place
            p.preset_id = None                                             # (e.g. Dubai Marina -> Palm): measure the named place
        if p.intent == "explain_last":                                     # the rule router already caught real "why grey?" questions;
            p.intent = "analyze"                                           # the 7B over-uses explain_last (bake-off), so never trust it alone
        pr = presets.PRESETS.get(p.preset_id)
        yield _ev("plan", dict(plan=p.model_dump(), fly_to=pr["bbox"] if pr else None, source=p.source))
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
    if not pr:
        g = geocode.geocode(p.place) if p.place else None
        if not g:
            yield _ev("cards", dict(measured="I could not find that place. Try a place name, or pick one of the stories.", kind="info"))
            return
        if ys and min(ys) < "2016":
            pid = _nearest_preset(g["center"])
            notes.append("No precomputed history for this place; showing the nearest preset.")
            if not pid:
                yield _ev("cards", dict(measured="No precomputed history for this place, and no preset is cached yet.", kind="info", notes=notes))
                return
            pr, p.preset_id, ys = presets.PRESETS[pid], pid, []
        else:
            yield _ev("plan", dict(plan=p.model_dump(), fly_to=g["bbox"], source="geocode", place=g["name"], clamped=g.get("clamped", False)))
    if pr:
        yield _ev("plan", dict(plan=p.model_dump(), fly_to=pr["bbox"], source="preset"))
    yield _ev("progress", dict(step="locate", state="done", label="Locating"))
    yield _ev("progress", dict(step="scenes", state="active", label="Picking scenes"))
    if pr:
        a = _preset_analysis(p.preset_id, ys, notes)
        if a is None:
            yield _ev("cards", dict(measured=notes[-1], kind="info", next=_next_chips(p.preset_id, None)))
            return
    else:
        d_after = dt.date.fromisoformat(p.date_after) if p.date_after else dt.date.today()
        d_before = dt.date.fromisoformat(p.date_before) if p.date_before else max(dt.date(2016, 1, 1), d_after.replace(year=d_after.year - 5))
        a = main.analyze(g["bbox"], str(d_before), str(d_after), p.index, "auto", None, (30, 45), 40, title=g["name"])
        a = {**a, "context": None}
        if g.get("clamped"):
            notes.append("Analysing a 33 km window around the centre.")
    yield _ev("progress", dict(step="scenes", state="done", label="Picking scenes"))
    yield _ev("progress", dict(step="measure", state="done", label="Measuring change"))
    yield _ev("analysis", a)
    if p.preset_id:
        n = _milestone_note(a, p.preset_id)
        if n:
            notes.append(n)
    if p.note == "urban_not_measured":
        notes.append("Built-up area is not measured; showing vegetation change.")
    cards = dict(kind="analysis", measured=agent.measured_card(a, lang), quality=agent.quality_card(a, lang), notes=notes,
                 context=a.get("context"), next=_next_chips(p.preset_id, a), interpretation=None)
    if not a.get("context"):
        text, src = agent.interpretation(a, pr["context"] if pr else "", lang, use_llm=p.source != "gallery")
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
        msg = "No clear satellite scene was found for those dates. Try other dates or a story." if kind == "NoScene" else \
              f"The live data source did not answer ({kind}). Pick a pre-computed story."
        yield _ev("cards", dict(measured=msg, kind="error"))
        yield _ev("done", dict(elapsed_s=round(time.time() - t0, 1)))


@router.post("/api/chat/stream")
def chat_stream(req: main.ChatReq):
    return StreamingResponse(_safe(req), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
