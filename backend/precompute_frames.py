"""precompute_frames.py - one cached frame per year for the Palm Jumeirah history (the compare bank).
Writes cache/frames/<preset>/<year>/{bands.npz, meta.json}. Same picker rules as stac_fetch, plus a strict
sensor-by-date rule: Landsat 7 before 1 Jun 2003, Landsat 5 after. Run:  python precompute_frames.py [year ...]"""
import datetime as dt, json, pathlib, sys, time
import numpy as np
import change, presets, stac_fetch as sf

ROOT = pathlib.Path(__file__).parent
FRAMES = ROOT / "cache" / "frames"
PRESET = "palm_jumeirah"
# order = most important first (the pitch needs 2001, 2008, 2000, Jan 2024)
TARGETS = [("2001", "landsat"), ("2008", "landsat"), ("2000", "landsat"), ("2024", "sentinel-2"),
           ("2002", "landsat"), ("2003", "landsat"), ("2004", "landsat"), ("2005", "landsat"), ("2006", "landsat"), ("2018", "sentinel-2")]
MIN_VALID = 60.0
RES = 30                                                     # one common 30 m grid for every frame


def target_date(year, sensor):
    return f"{year}-05-16" if sensor == "landsat" else f"{year}-01-15"   # Landsat: May +/- 1 month; S2: January


def platform_for(day):
    return "landsat-7" if day < dt.date(2003, 6, 1) else "landsat-5"


def _retry(fn, tries=4):
    for k in range(tries):                                   # Planetary Computer search timeouts are a known issue
        try:
            return fn()
        except sf.NoScene:
            raise
        except Exception as e:
            if k == tries - 1:
                raise
            wait = 5 * 2 ** k
            print(f"   retry in {wait}s after {type(e).__name__}: {e}", flush=True)
            time.sleep(wait)


def pick_frame(bbox, year, sensor, top_k=6):
    date = target_date(year, sensor)
    sources = ("pc",) if sensor == "landsat" else ("earthsearch", "pc")
    last = None
    for src in sources:
        try:
            win = 45 if sensor == "landsat" else 30
            rows, source = _retry(lambda: sf.search_days(bbox, date, sensor, window_days=win, max_cloud=60, source=src))
            break
        except Exception as e:
            last = e
    else:
        raise last
    if sensor == "landsat":                                  # sensor chosen by acquisition date, not by year
        for r in rows:
            r["items"] = [i for i in r["items"] if i.properties.get("platform") == platform_for(r["day"])]
        rows = [r for r in rows if r["items"]]
    if not rows:
        raise sf.NoScene(f"no {sensor} scene near {date}")
    cand = rows[:top_k]
    for r in cand:
        m = _retry(lambda: sf.load_day(r["items"], bbox, 60, sensor, source, ("scl",)))
        r["valid_pct_aoi"] = round(100 * float(change.valid_mask(m, sensor).mean()), 1)
    best = max(cand, key=lambda r: (round(r["valid_pct_aoi"] / 2), -r["dist"]))
    ds = _retry(lambda: sf.load_day(best["items"], bbox, RES, sensor, source))
    it = best["items"][0]
    sc, off = sf.scale_offset(it, sensor)
    ext = ds.odc.geobox.geographic_extent.boundingbox
    return ds, dict(year=year, sensor=sensor, scale=sc, offset=off, day=str(best["day"]), platform=it.properties.get("platform"),
                    scene_ids=[i.id for i in best["items"]], datetime=it.datetime.isoformat(), source=source, res=RES,
                    bounds=[ext.left, ext.bottom, ext.right, ext.top], target=date,
                    candidates=[dict(day=str(r["day"]), cloud_tile=round(r["cloud_tile"], 1), valid_pct_aoi=r["valid_pct_aoi"]) for r in cand])


def frame_valid_pct(ds, meta):
    v = change.valid_mask(ds, meta["sensor"]) & np.isfinite(change.reflectance(ds, "green", meta["scale"], meta["offset"], meta["sensor"]))
    return round(100 * float(v.mean()), 1)


def save(ds, meta, preset=PRESET):
    out = FRAMES / preset / meta["year"]
    out.mkdir(parents=True, exist_ok=True)
    mask_band = "qa" if meta["sensor"] == "landsat" else "scl"
    bands = {b: ds[b].values for b in ("red", "green", "blue", "nir", "swir16", mask_band)}
    np.savez_compressed(out / "bands.npz", x=ds.x.values, y=ds.y.values, **bands)
    (out / "meta.json").write_text(json.dumps(meta, indent=1))


def main(years):
    bbox = presets.PRESETS[PRESET]["bbox"]
    report = []
    for year, sensor in [t for t in TARGETS if not years or t[0] in years]:
        t0 = time.time()
        try:
            ds, meta = pick_frame(bbox, year, sensor)
            meta["valid_pct_frame"] = frame_valid_pct(ds, meta)
            if meta["valid_pct_frame"] < MIN_VALID:
                report.append(f"{year} DROPPED: valid {meta['valid_pct_frame']}% < {MIN_VALID}% ({meta['day']} {meta['platform']})")
            else:
                save(ds, meta)
                report.append(f"{year} OK {meta['day']} {meta['platform']} valid {meta['valid_pct_frame']}% shape {ds['red'].shape} ({time.time() - t0:.0f}s)")
        except Exception as e:
            report.append(f"{year} DROPPED: {type(e).__name__}: {e}")
        print(report[-1], flush=True)
    print("\n".join(["--- summary ---", *report]), flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
