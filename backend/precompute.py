"""precompute.py - run once with internet:  python precompute.py            (tier A)   |   python precompute.py lake_mead kakhovka
Writes cache/presets/<id>/{rgb_before,rgb_after,change,mask}.png + result.json with the SAME pipeline as live. Commit cache/presets/."""
import sys
import main, presets

EXPECT = {"lake_mead": (324.1, 267.1)}              # benchmark open-water km2 (14 Aug 2019 / 7 Sep 2022) [R]; ours differs slightly (joint mask)
ids = sys.argv[1:] or [k for k, v in presets.PRESETS.items() if v["tier"] == "A"]
for pid in ids:
    try:
        a = main.run_preset(pid, force=True); st = a["stats"]
        print(f"{pid:20s} {a['scene_before']['day']} -> {a['scene_after']['day']}  net {st['net_km2']:+8.1f} km2  "
              f"valid {st['valid_pct_both']:5.1f}%  {a['quality']['confidence']:6s} {a['quality']['flags']}")
        if pid in EXPECT:
            print(f"   water before/after {st['area_before_km2']} / {st['area_after_km2']} km2 vs benchmark {EXPECT[pid]} (expect within about 5%)")
        if st["valid_pct_both"] < 60:
            print("   WARNING: under 60% valid: widen the date window, relax max_cloud, or pick another day")
    except Exception as e:
        print(f"{pid:20s} FAILED {type(e).__name__}: {e}")
