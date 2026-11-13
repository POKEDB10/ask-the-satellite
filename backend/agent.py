"""agent.py - LLM planner (JSON schema) + rule-router fallback + deterministic cards + number guard.
The LLM never sees pixels and never computes: it plans, and it writes ONE hedged interpretation sentence."""
import datetime as dt, json, os, re
from typing import Literal
import httpx
from pydantic import BaseModel, ValidationError
import presets

OLLAMA = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
MODELS = [m for m in (os.getenv("LLM_MODEL", "qwen2.5:7b-instruct-q4_K_M"), os.getenv("LLM_FALLBACK", ""), os.getenv("LLM_SMALL", "qwen3.5:4b-q4_K_M")) if m]
TIMEOUT = float(os.getenv("LLM_TIMEOUT", "6"))


class PlanOut(BaseModel):                       # what the LLM may fill in (this is the Ollama `format` schema)
    intent: Literal["analyze", "explain_last", "out_of_scope"] = "analyze"
    place: str | None = None
    preset_id: str | None = None
    index: Literal["mndwi", "ndvi", "flood", "nbr", "auto"] = "auto"
    date_before: str | None = None              # only if the user wrote a date or year
    date_after: str | None = None
    language: Literal["en", "ar", "hi"] = "en"


class Plan(PlanOut):
    source: str = "rules"
    note: str | None = None


# ----------------------------------------------------------------- LLM call
def _chat(model, system, user, schema=None, max_tokens=150, timeout=None):
    body = {"model": model, "stream": False, "keep_alive": "24h", "think": False,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "options": {"temperature": 0, "num_ctx": 4096, "num_predict": max_tokens}}
    if schema:
        body["format"] = schema
    r = httpx.post(f"{OLLAMA}/api/chat", json=body, timeout=timeout or TIMEOUT)
    r.raise_for_status()
    return re.sub(r"<think>.*?</think>", "", r.json()["message"]["content"], flags=re.S).strip()


def llm_up():
    try:
        names = [m["name"] for m in httpx.get(f"{OLLAMA}/api/tags", timeout=1.5).json().get("models", [])]
        return next((m for m in MODELS if m in names), None)
    except Exception:
        return None


# ----------------------------------------------------------------- rule router (also the test oracle)
IDX = [("flood", r"flood|inundat|storm|overflow|فيضان"), ("nbr", r"fire|burn|wildfire|scar|حريق"),
       ("ndvi", r"forest|tree|veg|farm|oasis|mangrove|green|deforest|crop|city|urban|build|road|sprawl|غابة|زراعة|مدينة"),
       ("mndwi", r"water|lake|sea|island|reclaim|reservoir|drought|shrink|coast|dam|river|بحيرة|بحر|جزيرة|مياه")]
SCOPE = r"change|before|after|compare|since|satellite|differ|grow|shrink|expand|لماذا|قبل|بعد|تغير"
WHY = r"\bwhy\b|how (sure|confident|reliable)|grey|gray|hatch|mask|hole|cloud|confidence|trust|explain|what does|لماذا|رمادي|ثقة"
STOP = {"Show", "Compare", "What", "How", "Is", "Why", "Did", "Does", "Where", "Which", "Look", "Map", "Find", "Tell", "Can", "Could", "Burn", "The"}


def _lang(q):
    return "ar" if re.search(r"[؀-ۿ]", q) else "hi" if re.search(r"[ऀ-ॿ]", q) else "en"


def _years(q):
    return sorted(set(re.findall(r"\b(19[89]\d|20[0-3]\d)\b", q)))


def rule_router(q, has_last=False):
    lang, pid, ys = _lang(q), presets.match(q), _years(q)
    if has_last and re.search(WHY, q, re.I) and not pid:
        return Plan(intent="explain_last", language=lang)
    idx = next((i for i, rx in IDX if re.search(rx, q, re.I)), None)
    if not (pid or idx or ys or re.search(SCOPE, q, re.I)):
        return Plan(intent="out_of_scope", language=lang)
    pr = presets.PRESETS.get(pid) if pid else None
    p = Plan(language=lang, preset_id=pid, index=(pr["index"] if pr else idx or "auto"))
    if len(ys) >= 2 or (pr and ys):                              # years the user wrote override preset dates
        y1, y2 = (ys[0], ys[-1]) if len(ys) >= 2 else (pr["before"][:4], ys[0])
        md_b, md_a = (pr["before"][5:], pr["after"][5:]) if pr else ("06-15", "06-15")
        p.date_before, p.date_after = f"{y1}-{md_b}", f"{y2}-{md_a}"
    elif len(ys) == 1 and not pr:
        p.date_before = f"{ys[0]}-06-15"
    if not pr:
        caps = []
        for c in re.findall(r"[A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+){0,3}", q):
            tok = c.split()
            while tok and tok[0] in STOP:                          # 'Compare Dubai Marina' -> 'Dubai Marina'
                tok.pop(0)
            if tok:
                caps.append(" ".join(tok))
        p.place = max(caps, key=len) if caps else None
        if re.search(r"city|urban|build|road|sprawl", q, re.I) and idx == "ndvi":
            p.note = "urban_not_measured"
    return p


