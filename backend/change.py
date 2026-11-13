"""change.py - radiometry, masks, two-date change, PNGs, stats, confidence. numpy/scipy/pillow only."""
import math
import numpy as np
from PIL import Image
from scipy import ndimage

SCL_BAD = (0, 1, 3, 8, 9, 10)          # no data, saturated, cloud shadow, cloud med/high, cirrus
SCL_BAD_STRICT = SCL_BAD + (2, 7)      # + dark area, unclassified (urban flood / high-rise shadow cases)
BANDS = {"mndwi": ("green", "swir16"), "ndvi": ("nir", "red"), "nbr": ("nir", "swir22"), "ndwi": ("green", "nir")}   # ndwi: McFeeters 1996 (additive, v1.2)
THRESH = {"mndwi": 0.0, "ndvi": 0.3, "ndwi": 0.0}
LABELS = {"mndwi": ("land became water", "water became land"), "ndwi": ("land became water", "water became land"),
          "ndvi":  ("new vegetation", "vegetation lost"),
          "flood": ("newly flooded", "drained"),
          "nbr":   ("burn scar", "")}
LEVELS = ["LOW", "MEDIUM", "HIGH"]


def valid_mask(ds, sensor, strict=False):
    """True = usable pixel. Sentinel-2 uses SCL; Landsat uses QA_PIXEL bits 0-4 (fill, dilated cloud, cirrus, cloud, shadow)."""
    if sensor == "landsat":
        return (ds["qa"].values.astype("uint16") & 0b11111) == 0
    return ~np.isin(ds["scl"].values, SCL_BAD_STRICT if strict else SCL_BAD)


def reflectance(ds, band, scale, offset, sensor):
    dn = ds[band].values.astype("float32")
    r = dn * scale + offset
    bad = dn == 0                                   # fill / nodata (also Landsat 7 SLC gaps)
    if sensor == "landsat":
        bad |= (dn < 7273) | (dn > 43636)           # USGS valid DN range for C2 L2 SR
    r[bad] = np.nan
    return r


def nd(a, b):
    return (a - b) / (a + b + 1e-6)


def _mmu(mask, min_px):
    """Drop blobs smaller than min_px pixels (kills sun-glint speckle and 1-pixel noise)."""
    lab, n = ndimage.label(mask)
    if n == 0:
        return mask, 0
    sizes = np.bincount(lab.ravel())
    small = sizes < min_px
    small[0] = False
    dropped = int(sizes[small].sum())
    return mask & ~small[lab], dropped


def _stripes(shape):
    y, x = np.indices(shape)
    return ((x + y) % 8) < 3


def family(platform):
    p = platform or ""
    return "msi" if p.startswith("sentinel-2") else {"landsat-4": "tm", "landsat-5": "tm", "landsat-7": "etm", "landsat-8": "oli", "landsat-9": "oli"}.get(p, p)


def confidence(valid_both, cross_sensor, season_gap_days, slc):
    lvl = 2 if valid_both >= 85 else 1 if valid_both >= 60 else 0
    flags, drop = [], 0
    if cross_sensor:
        flags.append("cross_sensor"); drop += 1
    if season_gap_days > 45:
        flags.append("season_mismatch"); drop += 1
    if slc:
        flags.append("landsat7_slc_gaps")
    if valid_both < 60:
        flags.append("low_valid_pixels")
    lvl = max(0, lvl - drop)
    return LEVELS[lvl], flags


