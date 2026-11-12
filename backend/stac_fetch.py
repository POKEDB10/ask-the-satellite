"""stac_fetch.py - search, pick the best DAY (mosaic all tiles of that day), load on one EPSG:3857 grid."""
import os
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("AWS_NO_SIGN_REQUEST", "YES")
from collections import defaultdict
from datetime import datetime, timedelta
import numpy as np, odc.stac, pystac_client
import change

ES  = "https://earth-search.aws.element84.com/v1"
MPC = "https://planetarycomputer.microsoft.com/api/stac/v1"
# our name -> asset key
S2 = {"earthsearch": dict(red="red", green="green", blue="blue", nir="nir", swir16="swir16", swir22="swir22", scl="scl"),
      "pc":          dict(red="B04", green="B03", blue="B02", nir="B08", swir16="B11", swir22="B12", scl="SCL")}
LS = dict(red="red", green="green", blue="blue", nir="nir08", swir16="swir16", swir22="swir22", qa="qa_pixel")
odc.stac.configure_rio(cloud_defaults=True, aws={"aws_unsigned": True})


class NoScene(Exception):
    pass


def catalog(source):
    if source == "pc":
        import planetary_computer as pc
        return pystac_client.Client.open(MPC, modifier=pc.sign_inplace, timeout=25)
    return pystac_client.Client.open(ES, timeout=25)


def landsat_platforms(d):                       # d: datetime
    if d < datetime(2003, 6, 1):  return ["landsat-7", "landsat-5"]   # SLC still working (failed 31 May 2003)
    if d < datetime(2011, 11, 1): return ["landsat-5"]
    if d < datetime(2013, 4, 1):  return ["landsat-7"]                # SLC-off: flag it, gaps = no data
    return ["landsat-8", "landsat-9"]


def scale_offset(item, sensor):
    """Reflectance = DN*scale + offset.  Earth Search l2a PB>=4 COGs are ALREADY harmonised (flag) -> offset 0."""
    if sensor == "landsat":
        return 2.75e-5, -0.2
    p = item.properties
    if p.get("earthsearch:boa_offset_applied"):
        return 1e-4, 0.0
    return 1e-4, (-0.1 if float(p.get("s2:processing_baseline", 0) or 0) >= 4.0 else 0.0)


def search_days(bbox, date, sensor="sentinel-2", window_days=30, max_cloud=40, source="earthsearch"):
    t = datetime.fromisoformat(date)
    rng = f"{t - timedelta(days=window_days):%Y-%m-%d}/{t + timedelta(days=window_days):%Y-%m-%d}"
    q = {"eo:cloud_cover": {"lt": max_cloud}}
    if sensor == "landsat":
        q["platform"] = {"in": landsat_platforms(t)}
        coll = ["landsat-c2-l2"]
        source = "pc"                                    # Earth Search Landsat is requester-pays -> never use it
    else:
        coll = ["sentinel-2-l2a"]
    items = list(catalog(source).search(collections=coll, bbox=bbox, datetime=rng, query=q).items())
    days = defaultdict(list)
    for it in items:
        days[it.datetime.date()].append(it)             # all MGRS tiles of one overpass day (AOI may straddle tiles)
    rows = [dict(day=d, items=v, cloud_tile=float(np.mean([i.properties.get("eo:cloud_cover", 50) for i in v])),
                 dist=abs((d - t.date()).days)) for d, v in days.items()]
    rows.sort(key=lambda r: r["cloud_tile"] + 0.35 * r["dist"])
    return rows, source


def load_day(items, bbox, res, sensor="sentinel-2", source="earthsearch", names=("red", "green", "blue", "nir", "swir16", "scl")):
    keymap = LS if sensor == "landsat" else S2[source]
    if sensor == "landsat":
        names = tuple("qa" if n == "scl" else n for n in names)
    assets = [keymap[n] for n in names]
    kw = {}
    if source == "pc":
        import planetary_computer as pc
        kw["patch_url"] = pc.sign
    ds = odc.stac.load(items, bands=assets, bbox=bbox, crs="EPSG:3857", resolution=res, groupby="solar_day",
                       resampling={"scl": "nearest", "SCL": "nearest", "qa_pixel": "nearest", "*": "bilinear"},
                       chunks={}, **kw).isel(time=0).compute()
    inv = {v: k for k, v in keymap.items()}
    return ds.rename({a: inv[a] for a in assets})


def pick_scene(bbox, date, sensor="sentinel-2", window_days=30, max_cloud=40, source="earthsearch", res=20, top_k=6):
    rows, source = search_days(bbox, date, sensor, window_days, max_cloud, source)
    if not rows:
        raise NoScene(f"no scene under {max_cloud}% cloud within +/-{window_days} d of {date}")
    for r in rows[:top_k]:                                # exact AOI valid % from a cheap 60 m SCL/QA read
        m = load_day(r["items"], bbox, 60, sensor, source, ("scl",))
        r["valid_pct_aoi"] = round(100 * float(change.valid_mask(m, sensor).mean()), 1)
    cand = rows[:top_k]
    best = max(cand, key=lambda r: (round(r["valid_pct_aoi"] / 2), -r["dist"]))   # within 2 pts = tie -> nearer date wins
    ds = load_day(best["items"], bbox, res, sensor, source)
    it = best["items"][0]
    sc, off = scale_offset(it, sensor)
    ext = ds.odc.geobox.geographic_extent.boundingbox                     # actual raster extent in lon/lat
    return dict(ds=ds, sensor=sensor, scale=sc, offset=off, day=best["day"], platform=it.properties.get("platform"),
                scene_ids=[i.id for i in best["items"]], datetime=it.datetime.isoformat(), source=source, res=res,
                bounds=[ext.left, ext.bottom, ext.right, ext.top],
                candidates=[dict(day=str(r["day"]), cloud_tile=round(r["cloud_tile"], 1), valid_pct_aoi=r["valid_pct_aoi"]) for r in cand])