# ----------------------------------------------------------------- planner
PLAN_SYS = ("Convert a question about change seen from satellites into JSON. Fields: intent = analyze | explain_last (asks about the "
            "previous map: why grey, how sure) | out_of_scope (not about land, water, vegetation, cities, floods or fires). place = the "
            "place name as written, else null. preset_id = one of {ids} or null. index = mndwi (water), ndvi (vegetation), flood, nbr "
            "(burn scars) or auto. date_before / date_after = YYYY-MM-DD ONLY if the user wrote a date or year, else null. "
            "language = en, ar or hi (language of the question). Never invent dates.")


def _ground(p, q, has_last):
    for f in ("date_before", "date_after"):                      # dates must be in the question and valid
        v = getattr(p, f)
        try:
            ok = v and dt.date.fromisoformat(v) and v[:4] in q
        except ValueError:
            ok = False
        setattr(p, f, v if ok else None)
    if p.preset_id not in presets.PRESETS:
        p.preset_id = None
    if p.intent == "explain_last" and not has_last:
        p.intent = "analyze"
    return p


def plan(q, has_last=False):
    rp = rule_router(q, has_last)
    if rp.intent == "explain_last" or (rp.preset_id and rp.intent == "analyze"):   # clear rule hit: fast, offline, no LLM needed
        return rp
    schema, sysmsg = PlanOut.model_json_schema(), PLAN_SYS.format(ids=", ".join(presets.PRESETS))
    for m in MODELS:
        try:
            p = Plan(**PlanOut.model_validate_json(_chat(m, sysmsg, q, schema)).model_dump(), source=f"llm:{m}")
            p = _ground(p, q, has_last)
            if _lang(q) != "en":
                p.language = _lang(q)
            if p.intent == "analyze" and not p.place and not p.preset_id:
                p.place = rp.place                               # the router found a name the LLM missed
            return p
        except Exception:                                        # bad JSON, timeout, Ollama down, missing model: next model, then rules
            continue
    return rp


# ----------------------------------------------------------------- deterministic cards
NOUN = {"mndwi": ("water area", "مساحة المياه"), "flood": ("flooded area", "المساحة المغمورة"),
        "ndvi": ("vegetated area", "مساحة الغطاء النباتي"), "nbr": ("burned area", "المساحة المحترقة"),
        "ndwi": ("surface water area", "مساحة المياه السطحية")}
FLAG = {"cross_sensor": ("Different satellites: resolution and bands differ", "أقمار مختلفة: الدقة والنطاقات تختلف"),
        "season_mismatch": ("Dates are more than 45 days apart in the season", "فارق موسمي يتجاوز 45 يوماً"),
        "landsat7_slc_gaps": ("Landsat 7 stripe gaps are treated as no data", "فجوات لاندسات 7 تُعد بيانات مفقودة"),
        "low_valid_pixels": ("Less than 60% of the area could be measured", "أقل من 60% من المنطقة قابلة للقياس")}
T = {"en": dict(measured="Between {db} ({sb}) and {da} ({sa}), the {noun} {verb} by {net:.1f} km²{pct}, about {pitches:,} football pitches. Gained {gain:.1f} km², lost {loss:.1f} km².",
                hidden="Too much cloud to measure reliably: only {valid:.0f}% of the area is clear on both dates. No area figure is shown.",
                quality="{valid:.0f}% of the area had clear pixels on both dates; {masked:.0f}% was masked (cloud, shadow, no data). Confidence: {level}.",
                optical=" Optical imagery shows surface extent, not depth or volume.", small=" Changes under {px} pixels were ignored ({km:.1f} km²).",
                grew="grew", shrank="shrank", oos="I answer questions about land, water, vegetation, floods and fires seen from satellites. Try a place and a question, or pick a story.",
                nofix="Consistent with the context noted for this location; satellite imagery alone cannot establish the cause."),
     "ar": dict(measured="بين {db} ({sb}) و{da} ({sa})، {verb} {noun} بمقدار {net:.1f} كم²{pct}، أي نحو {pitches:,} ملعب كرة قدم. المكتسب {gain:.1f} كم² والمفقود {loss:.1f} كم².",
                hidden="الغيوم كثيرة جداً للقياس بدقة: {valid:.0f}% فقط من المنطقة صافية في التاريخين. لا يُعرض رقم للمساحة.",
                quality="{valid:.0f}% من المنطقة كانت واضحة في التاريخين؛ {masked:.0f}% تم استبعادها (غيوم، ظلال، بيانات مفقودة). مستوى الثقة: {level}.",
                optical=" الصور البصرية تُظهر امتداد السطح لا العمق ولا الحجم.", small=" تم تجاهل التغيرات الأصغر من {px} بكسل ({km:.1f} كم²).",
                grew="ازدادت", shrank="انكمشت", oos="أجيب عن أسئلة الأرض والمياه والنباتات والفيضانات والحرائق كما تُرى من الأقمار الصناعية. اذكر مكاناً وسؤالاً أو اختر قصة.",
                nofix="يتسق ذلك مع السياق المذكور لهذا الموقع؛ لا تكفي صور الأقمار الصناعية وحدها لتحديد السبب.")}