def run_change(A, B, bbox_wgs84, index, out_dir, thr=None, mmu=5, strict=False):
    """A, B = dicts: ds, sensor ('sentinel-2'|'landsat'), scale, offset, day (datetime.date), platform.
    Both datasets MUST be on the same EPSG:3857 grid. bbox_wgs84 = actual raster extent [w,s,e,n]."""
    import pathlib
    out = pathlib.Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    assert A["ds"]["red"].shape == B["ds"]["red"].shape, "grids differ - load both with the same bbox/res/crs"
    va, vb = valid_mask(A["ds"], A["sensor"], strict), valid_mask(B["ds"], B["sensor"], strict)
    mode = "mndwi" if index == "flood" else index
    b1, b2 = BANDS[mode]
    ia = nd(reflectance(A["ds"], b1, A["scale"], A["offset"], A["sensor"]), reflectance(A["ds"], b2, A["scale"], A["offset"], A["sensor"]))
    ib = nd(reflectance(B["ds"], b1, B["scale"], B["offset"], B["sensor"]), reflectance(B["ds"], b2, B["scale"], B["offset"], B["sensor"]))
    both = va & vb & np.isfinite(ia) & np.isfinite(ib)
    if index == "flood":     # turbid-water aware: was dry, now wetter by a clear margin (tune on real scenes)
        gain = both & (ia < 0) & (ib > -0.05) & ((ib - ia) > 0.18); loss = np.zeros_like(gain)
        ca, cb = ia > 0, ib > 0
    elif index == "nbr":     # dNBR = pre - post
        gain = both & ((ia - ib) > 0.27); loss = np.zeros_like(gain)
        ca, cb = ia > 0.15, ib > 0.15
    else:                    # class flip (safe across sensors): compare water/not or vegetated/not, never raw reflectance
        t = THRESH[index] if thr is None else thr
        ca, cb = ia > t, ib > t
        gain, loss = both & ~ca & cb, both & ca & ~cb
    gain, d1 = _mmu(gain, mmu); loss, d2 = _mmu(loss, mmu)

    lat_c = (bbox_wgs84[1] + bbox_wgs84[3]) / 2
    res = abs(float(A["ds"].x[1] - A["ds"].x[0]))
    px_km2 = (res * math.cos(math.radians(lat_c))) ** 2 / 1e6        # Web-Mercator pixel -> true ground area
    k = lambda m: round(float(m.sum()) * px_km2, 2)
    area_a, area_b = k(both & ca), k(both & cb)
    st = dict(aoi_km2=round(both.size * px_km2, 2), valid_pct_before=round(100 * float(va.mean()), 1),
              valid_pct_after=round(100 * float(vb.mean()), 1), valid_pct_both=round(100 * float(both.mean()), 1),
              area_before_km2=area_a, area_after_km2=area_b, gain_km2=k(gain), loss_km2=k(loss),
              threshold=THRESH.get(index), min_mapping_unit_px=mmu, ignored_small_km2=round((d1 + d2) * px_km2, 2),
              gain_label=LABELS[index][0], loss_label=LABELS[index][1])
    st["net_km2"] = round(st["gain_km2"] - st["loss_km2"], 2)
    st["football_pitches"] = int(round(abs(st["net_km2"]) * 140))        # 105 x 68 m pitch = 0.00714 km2
    gap = abs((A["day"].timetuple().tm_yday - B["day"].timetuple().tm_yday + 183) % 365 - 183)
    cross = family(A.get("platform")) != family(B.get("platform"))       # S2A/B/C = same sensor; L5 vs L7 vs L8 = different
    slc = any(X.get("platform") == "landsat-7" and X["day"].year * 366 + X["day"].timetuple().tm_yday > 2003 * 366 + 151 for X in (A, B))
    conf, flags = confidence(st["valid_pct_both"], cross, gap, slc)

    def rgb(S):
        d = S["ds"]; a = np.dstack([reflectance(d, c, S["scale"], S["offset"], S["sensor"]) for c in ("red", "green", "blue")])
        v = np.clip(np.nan_to_num(a, nan=0) / 0.30, 0, 1) ** (1 / 1.15)       # SAME fixed stretch for both dates
        o = np.dstack([(v * 255).astype("uint8"), np.where(np.isfinite(a).all(2), 255, 0).astype("uint8")])
        return o
    Image.fromarray(rgb(A), "RGBA").save(out / "rgb_before.png"); Image.fromarray(rgb(B), "RGBA").save(out / "rgb_after.png")
    ch = np.zeros((*both.shape, 4), np.uint8); ch[gain] = (30, 144, 255, 210); ch[loss] = (255, 140, 0, 210)
    Image.fromarray(ch, "RGBA").save(out / "change.png")
    mk = np.zeros((*both.shape, 4), np.uint8); mk[~both] = (120, 120, 120, 110); mk[~both & _stripes(both.shape)] = (60, 60, 60, 190)
    Image.fromarray(mk, "RGBA").save(out / "mask.png")
    return dict(bounds=bbox_wgs84, index=index, stats=st,
                quality=dict(confidence=conf, flags=flags, headline_hidden=(conf == "LOW" and st["valid_pct_both"] < 50)),
                files=["rgb_before.png", "rgb_after.png", "change.png", "mask.png"])
