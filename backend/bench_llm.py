"""bench_llm.py - planner bake-off (research §3.1). Run with Ollama up:  python bench_llm.py model1 model2 ...
Per model: valid JSON %, correct intent+preset %, median/p95 plan latency, interpretation latency, and `ollama ps` processor split."""
import os, shutil, statistics, subprocess, sys, time
import agent, presets

Q = [("Show Palm Jumeirah before and after the land reclamation.", "analyze", "palm_jumeirah"),
     ("How much did the April 2024 flood affect Dubai?", "analyze", "dubai_flood_2024"),
     ("What changed at Lake Mead between 2019 and 2022?", "analyze", "lake_mead"),
     ("Is the Aral Sea really gone?", "analyze", "aral_sea"),
     ("Show deforestation in Rondônia, Brazil.", "analyze", "rondonia"),
     ("أظهر لي جزيرة نخلة جميرا قبل وبعد", "analyze", "palm_jumeirah"),
     ("Why is part of the map greyed out?", "explain_last", None),
     ("Burn scar of the Jasper wildfire.", "analyze", "jasper_wildfire"),
     ("Compare Dubai Marina in 2018 and now.", "analyze", None),
     ("What is the capital of France?", "out_of_scope", None)]
FACTS = agent.facts_block({"index": "mndwi", "stats": {"net_km2": -8.59, "gain_km2": 0.04, "loss_km2": 8.63, "valid_pct_both": 100.0},
                           "scene_before": {"day": "2001-05-22", "platform": "landsat-7"}, "scene_after": {"day": "2008-05-17", "platform": "landsat-5"},
                           "quality": {"confidence": "MEDIUM"}}, "Construction began in June 2001.")


def ps():
    try:
        return subprocess.run([shutil.which("ollama") or os.path.expandvars(r"%LOCALAPPDATA%\Programs\Ollama\ollama.exe"), "ps"], capture_output=True, text=True, timeout=10).stdout.strip().splitlines()[-1]
    except Exception as e:
        return f"ollama ps failed: {e}"


def bench(model, runs=3):
    schema, sysmsg = agent.PlanOut.model_json_schema(), agent.PLAN_SYS.format(ids=", ".join(presets.PRESETS))
    agent._chat(model, sysmsg, "warm up", schema, timeout=120)                    # load into VRAM first
    ok_json = ok_plan = n = 0
    lat = []
    for q, intent, pid in Q:
        for _ in range(runs):
            n += 1
            t = time.perf_counter()
            try:
                raw = agent._chat(model, sysmsg, q, schema, timeout=30)
                lat.append(time.perf_counter() - t)
                p = agent.PlanOut.model_validate_json(raw)
                ok_json += 1                                                  # score the grounded plan, as agent.plan() uses it
                p = agent._ground(agent.Plan(**p.model_dump()), q, has_last=intent == "explain_last")
                ok_plan += p.intent == intent and (p.preset_id or None) == pid
            except Exception:
                lat.append(time.perf_counter() - t)
    il = []
    for _ in range(3):
        t = time.perf_counter()
        txt = agent._chat(model, "Write at most two short hedged sentences. Do not write any number that is not in FACTS.", FACTS, max_tokens=80, timeout=30)
        il.append(time.perf_counter() - t)
    lat.sort()
    return dict(model=model, json=f"{ok_json}/{n}", plan=f"{ok_plan}/{n}", p50=round(statistics.median(lat), 2), p95=round(lat[int(0.95 * (len(lat) - 1))], 2),
                interp_p50=round(statistics.median(il), 2), numbers_ok=agent.numbers_ok(txt, FACTS), ps=ps())


if __name__ == "__main__":
    for m in sys.argv[1:]:
        print(bench(m), flush=True)