LEVEL_AR = {"HIGH": "عالٍ", "MEDIUM": "متوسط", "LOW": "منخفض"}


def _plat(p):
    p = (p or "").replace("-", " ").title().replace("Sentinel 2", "Sentinel-2")
    return p[:-1] + p[-1].upper() if p.startswith("Sentinel-2") and p[-1].isalpha() else p


def _t(lang):
    return T["ar" if lang == "ar" else "en"]


def measured_card(a, lang="en"):
    st, q, t = a["stats"], a["quality"], _t(lang)
    if q["headline_hidden"]:
        return t["hidden"].format(valid=st["valid_pct_both"])
    net, base = st["net_km2"], st["area_before_km2"]
    pct = f" ({100 * net / base:+.0f}%)" if base > 0 else ""
    sb, sa = a["scene_before"], a["scene_after"]
    return t["measured"].format(db=sb["day"], sb=_plat(sb["platform"]), da=sa["day"], sa=_plat(sa["platform"]), noun=NOUN[a["index"]][lang == "ar"],
                                verb=t["grew"] if net >= 0 else t["shrank"], net=abs(net), pct=pct, pitches=st["football_pitches"], gain=st["gain_km2"], loss=st["loss_km2"])


def quality_card(a, lang="en"):
    st, q, t = a["stats"], a["quality"], _t(lang)
    level = LEVEL_AR[q["confidence"]] if lang == "ar" else q["confidence"]
    s = t["quality"].format(valid=st["valid_pct_both"], masked=100 - st["valid_pct_both"], level=level)
    if a["index"] in ("mndwi", "flood"):
        s += t["optical"]
    if st["ignored_small_km2"] > 0:
        s += t["small"].format(px=st["min_mapping_unit_px"], km=st["ignored_small_km2"])
    return dict(text=s, level=q["confidence"], flags=[FLAG[f][lang == "ar"] for f in q["flags"] if f in FLAG])


# ----------------------------------------------------------------- interpretation + number guard
_AR = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
HEDGE = re.compile(r"consistent with|may |could |might |suggest|possibly|appears|likely|can't establish|cannot establish", re.I)
BAD = re.compile(r"\b(caused by|proves?|definitely|certainly|because of|due to)\b", re.I)


def _nums(s):
    return set(re.findall(r"\d+(?:\.\d+)?", s.translate(_AR).replace(",", "")))


def numbers_ok(text, facts):
    """Every number in the sentence must already be in the facts we gave the model."""
    return _nums(text) <= _nums(facts)


def facts_block(a, context=""):
    st, sb, sa = a["stats"], a["scene_before"], a["scene_after"]
    return (f"index: {NOUN[a['index']][0]}\nbefore: {sb['day']} {_plat(sb['platform'])}\nafter: {sa['day']} {_plat(sa['platform'])}\n"
            f"net change: {st['net_km2']:+.1f} sq km (gained {st['gain_km2']:.1f}, lost {st['loss_km2']:.1f})\n"
            f"clear pixels on both dates: {st['valid_pct_both']:.0f} percent\nconfidence: {a['quality']['confidence']}\n"
            + (f"CONTEXT (verified background): {context}\n" if context else ""))


def interpretation(a, context="", lang="en", use_llm=True):
    """-> (text, source). LLM sentence if it passes the guard, else the fixed template."""
    fallback = _t(lang)["nofix"] if not context else (f"Consistent with the context noted for this location: {context} Satellite imagery alone cannot establish the cause." if lang != "ar" else _t(lang)["nofix"])
    if a["quality"]["headline_hidden"] or not use_llm:
        return fallback, "template"
    facts = facts_block(a, context)
    sysmsg = ("You explain satellite measurements to a general audience. Write at most two short sentences in "
              f"{ {'en': 'English', 'ar': 'Arabic', 'hi': 'Hindi'}[lang] }. Use cautious wording such as 'consistent with' or 'may reflect'. "
              "Never state a cause as fact. Do not write any number that is not in FACTS or CONTEXT. Do not repeat the measurements.")
    for m in MODELS[:2]:
        try:
            txt = _chat(m, sysmsg, facts, max_tokens=80)
        except Exception:
            continue
        if txt and len(txt) < 400 and numbers_ok(txt, facts) and not BAD.search(txt) and (lang != "en" or HEDGE.search(txt)):
            return txt, f"llm:{m}"
    return fallback, "template"


def explain_last(a, lang="en"):
    q = quality_card(a, lang)
    extra = " Grey hatching on the map marks pixels that could not be measured; they are never counted as 'no change'." if lang != "ar" else \
        " التظليل الرمادي على الخريطة يشير إلى بكسلات لم يمكن قياسها ولا تُحسب كأنها \"بلا تغيير\"."
    return q["text"] + extra
