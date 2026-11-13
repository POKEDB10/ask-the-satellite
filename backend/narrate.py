"""narrate.py - the storyteller. Streams a short narrative from the local model, sentence by sentence.
Each sentence must pass the number guard (agent.numbers_ok) and the causal-claim filter before it is sent; a failing
sentence is dropped, never shown. Finished narratives are cached per subject, so a burst of identical questions costs
one model call. Without a model (public demo host) nothing is streamed and the deterministic cards carry the answer."""
import json, os, pathlib, re, threading, time
import httpx
import agent, ops

DISK = pathlib.Path(__file__).parent / "cache" / "narration.json"   # shared by all workers and restarts; committed for the stories

SPLIT = re.compile(r"(?<=[.!?؟])\s+")
_cache, _clock, _inflight = {}, threading.Lock(), {}
LANG = {"en": "English", "ar": "Arabic", "hi": "Hindi"}


def _clean(s):
    s = re.sub(r"<think>.*?</think>", "", s, flags=re.S)
    return re.sub(r"[*_#`]+", "", s).strip().lstrip("-• ").strip()


NAME = re.compile(r"\b([A-Z][\w'’\-]{2,})")
COMMON = {"The", "This", "These", "Nearby", "For", "However", "According", "Between", "While", "Its", "It", "In", "On", "At", "A", "An",
          "Visitors", "Shopping", "If", "Also", "Satellite", "Satellites", "Landsat", "Sentinel",
          "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"}


def _names_ok(s, facts):
    """Every proper noun after the first word must appear in FACTS: the model may not add places or sources of its own."""
    low = facts.lower()
    words = NAME.findall(s.split(" ", 1)[1] if " " in s else "")              # the first word is capitalised anyway
    return all(w in COMMON or w.lower() in low for w in words)


def _ok(s, facts):
    return 8 < len(s) < 420 and agent.numbers_ok(s, facts) and not agent.BAD.search(s) and _names_ok(s, facts)


MEASURE_NUM = re.compile(r"\d+(?:\.\d+)?\s*(?:km|square kilomet|sq km|football)")


def _scrub(s):
    """A sentence that states the satellite's own measurement must not credit it to a news source."""
    return re.sub(r",?\s*(according to|as reported by|reported by)\s+[^,.;]+", "", s) if MEASURE_NUM.search(s) else s


def _kstr(key):
    return "|".join(map(str, key))


def _disk_load():
    try:
        return json.loads(DISK.read_text(encoding="utf-8"))
    except Exception:
        return {}


_disk, _disk_t = _disk_load(), time.time()


def _disk_get(key):
    global _disk, _disk_t
    if time.time() - _disk_t > 30:                                    # pick up narrations written by other workers
        _disk, _disk_t = _disk_load(), time.time()
    return _disk.get(_kstr(key))


DISK_MAX = 200


def _persistable(key):
    """Only story narrations go to disk: keys built from server-side preset analyses, a small fixed set."""
    if len(key) == 5 and key[0] == "place":                          # recorded briefs for a fixed list of demo places only
        return key[1] in PERSIST_PLACES
    return len(key) == 3 and key[0] == "change" and str(key[1]).startswith("presets:") and len(str(key[1])) < 80


PERSIST_PLACES = {"dubai", "kyoto", "palm jumeirah", "burj khalifa", "lake mead", "aral sea"}


def _disk_put(key, sentences, model):
    if not _persistable(key):
        return
    with _clock:
        d = _disk_load()
        while len(d) >= DISK_MAX:
            d.pop(next(iter(d)))
        d[_kstr(key)] = {"sentences": sentences, "model": model, "at": time.strftime("%Y-%m-%d")}
        tmp = DISK.with_suffix(".tmp")
        tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, DISK)                                         # atomic: other workers never read half a file


def recorded(key):
    """-> (sentences, model) from the shared cache, or (None, None)."""
    hit = _disk_get(key)
    return (hit["sentences"], hit.get("model")) if hit else (None, None)


def available(key=None):
    return bool(agent.MODELS) or (key is not None and recorded(key)[0] is not None)


def stream(system, facts, key, max_tokens=260):
    """Yields guarded sentences. Replays from cache when the same subject was narrated before."""
    if key in _cache:
        yield from _cache[key]
        return
    sent, _ = recorded(key)
    if sent:
        _cache[key] = sent
        yield from sent
        return
    with _clock:
        ev = _inflight.get(key)
        mine = ev is None
        if mine:
            ev = _inflight[key] = threading.Event()
    if not mine:                                                      # the same story is being told to someone else right now:
        ev.wait(25)                                                   # wait for it and replay, instead of a second model call
        yield from _cache.get(key, [])
        return
    try:
        yield from _generate(system, facts, key, max_tokens)
    finally:
        with _clock:
            _inflight.pop(key, None)
        ev.set()


