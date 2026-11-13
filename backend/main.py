"""main.py - FastAPI routes + the analyze orchestrator.  Run:  uvicorn main:app --port 8000   (from backend/)"""
import datetime as dt, hashlib, json, pathlib, shutil, time
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import agent, change, geocode, presets, stac_fetch as sf

ROOT = pathlib.Path(__file__).parent
CACHE = ROOT / "cache"; (CACHE / "live").mkdir(parents=True, exist_ok=True); (CACHE / "presets").mkdir(parents=True, exist_ok=True)
app = FastAPI(title="Ask the Satellite")


# ------------------------------------------------------------------ orchestrator
def sensor_for(day, hint="auto"):
    return hint if hint in ("landsat", "sentinel-2") else ("landsat" if day < dt.date(2016, 1, 1) else "sentinel-2")


def _pick(bbox, day, sensor, res, window, max_cloud):
    last = None
    for src in ("earthsearch", "pc") if sensor == "sentinel-2" else ("pc",):
        try:
            return sf.pick_scene(bbox, str(day), sensor=sensor, window_days=window, max_cloud=max_cloud, source=src, res=res)
        except sf.NoScene as e:
            last = e                                              # nothing clear in the window: stop, do not retry elsewhere
            break
        except Exception as e:                                    # catalog down / timeout: try the other catalog
            last = e
    raise last


def _scene(S):
    return dict(ids=S["scene_ids"], day=str(S["day"]), datetime=S["datetime"], platform=S["platform"], sensor=S["sensor"],
                resolution_m=S["res"], catalog=S["source"], candidates=S["candidates"])


def _attr(A, B):
    ys = sorted({str(S["day"])[:4] for S in (A, B)})
    parts = []
    if any(S["sensor"] == "sentinel-2" for S in (A, B)):
        parts.append(f"Contains modified Copernicus Sentinel data {', '.join(ys)}, processed by ESA")
    if any(S["sensor"] == "landsat" for S in (A, B)):
        parts.append("Landsat imagery courtesy of the U.S. Geological Survey")
    return "; ".join(parts) + "; via " + ", ".join(sorted({"Earth Search (Element 84)" if S["source"] == "earthsearch" else "Microsoft Planetary Computer" for S in (A, B)}))


def analyze(bbox, d_before, d_after, index="mndwi", sensor="auto", res=None, win=(30, 30), max_cloud=40, strict=False, rel=None, title=None):
    """Pick best clear day for each date, load both on one grid, run the change engine, write cache/<rel>/result.json."""
    d_before, d_after = dt.date.fromisoformat(d_before), dt.date.fromisoformat(d_after)
    key = hashlib.sha1(json.dumps([bbox, str(d_before), str(d_after), index, sensor, res, strict]).encode()).hexdigest()[:10]
    rel = rel or f"live/{key}"
    out = CACHE / rel
    if (out / "result.json").exists() and not rel.startswith("presets"):
        return json.loads((out / "result.json").read_text())
    sb, sa = sensor_for(d_before, sensor), sensor_for(d_after, sensor)
    res = res or geocode.choose_res(bbox, (sb, sa))
    A = _pick(bbox, d_before, sb, res, win[0] if sb == "sentinel-2" else max(win[0], 45), max_cloud)
    B = _pick(bbox, d_after, sa, res, win[1] if sa == "sentinel-2" else max(win[1], 45), max_cloud)
    ranking = None
    if index == "auto":                                           # 'what changed the most?': same load, two indices
        trial = {}
        for ix in ("mndwi", "ndvi"):
            r = change.run_change(A, B, A["bounds"], ix, CACHE / "_tmp" / ix, strict=strict)
            trial[ix] = r["stats"]["gain_km2"] + r["stats"]["loss_km2"]
        ranking = sorted(({"index": k, "changed_km2": round(v, 2)} for k, v in trial.items()), key=lambda d: -d["changed_km2"])
        index = ranking[0]["index"]; shutil.rmtree(CACHE / "_tmp", ignore_errors=True)
    r = change.run_change(A, B, A["bounds"], index, out, strict=strict)
    res_json = dict(analysis_id=rel.replace("/", ":"), mode="preset" if rel.startswith("presets") else "live", title=title, index=index,
                    bounds=r["bounds"], scene_before=_scene(A), scene_after=_scene(B), stats=r["stats"], quality=r["quality"], ranking=ranking,
                    layers={k: f"/cache/{rel}/{k}.png" for k in ("rgb_before", "rgb_after", "change", "mask")}, attribution=_attr(A, B), error=None)
    (out / "result.json").write_text(json.dumps(res_json, default=str))
    return res_json


def run_preset(pid, force=False):
    pr = presets.PRESETS[pid]; f = CACHE / "presets" / pid / "result.json"
    if f.exists() and not force:
        return json.loads(f.read_text())
    return analyze(pr["bbox"], pr["before"], pr["after"], pr["index"], pr["sensor"], pr["res"], pr["win"], pr["max_cloud"], rel=f"presets/{pid}", title=pr["title"])


def load_analysis(aid):
    if not aid:
        return None
    f = CACHE / aid.replace(":", "/") / "result.json"
    return json.loads(f.read_text()) if f.exists() and ".." not in aid else None


