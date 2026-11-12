# smoke.py - run from backend/. Takes about 2 minutes.
import numpy as np, stac_fetch as sf, change
bbox = [55.10, 25.09, 55.17, 25.14]                      # Palm Jumeirah
s = sf.pick_scene(bbox, "2024-04-22", res=20)             # 22 Apr 2024: tiles 40RBN 9% / 40RCN 19% cloud [V]
print(s["scene_ids"], s["candidates"])                   # expect TWO scene ids: the bbox straddles two tiles
g = change.reflectance(s["ds"], "green", s["scale"], s["offset"], "sentinel-2")
print("green reflectance p5/p50/p95:", np.nanpercentile(g, [5, 50, 95]).round(3))
assert np.nanpercentile(g, 5) > 0, "negative reflectance: offset applied twice (see section 2.2)"
l = sf.pick_scene(bbox, "2008-05-17", sensor="landsat", res=30, window_days=45, max_cloud=60)
print(l["scene_ids"], l["platform"], l["candidates"])     # Landsat 5 via Planetary Computer