MAX_SENTENCES, MAX_WORDS = 3, 65


def _room(out, s):
    return len(out) < MAX_SENTENCES and sum(len(x.split()) for x in out) + len(s.split()) <= MAX_WORDS


def _generate(system, facts, key, max_tokens):
    if not agent.MODELS or not ops.LLM_GATE.try_enter(wait=2.5):     # busy: skip the narrative, the cards still answer
        return
    out = []
    try:
        body = {"model": agent.MODELS[0], "stream": True, "keep_alive": "24h", "think": False,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": facts}],
                "options": {"temperature": 0.3, "num_ctx": 4096, "num_predict": max_tokens}}
        with httpx.stream("POST", f"{agent.OLLAMA}/api/chat", json=body, timeout=httpx.Timeout(25, connect=2, read=10)) as r:
            r.raise_for_status()
            buf = ""
            for line in r.iter_lines():
                if not line:
                    continue
                j = json.loads(line)
                buf += j.get("message", {}).get("content", "")
                parts = SPLIT.split(buf)
                for s in parts[:-1]:
                    s = _scrub(_clean(s))
                    if _ok(s, facts) and _room(out, s):
                        out.append(s)
                        yield s
                buf = parts[-1]
                if j.get("done") or len(out) >= MAX_SENTENCES:
                    break
            s = _scrub(_clean(buf))
            if len(out) < MAX_SENTENCES and _ok(s, facts) and _room(out, s):
                out.append(s)
                yield s
    except Exception:
        pass                                                          # model down mid-stream: keep what was already validated
    finally:
        ops.LLM_GATE.leave()
    if out:
        with _clock:
            if len(_cache) > 500:
                _cache.pop(next(iter(_cache)))
            _cache[key] = out
        try:
            _disk_put(key, out, agent.MODELS[0])
        except Exception:
            pass                                                      # read-only disk: the in-memory cache still works


def place_prompt(name, lang):
    return (f"You write an Earth observation field brief for {name}, in {LANG.get(lang, 'English')}, inside a satellite-imagery "
            "app. Using ONLY the FACTS (from Wikipedia), write 2 or 3 factual sentences, at most 60 words, on what a satellite would "
            "see: terrain, urban footprint, coastline or water bodies, and environmental context. No tourist advice, no sightseeing "
            "tips, no opinions, no filler. Do not invent anything that is not in FACTS. Do not write any number that is not in FACTS. "
            "No lists, no headings, no markdown.")


def place_facts(name, w):
    m = (w or {}).get("main") or {}
    lines = [f"PLACE: {name}"]
    if m:
        lines.append(f"ABOUT ({m.get('title')}): {m.get('description') or ''}. {m.get('extract') or ''}")
    for n in (w or {}).get("nearby", [])[:6]:
        lines.append(f"NEARBY: {n['title']} ({n['dist_km']} km away): {n.get('description') or ''}. {n.get('extract') or ''}")
    return "\n".join(lines)


def change_prompt(lang):
    return (f"You write a field summary of a satellite change measurement, in {LANG.get(lang, 'English')}. Exactly 3 crisp factual "
            "sentences, at most 60 words in total, no conversational filler. 1) The physical change measured between the two dates, with "
            "the sensors (from MEASURED). 2) What the named sources report happened, naming the source exactly as written on its SOURCE "
            "line (for example 'According to The National, ...'). Never credit a claim to a different source. 3) The primary "
            "environmental implication reported by the sources, marked as reported. If a NOTE says the window predates the work, say the images show the coast before the work "
            "began, so little change is expected. Use cautious wording for causes. Do not write any number that is not in the text below. "
            "No lists, no headings, no markdown.")


def change_facts(a, ctx, notes, measured):
    # net change only: with the gross gain/loss in view the 7B said "shrank by" the gross loss (18.8 vs net 18.4 km2)
    measured = re.sub(r"\s*Gained [\d.,]+ km², lost [\d.,]+ km²\.?", "", measured)
    lines = [f"MEASURED (shown on screen): {measured}",
             f"DATA QUALITY: {a['stats']['valid_pct_both']:.0f} percent of the area was clear on both dates; confidence {a['quality']['confidence']}."]
    if ctx:
        lines += [f"SOURCE {x['source_title']}: {x['text']}" for x in ctx.get("what_happened", [])]
        lines += [f"SOURCE {x['source_title']}: {x['text']}" + (" (disputed by the developer)" if x.get("disputed") else "")
                  for x in ctx.get("downsides", [])[:4]]
    lines += [f"NOTE: {x}" for x in notes or []]
    return "\n".join(lines)