# ------------------------------------------------------------------ routes
class AnalyzeReq(BaseModel):
    bbox: list[float]
    date_before: str
    date_after: str
    index: str = "mndwi"
    window_days: int = 30
    max_cloud: int = 40
    strict: bool = False


class ChatReq(BaseModel):
    message: str
    lang: str = "auto"
    last_analysis_id: str | None = None
    preset_id: str | None = None                                   # gallery click: skip the planner and the LLM


_health = [0.0, {}]


@app.get("/api/health")
def health():
    if time.time() - _health[0] > 15:
        try:
            stac = httpx.get(sf.ES, timeout=2).status_code < 500
        except Exception:
            stac = False
        m = agent.llm_up()
        _health[:] = [time.time(), dict(online=stac, stac=stac, ollama=bool(m), model=m)]
    return _health[1]


@app.get("/api/presets")
def list_presets():
    return [dict(id=k, title=v["title"], tier=v["tier"], cached=(CACHE / "presets" / k / "result.json").exists(), thumb=f"/cache/presets/{k}/rgb_after.png",
                 blurb=v["context"], before=v["before"], after=v["after"], sensor=v["sensor"], index=v["index"])
            for k, v in presets.PRESETS.items()]


@app.get("/api/presets/{pid}")
def get_preset(pid: str):
    if pid not in presets.PRESETS:
        raise HTTPException(404, "unknown preset")
    try:
        return extras.with_context(run_preset(pid), pid)          # additive: curated context field
    except Exception as e:
        raise HTTPException(503, f"preset not cached and live run failed: {e}")


@app.get("/api/analysis/{aid}")
def get_analysis(aid: str):
    a = load_analysis(aid)
    if not a:
        raise HTTPException(404, "not found")
    return a


@app.get("/api/geocode")
def api_geocode(q: str):
    g = geocode.geocode(q)
    if not g:
        raise HTTPException(404, "place not found")
    return g


@app.post("/api/analyze")
def api_analyze(r: AnalyzeReq):
    bbox, _ = geocode.clamp(r.bbox)
    try:
        return analyze(bbox, r.date_before, r.date_after, r.index, "auto", None, (r.window_days, r.window_days), r.max_cloud, r.strict)
    except sf.NoScene as e:
        raise HTTPException(422, f"No clear scene: {e}")
    except Exception as e:
        raise HTTPException(503, f"Analysis failed: {e}")


@app.post("/api/chat")
def chat(req: ChatReq):
    last = load_analysis(req.last_analysis_id)
    if req.preset_id in presets.PRESETS:
        p = agent.Plan(preset_id=req.preset_id, index=presets.PRESETS[req.preset_id]["index"], source="gallery")
    else:
        p = agent.plan(req.message, has_last=bool(last))
    lang = req.lang if req.lang in ("en", "ar", "hi") else p.language
    base = dict(plan=p.model_dump(), llm_used=p.source, actions=[], analysis=None)
    if p.intent == "out_of_scope":
        return {**base, "reply_measured": agent._t(lang)["oos"], "reply_quality": None, "reply_interpretation": None}
    if p.intent == "explain_last":
        return {**base, "reply_measured": agent.explain_last(last, lang), "reply_quality": None, "reply_interpretation": None, "analysis": last}
    pr = presets.PRESETS.get(p.preset_id) if p.preset_id else None
    try:
        if pr and not (p.date_before and p.date_after):
            a = run_preset(p.preset_id)
        elif pr:
            a = analyze(pr["bbox"], p.date_before, p.date_after, pr["index"], pr["sensor"], pr["res"], pr["win"], pr["max_cloud"], title=pr["title"])
        else:
            g = geocode.geocode(p.place) if p.place else None
            if not g:
                return {**base, "reply_measured": "I could not find that place. Try a place name, or pick one of the stories.", "reply_quality": None, "reply_interpretation": None}
            d_after = dt.date.fromisoformat(p.date_after) if p.date_after else dt.date.today()
            d_before = dt.date.fromisoformat(p.date_before) if p.date_before else max(dt.date(2016, 1, 1), d_after.replace(year=d_after.year - 5))
            a = analyze(g["bbox"], str(d_before), str(d_after), p.index, "auto", None, (30, 45), 40, title=g["name"])
            a["clamped"] = g.get("clamped", False)
    except sf.NoScene as e:
        return {**base, "reply_measured": f"No clear satellite scene was found for those dates ({e}). Try other dates or a story.", "reply_quality": None, "reply_interpretation": None}
    except Exception as e:
        return {**base, "reply_measured": f"The live data source did not answer ({type(e).__name__}). Pick a pre-computed story.", "reply_quality": None, "reply_interpretation": None}
    text, src = agent.interpretation(a, pr["context"] if pr else "", lang, use_llm=p.source != "gallery")
    return {**base, "analysis": a, "reply_measured": agent.measured_card(a, lang), "reply_quality": agent.quality_card(a, lang),
            "reply_interpretation": text, "interpretation_source": src, "note": p.note,
            "actions": [{"type": "fly_to", "bbox": a["bounds"]}, {"type": "show_analysis", "analysis_id": a["analysis_id"]}]}


import extras                                                      # additive: globe UI routes (compare, chat stream, config)
app.include_router(extras.router)
app.mount("/cache", StaticFiles(directory=CACHE), name="cache")
if (ROOT.parent / "web").exists():
    app.mount("/", StaticFiles(directory=ROOT.parent / "web", html=True), name="web")
