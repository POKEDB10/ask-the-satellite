# Geospatial AI Hackathon Blueprint — Ask the Satellite (NOVA 2026 Track D) — MASTER

Nov 12, 2026 · @...

**Build one thing and make it trustworthy:** a live Sentinel-2 two-date change engine (water + vegetation) where every number carries a data-quality badge, a chat layer that only narrates numbers the backend computed, and pre-computed Landsat presets for everything before 2015 (Palm Jumeirah 2001 to 2008 and others). This master merges the Track D plan and the Blueprint, corrects the errors found in both (section 1), and every Python and JS snippet in section 5 was run against synthetic data and stubs before it was pasted here (the live network calls were not reachable from the sandbox; see section 5.4).

Tags used throughout: **\[V\]** checked live on 12 Nov 2026 for this master. **\[R\]** taken from the two research reports (links in section 9), not re-checked. **\[?\]** unverified: confirm at the step named. Times are Dubai (UTC+4). Section 0 uses T+0 = the minute your team starts it; if you are reading this after 7 PM, run steps 1 to 6 in parallel across four laptops and skip precompute until Checkpoint 1.

## 0. Next 60 minutes: roles, setup, vertical slice

Goal: one real Sentinel-2 change overlay (Palm Jumeirah, Jan 2018 vs Jan 2024) on a browser map with km² numbers, committed as "slice working". Teams that postpone joining the raster backend to the map until midnight fail at integration.

| Role | Owns | Hour-1 job | Done when |
| --- | --- | --- | --- |
| **A** Data / backend | `stac_fetch.py`, `change.py`, `/api/analyze` | Run section 5 snippets 1 and 2 on the Palm bbox; write PNGs + `result.json` to `cache/demo/` | `smoke.py` passes; JSON matches the contract |
| **B** Map UI | `web/` (Leaflet) | Page that loads `cache/demo/*.png` as image overlays and a swipe divider (snippet 4) | Overlay is pixel-aligned over the basemap |
| **C** Agent / LLM | Ollama, `agent.py` | Pull both models, run the 10-minute bake-off (section 3.1), planner returns valid JSON for 10 test questions | `ollama ps` shows 100% GPU |
| **D** Presets / QA / pitch + organizer liaison | repo, `stories.json`, section 0b questions | Create repo + skeleton, vendor Leaflet locally, ask the 10 questions below | Answers written into the repo README |

### Ordered steps

1. **(5 min) Repo and skeleton.** One GitHub repo with the folder tree from section 5.3. Everyone clones it.
2. **(10 min, demo laptop first) Ollama.** `ollama pull qwen3.5:9b-q4_K_M` and `ollama pull qwen2.5:7b-instruct-q4_K_M`, then `ollama run <tag> "Reply with OK"` and `ollama ps`. Set `OLLAMA_KEEP_ALIVE=24h` so the model stays in VRAM.
3. **(15 min, all laptops) Python 3.11 or 3.12 venv.** Install, then freeze at once (commands below). Everyone installs from `requirements.lock.txt` all night.
4. **(10 min) Frontend with no build step and no CDN.** `npm i leaflet@1.9.4`, copy `node_modules/leaflet/dist/*` into `web/vendor/leaflet/`. Do not use the Tailwind CDN script: it needs internet and breaks the offline demo.
5. **(10 min) Smoke-test the data** with `smoke.py` (below). It proves Earth Search works, that the Palm bbox spans two satellite tiles, that reflectance has no double offset, and that Planetary Computer Landsat search answers. Write any failure on the whiteboard for the Wi-Fi check.
6. **(5 min) Optional fallback key:** a Google AI Studio key (free tier, no card). Free-tier limits are no longer published, so it is the first item on the cut-list.
7. **(T+30 to T+50) Slice.** A runs the pipeline end to end; B loads the PNGs; A wraps it in `POST /api/analyze` and B wires a Run button.
8. **(T+50 to T+60) Commit "slice working"** and tag `v0.0`. This is the first safety net.

```bash
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install fastapi uvicorn pystac-client odc-stac planetary-computer rasterio numpy scipy pillow pyproj httpx ollama pydantic
pip freeze > requirements.lock.txt
```

The section 5 snippets were run on odc-stac 0.5.3, pystac-client 0.9.1 and odc-geo 0.5.4 \[V\].

```python
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
```

## 0b. Confirm with the organizers now

Ask all ten in one visit and write the answers into the README. Questions 1 to 3 change the plan.

| # | Question | Why it matters / what changes |
| --- | --- | --- |
| 1 | Is "12" noon Fri 13 Nov or midnight tonight? | Midnight leaves about 4 working hours: ship the MUST list only (section 4), no Tier 2 presets. |
| 2 | May anything change (config, presets, slides) between submission and the 1 PM pitch? Must the demo run from the submitted commit? | If not allowed: tag `v1.0-submission`, commit every preset into `cache/`, demo from that tag. |
| 3 | What must the submission contain: repo, README, video (max length), slides, deployed URL? | Decides what the 4 to 5 AM freeze hour produces. |
| 4 | What are the judging criteria and their weights? | Decides Trust Panel versus chat time in the 6 minutes, and polish versus depth at 2 AM. |
| 5 | Stage Wi-Fi, wired or hotspot? Is there power at the podium? | No stable internet: default to preset mode. An unplugged laptop GPU throttles (the Blueprint estimates about 60 to 15 tokens/s \[?\]); keep it on AC. |
| 6 | Projector: HDMI or USB-C, resolution, can we test, does the 6-minute timer include plug-in? | Test 1280×720 and 1920×1080. With no transition window, pre-warm the model and the browser (full screen) before walking on. |
| 7 | Are a local LLM, a free hosted-API fallback and pre-cached content allowed? | Compliance. If hosted APIs are banned, drop the Gemini fallback. |
| 8 | Are pre-computed presets and data files inside the repo or zip allowed, and is there a size limit? | A preset is 4 images plus JSON, roughly 5 to 10 MB \[?\]. If capped, save the RGB layers as WebP or run PNGs with `optimize=True`. |
| 9 | Will judges ask for a live "try this location"? | If yes, test live mode on 3 random sites at 3 AM and prepare a spoken filler line for the wait. |
| 10 | How long is Q&A after the 6 minutes and how many judges? | The Blueprint assumed 3 minutes. Rehearse the 11 questions in section 8.1. |

## 1. Executive recommendation

**Build a map with a chat drawer that answers one question type extremely well: "Did water or vegetation change here between two dates, and how sure are we?"**

1. **Live engine.** Sentinel-2 L2A from Earth Search (Planetary Computer as backup). Two-date MNDWI (water) and NDVI (vegetation) by class flip, a best-day picker that mosaics every tile of that day, AOI up to about 15 × 15 km, output in km², % of AOI and a coloured overlay.
2. **History.** 13 verified Landsat story presets plus 5 Sentinel-2-era presets, pre-computed on disk and shown fully offline. Live Landsat is out: Earth Search Landsat is requester-pays and Planetary Computer search has had 2026 timeouts \[R\].
3. **AI.** A local Qwen model turns the question into a JSON plan. Code geocodes, picks scenes, computes change and fills the numbers into a template. The LLM never writes a number, and a validator rejects any number that is not in the result JSON.
4. **Trust Panel on every result.** Valid-pixel %, grey hatched mask, scene dates and satellites, cross-sensor and cloud flags, and a HIGH / MEDIUM / LOW badge. "Measured" and "What it might mean" sit in separate cards. Below 50% valid pixels the km² headline is hidden.
5. **10-second UX.** One sentence ("About 5.6 km² of sea became land"), a swipe slider and one legend: blue = new water or vegetation, orange = became land or vegetation lost, grey hatch = hidden by cloud or no data.
6. **Validation scorecard (SHOULD).** Re-run the published Lake Mead benchmark (324.1 km² in Aug 2019, 267.1 km² in Sep 2022) and show our numbers beside it. It answers "how accurate?" with evidence.
7. **Three jury moments.** Palm Jumeirah swipe 2001 to 2008; Dubai April 2024 flood with the mask toggle and an honest badge; chat "Did Lake Mead shrink?" in English or Arabic.
8. **Drop.** Live Landsat, tile servers (TiTiler), segmentation models (Prithvi, SAM-geo), voice, multi-agent frameworks, synthetic fallback imagery, and any pitch number the code did not compute.

### 1.1 Where the two reports disagreed and what this master uses

| Topic | Track D plan | Blueprint | Master decision |
| --- | --- | --- | --- |
| Sentinel-2 offset | DN × 0.0001 − 0.1 even when the item says the offset is applied (double offset: every reflectance 0.1 too low) | Subtract 1000 when baseline ≥ 4 and median DN > 800 (heuristic; wrong on bright desert tiles of already-harmonised items) | Per-item rule in section 2.2, checked against live items \[V\] and the Lake Mead benchmark code \[V\]. `smoke.py` asserts it. |
| S2 collection | `sentinel-2-l2a` | `sentinel-2-c1-l2a` first | `sentinel-2-l2a` (the benchmark used it); the same rule also handles c1 \[V\] |
| Scene loading | One item | Mosaic all items of the best day | Mosaic the day. Palm Jumeirah spans tiles 40RBN and 40RCN \[V\] |
| Map library | MapLibre, two synced maps | Leaflet 1.9.4 + side-by-side plugin | **Leaflet 1.9.4**, one map, swipe by clipping two panes (run in headless Chrome \[V\]); no plugin, no second map to sync |
| Grid | EPSG:3857 + cos²(lat) area fix | UTM | **EPSG:3857 + cos²(lat)**: overlays line up with the basemap; area maths unit-tested |
| Local LLM | `qwen3.5:9b-q4_K_M` | `qwen2.5:7b-instruct-q4_K_M` | 10-minute bake-off (section 3.1): qwen3.5 only if it runs 100% on GPU and answers in ≤ 4 s, else qwen2.5:7b |
| Agent design | JSON planner + templates + number guard | Two LLM phases narrate all three cards | Planner + templates; the LLM writes only the interpretation card, behind the number guard |
| Landsat 2001 | Landsat 7 (SLC still on) | Landsat 5 only (Landsat 7 excluded) | Landsat 7 before 1 June 2003, Landsat 5 after; the picker shows what exists |
| Cloud mask | Mask 0,1,3,8,9,10,11 | Keep only 4,5,6,11 | Mask 0,1,3,8,9,10 (the benchmark's choice plus nodata); *strict* mode also masks 2 and 7 for urban and flood scenes |
| Built-up (NDBI) | Not live | Live, in the ranking | Experimental, Expert mode only, always with the desert-sand caveat chip; not in the ranking |
| Presets | 13 with verified facts, no bboxes | 18 with bboxes, weak sourcing | 13 verified + 5 Sentinel-2-era, in tiers (section 3.4) |
| Disaster flagship | Kakhovka, Dubai flood | Al-Ain 17 Apr 2024 with "17.6 km², 96.2% valid" | Dubai flood with the after-date picked by the picker; Al-Ain 17 Apr is 55% cloudy \[V\]; quote only computed numbers |
| Basemap offline | Dark canvas + true-colour PNGs | Cached map tiles | Never cache OSM tiles (policy \[R\]); dark canvas offline |
| Offline fallback | Cached real results | Synthetic generated rasters | Real cached results only. Synthetic imagery fabricates evidence |
| Business case | Freemium | $0.002 per query, $499 per month tier | Freemium; unit economics are assumptions, labelled as such |

### 1.2 Errors found and fixed (verify these in your own run, do not trust them blindly)

- **Radiometry.** Earth Search `sentinel-2-l2a` items from processing baseline 04.00 on carry `earthsearch:boa_offset_applied: true` while their `raster:bands` still list offset −0.1; the COGs are already harmonised, so the offset must be 0 \[V: live items 2024, and the benchmark's `scaled()` code\].
- **Al-Ain flood scene.** `S2A_40QCM_20240417_0_L2A` has 55.4% cloud (36.3% high-probability cloud, 5.7% shadow) against 14.3% on 7 Apr \[V\]. Tile-level numbers, so check the AOI, but the Blueprint's "cloud-free" and its 17.6 km² / 96.2% figures were placeholders from its example JSON. Its example scene id (`40RBM`) is also wrong; the tile is 40QCM.
- **Dubai after-flood date.** 17 Apr 2024 is cloudy over Palm and Dubai South (tile cloud 33% and 43%). 22 Apr (S2B: 9% and 19%) and 27 Apr (6.7% and 19.3%) are clearer \[V\]. Let the picker decide.
- **Palm Jumeirah facts.** The Blueprint's "5.6 to 6.5 km²" and "11-km breakwater" cite Feng Shui pages. Use the NASA Earth Observatory and Wikipedia facts in section 3.4 and your own computed area.
- **USGS Earthshots.** The Palm Jebel Ali page pairs 17 May 2008 (Landsat 5) with 17 Jun 2022 (Landsat 9) and shows a 1984 to 2022 series; the "22 May 2001 Landsat 7" date in the Track D table was not visible there \[V\]. Pick the 2001 scene with the picker and record its id.
- **Offline stack.** Tailwind CDN and cached OSM tiles both fail offline or break the OSM tile policy. Master uses local CSS and a dark canvas.

## 2. Data sources, harmonization, masking, indices

### 2.1 Source matrix (Nov 2026)

| Source | Years | Resolution | Access | Gotchas | Role |
| --- | --- | --- | --- | --- | --- |
| **Earth Search v1 `sentinel-2-l2a`** | mid-2015 to now (S2A 2015, S2B 2017, S2C Sept 2024) | 10 m (B02/03/04/08); 20 m (B8A, B11, B12, SCL) | Free public STAC; COGs readable anonymously over HTTPS; no service guarantee \[R\] | Asset keys are common names: `blue, green, red, nir, nir08, swir16, swir22, scl, visual` \[V\]. Offset rule in 2.2. A reprocessed duplicate (`_0` vs `_1`) can appear \[R\]. | **PRIMARY (live)** |
| Earth Search `sentinel-2-c1-l2a` | Collection 1 reprocessing | same | same; ids look like `S2A_T40RBN_20240427T065216_L2A` \[V\] | No boa flag; `raster:bands` offset −0.1 \[V\]. Coverage of old years not checked \[?\]. | Optional alternative |
| Earth Search `landsat-c2-l2` | 1982 to now | 30 m | STAC is free but assets sit in USGS's requester-pays bucket; anonymous reads fail, billed to you \[R\] | Breaks "free only" | **Do not use** |
| **Planetary Computer** (`sentinel-2-l2a`, `landsat-c2-l2`, `esa-worldcover`) | Landsat 4 to 9 C2 L2; S2 2015 to now | 10 to 30 m | Free; STAC public; SAS token via `planetary_computer.sign` or `sign_inplace` \[R\] | Open GitHub issue: `POST /search` persistent timeouts (about 70% failing) from 2 May 2026, more reports in June \[R\]. S2 keys are `B04, B08, SCL`; Landsat key is `qa_pixel`. SAS tokens expire (`msft:expiry`): re-sign. | **BACKUP + Landsat precompute** |
| Copernicus Data Space | S2 + Landsat | 10 m | Free account; Sentinel Hub 10,000 PU/month, 300 PU/min; openEO 4,000 credits/month \[R\] | OAuth and Process API learning curve | Emergency backup |
| Google Earth Engine | Landsat 1984 on, S2 | 10 to 30 m | Noncommercial only via a verified Cloud project; monthly EECU quota tiers since 27 Apr 2026 \[R\] | Registration risk tonight; a second code path | **Skip** (scale path in the pitch) |
| USGS EarthExplorer | Full Landsat | 30 m | Free account, manual download | Whole scenes | Last-resort presets |

A UAE Space Agency hackathon data page lists Copernicus Data Space, Planetary Computer, Landsat, EarthExplorer and ESA WorldCover as recommended sources \[V: spaceacademy-hackathons.space.gov.ae/data; it is the Arab Youth Space Hackathon 2026 page, so confirm it applies to NOVA\].

**Usable history.** Landsat 5 TM 1984 to 2011 (decommissioned 2013). Landsat 7 ETM+ from 1999, but its Scan Line Corrector failed on 31 May 2003 and later scenes miss about 22% of the area (Storey et al., USGS EROS) \[R\]. Landsat 8 from 2013, Landsat 9 from late 2021. Rule: **2001 to May 2003 use Landsat 7; June 2003 to 2011 use Landsat 5; 2012 to Mar 2013 Landsat 7 with gaps flagged; 2013 to 2015 Landsat 8; 2016 on Sentinel-2.**

### 2.2 Radiometry: the rule that keeps every number honest

ESA processing baseline 04.00 (25 Jan 2022) added +1000 to Sentinel-2 L2A digital numbers so dark water does not clip at zero \[R\]. Differencing a 2019 and a 2025 scene on raw numbers fabricates change. Earth Search then re-harmonised its own COGs and kept the old `raster:bands` metadata, which is what trips people up.

| Collection and item signal | Reflectance = DN × scale + offset |
| --- | --- |
| Earth Search `sentinel-2-l2a`, baseline ≥ 04.00, `earthsearch:boa_offset_applied: true` (`raster:bands` still lists −0.1) \[V\] | 0.0001 × DN, **offset 0** |
| Earth Search `sentinel-2-l2a`, baseline < 04.00 (e.g. 02.11), flag false \[V\] | 0.0001 × DN |
| Earth Search `sentinel-2-c1-l2a` (baseline 05.10), flag absent, `raster:bands` offset −0.1 \[V\] | 0.0001 × DN − 0.1 |
| Planetary Computer `sentinel-2-l2a`, baseline ≥ 4.0 \[R\] | 0.0001 × DN − 0.1 (confirm with `smoke.py` \[?\]) |
| Landsat Collection 2 Level-2 SR (USGS FAQ) \[R\] | 0.0000275 × DN − 0.2; DN 0 = fill; valid DN 7273 to 43636 |

`stac_fetch.scale_offset()` in section 5.4 (snippet 2) implements this table. **Sanity test:** over open sea, green reflectance is 0.01 to 0.10; a negative 5th percentile means the offset was applied twice (our synthetic test with the wrong offset gave −0.04 over sea \[V\]).

### 2.3 Grid and cross-sensor rules

- Declare one CRS, resolution and bbox for both dates (the loader does; `run_change` asserts equal shapes). Sentinel-2's 20 m bands and SCL are resampled onto that grid (SCL with nearest neighbour).
- Never subtract raw reflectance across sensors. Compare **classes** (water or not, vegetated or not) and count flips.
- If either date is Landsat, load both at 30 m. Resample, never invent.
- Match season: same month plus or minus one. A day-of-year gap above 45 days lowers the badge one level.
- Treat Landsat 7 SLC gaps as no-data (QA fill bit); never interpolate them.
- Drop change blobs under 5 pixels (minimum mapping unit) and report the ignored area.
- Sensor families: Sentinel-2A/B/C are one sensor; Landsat 5 TM, Landsat 7 ETM+ and Landsat 8/9 OLI are three. A family change lowers the badge one level.

### 2.4 Masking, best-day picker, Gulf artefacts

**Sentinel-2 SCL.** Mask 0 no data, 1 saturated, 3 cloud shadow, 8 and 9 cloud medium and high, 10 cirrus. *Strict* mode (urban, flood) also masks 2 dark area and 7 unclassified. Keep 11 (snow) valid unless the AOI is alpine or boreal in winter: SCL can mislabel bright salt flats and sabkha as snow \[?\]. SCL is a mask, never a water measure: its water class over-reads Lake Mead by 50 to 82 km² every year against MNDWI \[V: benchmark\].

**Landsat QA\_PIXEL.** Mask if any of bits 0 to 4 is set (fill, dilated cloud, cirrus, cloud, cloud shadow) \[R\]; confirm bit positions in the USGS Collection 2 guide \[?\].

**Best-day picker** (section 5.4, snippets 1 and 6, implements it):

1. Search plus or minus 30 days (45 for Landsat) with scene-level `eo:cloud_cover` below 40.
2. Group items by date. All tiles of one date form one candidate, because the AOI may straddle tiles: the Palm Jumeirah bbox touches tiles 40RBN and 40RCN \[V\].
3. Rank days by tile cloud + 0.35 × days from the target date; keep the top 6.
4. For each, read only SCL or QA at 60 m for the AOI and compute the real valid-pixel %. Scene-level cloud misleads for small AOIs.
5. Pick the highest valid %. Within 2 points, prefer the date nearer the target.
6. Load the working bands and mosaic that day.
7. Return every candidate with its valid % for the "Why this scene?" tooltip.

If the user gives only years, reuse the same month for both dates. For unknown places: date\_after = latest clear scene, date\_before = same month five years earlier (not before 2016).

| Gulf artefact | What it does | Guard |
| --- | --- | --- |
| Sun-glint on sea | Single-pixel speckle, false gain or loss | Use SWIR-based MNDWI; minimum mapping unit; chip "Possible sun-glint" |
| Dredge and flood turbidity | Silty water looks like land in NDWI and may stay slightly negative in MNDWI | MNDWI; flood rule in 2.5; chip "Turbid water" |
| Dust and haze | Raises blue and red, lowers NDVI | Reject scenes with high cloud-medium share; compare same-season dates |
| Bright sand | Fools built-up indices | Do not publish NDBI as a headline |
| High-rise and cloud shadows | Dark pixels look like water | Strict mask (2, 3); flood rule needs a positive jump between dates |
| Tide and sabkha flats | Shoreline moves with tide, not land use | Coastal analyses add a tidal-stage caveat |
| SCL marks dark open water as shadow | Eats water pixels from the valid mask \[?\] | After the first Palm run, check the masked share over open sea; if above 10%, relax to mask 0,1,8,9,10 only for that AOI |

### 2.5 Indices and thresholds (starting points, not calibrated)

| Question | Index | State rule | Change rule | Failure modes |
| --- | --- | --- | --- | --- |
| Water, reclamation, lake | **MNDWI** = (green − swir16) / (green + swir16) | Water if > 0.0 (try 0.1 on coasts) | Class flip; gain = became water, loss = became land | Building shadows, dark asphalt, sun-glint |
| Vegetation | **NDVI** = (nir − red) / (nir + red) | Vegetated if > 0.3 (arid sparse plants: 0.2) | Class flip | Irrigation pivots and harvest look like loss; sand brightness noise |
| Flood | MNDWI after versus before | Before < 0 (dry) | After > −0.05 and rise > 0.18 (turbid water stays slightly negative; a stricter after > 0.1 is the alternative) | Clouds during floods (radar is the next step); muddy water; shadows; tune on the real scenes \[?\] |
| Burn | **NBR** = (nir − swir22) / (nir + swir22); dNBR = pre − post | Vegetated before | dNBR > 0.27 (moderate and above; verify classes \[?\]) | Harvest, shadows |
| Built-up (experimental) | NDBI = (swir16 − nir) / (swir16 + nir) with water and vegetation masked out | — | Expert mode only, always with a desert-sand caveat chip | Dry desert sand has higher SWIR than NIR and reads like concrete |

### 2.6 Pretrained resources

| Resource | Licence | Effort | Verdict |
| --- | --- | --- | --- |
| Spectral indices + SCL | Open data | 1.5 h | **MUST.** Zero VRAM, runs in seconds on CPU, fully explainable |
| ESA WorldCover 10 m (`esa-worldcover`; v100 = 2020, v200 = 2021) | CC-BY-4.0 \[R\] | 1 h | **STRETCH** as a context layer only. Do not difference the two versions: different algorithms, AWS warns to treat changes with caution \[R\]. Attribution: "© ESA WorldCover project / Contains modified Copernicus Sentinel data (2020/2021) processed by ESA WorldCover consortium" |
| Dynamic World | CC-BY-4.0 | 4.5+ h | **Skip.** Needs Earth Engine |
| Prithvi, SAM-geo, TorchGeo | Apache or MIT | 3 to 5+ h | **Skip.** Competes with the LLM for 8 GB VRAM and risks out-of-memory crashes |

## 3. Local model, agent architecture, grounding, presets

### 3.1 Local LLM on the demo laptop (Ryzen 7 7735HS, 16 GB RAM, RTX 4060 8 GB, as given in the brief)

The model plus its KV cache must sit 100% in VRAM (the Windows desktop already takes about 0.6 GB). Any CPU spill drops generation from tens of tokens per second to single digits and starves the raster worker. After loading, `ollama ps` must show `100% GPU`.

| Model (Ollama tag) | Size | Fits 8 GB? | Tools and JSON | Arabic / Hindi | Verdict |
| --- | --- | --- | --- | --- | --- |
| `qwen3.5:9b-q4_K_M` | 6.6 GB, text + image, 256K context window \[V: ollama.com/library/qwen3.5/tags\] | Tight: 5.6 GB weights + 0.9 GB vision projector \[R\] + cache; use `num_ctx` 4096 | Tagged tools and thinking; a 4 Nov 2026 guide calls Qwen 3.5 9B the 8 GB-tier pick \[R\] | Arabic yes \[R\]; Hindi untested \[?\] | **Candidate A** |
| `qwen2.5:7b-instruct-q4_K_M` | about 4.7 GB \[R\] | Comfortable (about 5.5 GB with cache) \[?\] | Strong JSON and tool calling \[R\] | Good Arabic and Hindi for 7B \[R\] | **Candidate B (safe default)** |
| `qwen3.5:4b-q4_K_M` | 3.3 GB \[V\] | Easy | tools \[R\] | weaker | **Fallback 1** |
| `qwen2.5:3b-instruct-q4_K_M` | about 2 GB \[?\] | Easy | single-tool plans only \[?\] | okay \[?\] | Fallback 2 (keep pulled on disk) |
| `llama3.1:8b` | 5 to 6 GB \[R\] | Yes | native tools \[R\] | weaker Arabic | Skip |
| `gemma4:e4b` | 6.6 to 9.5 GB \[R\] | Borderline | tools; forces a reasoning trace \[R\] | untested | Skip |
| `qwen3.5:9b` default tag (7.6 GB), `gemma4:12b`, `mistral-nemo:12b` | 7.1 to 8.0 GB | No: spills | — | — | **Do not use** |
| Gemini API free tier | hosted | — | JSON mode | yes | Optional online fallback only. Per-model free limits are no longer published; community tracking (Oct 2026) suggests about 10 requests per minute for Flash; free-tier prompts may be used to improve Google products \[R\]. Never rely on venue Wi-Fi. |

The Blueprint's speed figures (58 to 68 tok/s for 7B, 105 to 120 for 3B) and its '9.5/10' JSON ratings carry no source \[?\]. Measure instead.

**Bake-off (10 min, person C), then lock the choice:**

1. Pull both candidates only if disk and bandwidth allow (about 11 GB). Otherwise pull `qwen2.5:7b-instruct-q4_K_M` and `qwen3.5:4b-q4_K_M` and skip the bake-off.
2. Run the 10 planner test questions in 3.2 three times each at temperature 0.
3. Pass criteria: valid JSON in 30 of 30 runs; correct `intent` and `preset_id` in at least 9 of 10 questions; median plan call under 3 s and interpretation call under 6 s on a warm model; `ollama ps` shows 100% GPU; the Arabic question gets a sensible plan.
4. Winner is the faster model that passes. A model that spills to CPU loses automatically. Write `LLM_MODEL`, `LLM_FALLBACK` (the other candidate) and `LLM_SMALL` (`qwen3.5:4b-q4_K_M`) into `.env`.

**Settings:** `temperature` 0; `format` set to the Plan JSON schema (Ollama structured outputs); `think: false` in the request body where supported, and strip any `<think>...</think>` text before parsing \[?\]; `num_ctx` 4096; `keep_alive` `24h` plus `OLLAMA_KEEP_ALIVE=24h`; send a warm-up request on server start so the first judge question is not cold. Budget: plan call at most 150 output tokens, interpretation call at most 80.

### 3.2 Agent design: planner, deterministic pipeline, templates

The LLM never computes, never reads pixels and never supplies dates it was not given. It does two jobs: translate a question into a validated plan, and write one cautious interpretation sentence from numbers the backend already computed.

1. **Match presets by rule** (aliases, 0 ms, offline). On a hit, skip the planner.
2. **Plan** (LLM, JSON schema, temperature 0): `intent` (analyze, explain\_last, out\_of\_scope), `place`, `preset_id` or null, `index` (mndwi, ndvi, flood, nbr, auto), `date_before` and `date_after` (YYYY-MM-DD or null, only if the user stated them), `language` (en, ar, hi). Validate with pydantic; one retry; then the rule router.
3. **Resolve the place**: presets, then Nominatim, then Photon (3.4). Clamp the box.
4. **Choose dates**: user-given dates win; else preset dates; else latest clear scene versus the same month five years earlier (never before 2016 for live Sentinel-2).
5. **Pick scenes and compute** (section 2.4, `run_change`): pure Python.
6. **Render the Measured and Data-quality cards from f-string templates.** No LLM, so these cannot be wrong.
7. **Interpretation card** (LLM): input is the stats JSON plus the preset's curated context line. Output at most two hedged sentences.
8. **`numbers_ok` check**: every number in the sentence must appear in the allowed set (the stats, the dates, the context line). One failure replaces the sentence with the fixed template: 'Consistent with the context noted for this location; satellite imagery alone cannot establish the cause.'
9. Return one JSON: plan, bounds, layers, stats, quality, cards, scene candidates.

The Blueprint asks the LLM to repeat all numbers in three output keys. We template the first two cards instead, because a 7B model that rounds 267.1 to 267 is a visible failure and a template never is.

```python
class Plan(BaseModel):
    intent: Literal['analyze', 'explain_last', 'out_of_scope']
    place: str | None = None
    preset_id: str | None = None
    index: Literal['mndwi', 'ndvi', 'flood', 'nbr', 'auto'] = 'auto'
    date_before: str | None = None   # only if the user stated it
    date_after: str | None = None
    language: Literal['en', 'ar', 'hi'] = 'en'
```

**Guardrails**

- Temperature 0; the plan is constrained by schema, then re-validated; a plan with an invented date is discarded when the user did not state one.
- The LLM receives numbers, never rasters. Area, percentages, football pitches and dates come only from `run_change`.
- The system prompt for the interpretation call forbids new numbers, new places and causal claims stated as fact; it requires hedged wording ('consistent with', 'may reflect', 'could be related to').
- Out-of-scope questions (capital cities, opinions, forecasts) get a fixed refusal line and run no pipeline.
- If a question names an event with no preset and no dates, ask: 'Which dates should I compare?' Do not let the model guess years: 7B models misremember construction and disaster dates. (The Blueprint's Wikipedia lookup is a stretch item; skip tonight.)
- Each response shows the actual acquisition dates and scene ids returned by the picker, not the dates the user asked for.
- Everything the planner returned is logged to a local file for the post-mortem and for tuning.

**Fallback chain (every step silent to the user, with a small 'offline mode' pill):**

| Failure | Action |
| --- | --- |
| Invalid JSON or schema mismatch | One retry with the error text, then rule router |
| LLM call over 6 s, VRAM contention, Ollama down | Rule router plus template cards, interpretation from the preset's curated line |
| `numbers_ok` fails | Fixed interpretation template |
| Primary model missing | `LLM_FALLBACK`, then `LLM_SMALL`, then Gemini (only if online and a key is set) |
| Nominatim 429 or 503 | Photon, then 'try a preset' message |
| STAC search or load fails | Second catalog, then nearest preset; show 'Showing pre-computed example' |

**Rule router (also the tests' oracle).** Regex for preset aliases and 4-digit years first, then keywords:

| Keywords | Index |
| --- | --- |
| water, lake, sea, island, reclaim, reservoir, drought, shrink, coast | mndwi |
| flood, inundat, storm, overflow | flood |
| forest, tree, veg, farm, oasis, mangrove, green, deforest, crop | ndvi |
| fire, burn, wildfire, scar | nbr |
| city, urban, build, road, sprawl | ndvi, plus the chip 'Built-up area is not measured; showing vegetation change' |

**Planner test set (use in the bake-off and as a regression check):**

1. Show Palm Jumeirah before and after the land reclamation.
2. How much did the April 2024 flood affect Dubai?
3. What changed at Lake Mead between 2019 and 2022?
4. Is the Aral Sea really gone?
5. Show deforestation in Rondônia, Brazil.
6. أظهر لي جزيرة نخلة جميرا قبل وبعد
7. Why is part of the map greyed out? (expects `explain_last`)
8. Burn scar of the Jasper wildfire.
9. Compare Dubai Marina in 2018 and now. (no preset; geocode)
10. What is the capital of France? (expects `out_of_scope`)

### 3.3 Curated story presets (cache real results, never fake them)

Pre-2015 history exists only in Landsat (Sentinel-2 starts in 2015), so presets are the pre-2015, offline and stage-safe layer. Rules: every preset is **real output of the same pipeline**, written to `cache/<id>/` by `precompute.py`; no synthetic fallbacks (the Blueprint's idea of fabricating data when a download fails is dropped). Every card shows the date and sensor actually used. Add a preset only with a verified source for its dates.

**Tier A: compute and commit tonight (offline demo set).**

| id | Story | Before to after | Sensors | AOI | Verified context |
| --- | --- | --- | --- | --- | --- |
| `palm_jumeirah` | Palm Jumeirah reclamation | May 2001 to May 2008 (let the picker choose the exact days; do not trust quoted scene dates) | Landsat 7 (SLC-on) then Landsat 5 | `[55.095, 25.085, 55.175, 25.150]` \[V: bbox straddles tiles 40RBN + 40RCN\]; 30 m | Construction began June 2001 \[R\]; NASA EO: 'begun in 2001, completed in 2006' \[R\] |
| `the_world` | The World islands | 2003 to 2008 | Landsat 7 or 5 | `[55.120, 25.180, 55.230, 25.260]` \[?\] (Blueprint) | NASA EO: 'begun in 2003, completed in 2008' \[R\] |
| `lake_mead` | Lake Mead drought | 14 Aug 2019 to 7 Sep 2022 | Sentinel-2, 60 m grid, MNDWI > 0, SCL mask 3, 8, 9, 10 | `[-114.87, 35.98, -114.05, 36.55]` \[R: benchmark tutorial\] | Benchmark answer 324.1 km² then 267.1 km², about 56 km² lost; 281.0 km² in Sep 2025 \[R\]. Lake level 1,040.58 ft in late July 2022 \[R\]; say '2022 low' because a similar low was reported in Aug 2026 \[R\] |
| `dubai_flood_2024` | UAE flood, 16 Apr 2024 | best day 1 to 12 Apr 2024 to best day 17 to 25 Apr 2024 | Sentinel-2, flood rule | Blueprint box `[55.080, 24.840, 55.240, 24.980]` \[?\] | 16 Apr 2024: heaviest rain since records began in 1949; 254.8 mm at Khatm Al Shakla in under 24 h (National Center of Meteorology) \[R\]. **The 17 Apr 2024 scene over Al-Ain was about 55% cloud \[V\], so never hard-code 17 Apr: let the picker choose and show valid %.** |
| `abu_dhabi_mangroves` | Mangrove canopy | Oct 2017 to Oct 2026 | Sentinel-2, NDVI | `[54.400, 24.420, 54.520, 24.500]` \[?\] | Eastern Mangrove National Park and Jubail Island conservation \[?\]. Add a tidal-stage chip: NDVI over tidal flats moves with the tide |
| `aral_sea` | Aral Sea east basin | Aug 2000 to Aug 2014 | Landsat 7 then 8, 120 m | draw around about 44.6 N, 60.0 E \[?\], 120 m | NASA EO: east basin 'completely dried' by 19 Aug 2014 \[R\] |

**Tier B: add in the SHOULD hours, one `precompute.py` run each, only if the picker returns valid ≥ 60%.**

| id | Story | Before to after | Sensors | AOI | Context |
| --- | --- | --- | --- | --- | --- |
| `palm_jebel_ali` | Palm Jebel Ali | May 2001 to May 2008 | L7 then L5 | around 24.99 N, 54.98 E \[?\] | USGS: built in the early 2000s, suspended 2009 \[R\] |
| `kakhovka` | Kakhovka reservoir drained | 7 Jun 2022 to 18 Jun 2023 | Landsat 8 then 9 | around the dam, 46.78 N, 33.37 E; box under 40 km \[?\] | Dam breached 6 Jun 2023; NASA EO (27 Jul 2023): Landsat 9 image of 18 Jun, about 75% of the water drained \[R\] |
| `derna` | Derna dam collapse | Aug 2023 to 12 to 20 Sep 2023 | Sentinel-2 | around 32.77 N, 22.64 E \[?\] | Dams failed the night of 10 to 11 Sep 2023 (Storm Daniel) \[R\]. Pick clear scenes |
| `pakistan_manchar` | Sindh floods 2022 | 25 Jun 2022 to 28 Aug or 5 Sep 2022 | Landsat 9 then 8/9 | around Manchar Lake, 26.4 N, 67.65 E \[?\] | NASA EO: 31 Aug 'near the peak of the flooding' \[R\] |
| `lake_poopo` | Lake Poopó | about 2013 to Jan 2016 | Landsat 8 | around 18.75 S, 67.1 W \[?\] | Dried by Dec 2015 (Britannica) \[R\]. Pick the 'before' day |
| `great_salt_lake` | Great Salt Lake | 1986 to autumn 2022 | Landsat 5 then 8/9 | around 41.1 N, 112.5 W \[?\] | USGS: record low 4,188.5 ft on 7 Nov 2022 \[R\] |
| `lake_chad` | Lake Chad | Nov 1984 to Oct 2018 | Landsat 5 then Sentinel-2 | around 13.0 N, 14.0 E \[?\] | Under one tenth of its 1960s area (NASA). The 1960s are not visible in Landsat 5 or later \[R\] |
| `rondonia` | Rondônia 'fishbone' deforestation | 1986 to 2011 or 2023 | Landsat 5 then 5/9 | `[-62.950, -10.550, -62.800, -10.400]` \[?\] (Blueprint) | NASA: fishbone pattern, 1970s to 1990s \[R\] |
| `jasper_wildfire` | Jasper burn scar, July 2024 | 5 Jul 2024 to 25 Aug 2024 | Sentinel-2, dNBR | `[-118.150, 52.800, -117.980, 52.920]` \[?\] (Blueprint) | July 2024 boreal fire \[R\]. Shows NBR mode |
| `al_ain_flood_2024` | Al-Ain flood | as `dubai_flood_2024` | Sentinel-2 | `[55.660, 24.140, 55.820, 24.270]` \[?\] (Blueprint) | Same 16 Apr 2024 event \[R\] |
| `gerd_reservoir`, `al_qudra_lakes`, `liwa_oasis`, `lake_urmia` | Blueprint extras | dates unverified | Sentinel-2 | Blueprint boxes \[?\] | Add only after the picker shows clear scenes |

Dropped from the Blueprint's 18: NEOM and the New Administrative Capital (need the NDBI headline), Valencia DANA and the Indus flood duplicate (unverified clear scenes), `dubai_south_urban` (NDBI). The Blueprint's three-storm rainfall table (Al-Mizr 12 Feb 170 mm, Al-Hamayil 9 Mar 78 mm) comes from one paper and is not corroborated by the NCM figures in Track D; do not put it on a slide \[?\].

Aliases for rule matching live in `presets.py` (palm, palm jumeirah, نخلة جميرا, the world, lake mead, aral, mangrove, flood 2024, ...). Arabic aliases cost nothing and impress the jury.

### 3.4 Geocoding cascade and bbox clamp

1. **Preset aliases**: offline, 0 ms.
2. **Nominatim**: `https://nominatim.openstreetmap.org/search?q=<text>&format=jsonv2&limit=1`. Policy: valid identifying User-Agent (not the library default), at most 1 request per second, cache results \[R: operations.osmfoundation.org/policies/nominatim\]. Serialise calls with an `asyncio.Lock`, cache to disk, header such as `AskTheSatellite-NOVA2026/1.0 (team contact email)`. The raw `boundingbox` arrives as strings in the order south, north, west, east.
3. **Photon fallback** (`https://photon.komoot.io/api/?q=<text>&limit=1`): free, OSM-backed, no key; GeoJSON coordinates are lon, lat \[R\]. Use on HTTP 429 or 503.
4. If both fail: 'I could not find that place; try a preset.' Show the preset chips.

**Clamp.** Countries, seas and states return boxes of hundreds of kilometres. Take the centre and clamp each side to at most 0.30° (about 33 km at UAE latitudes), and pick the working resolution so no side exceeds about 1,600 pixels: 10 m up to 16 km, 20 m up to 32 km, 30 m beyond (Landsat is always 30 m). Large named water bodies (Lake Mead, Aral) use their preset box and a coarser grid. Leaflet `fitBounds` handles the zoom. Tell the user when the box was clamped ('Analysing a 33 km window around the centre').

### 3.5 Explanation cards that never overclaim

Three stacked cards, always in this order:

| Card | Border | Source | Content |
| --- | --- | --- | --- |
| **Measured by satellite** | blue | f-string template | Sensors, acquisition dates, index and threshold, km² gained, lost, net, percent, football pitches (net km² × 140, since a 105 m × 68 m pitch is 7,140 m²) |
| **Data quality** | green, amber or red by badge | f-string template | Valid % on both dates, masked % (cloud, shadow, SLC gaps), confidence level, flags ('Different satellites (30 m vs 10 m)', 'Landsat 7 stripe gaps', 'Possible sun-glint', 'Changes under 5 pixels ignored: 0.3 km²'), and a reminder that optical imagery shows surface extent, not depth or volume |
| **Interpretation (AI hypothesis)** | grey, dashed | LLM, then `numbers_ok` | Two sentences at most, hedged, using the preset's curated context line when one exists |

Template sentences:

- Measured: 'Between {date\_before} ({sensor\_before}) and {date\_after} ({sensor\_after}), water area {grew or shrank} by {net:.1f} km² ({pct:+.0f}%), about {pitches:,.0f} football pitches. Gained {gain:.1f} km², lost {loss:.1f} km².'
- Quality: '{valid:.0f}% of the area had clear pixels on both dates; {masked:.0f}% was masked (cloud, shadow, no data). Confidence: {level}.'
- Low confidence replaces the headline with 'Too much cloud to measure reliably' (section 5.4, snippet 2, sets `headline_hidden`).

**Arabic.** Translate the fixed templates once by hand (one team member who reads Arabic) and keep digits as Western numerals so the validator and the maths match. The LLM writes only the interpretation sentence in Arabic. Set `dir="auto"` on every card.

## 4. Feature matrix and the Trust UI

### 4.1 Ranked features (wow versus hours)

Tags: **MUST** finish before midnight, **SHOULD** midnight to 2 AM if on schedule, **STRETCH** 2 to 3 AM, **SKIP** out of scope. Hours are per-feature estimates for the owner named; the Blueprint's own estimate was 18 to 22 effective engineering hours across four people \[?\]. Owners: A data/backend, B map UI, C agent/LLM, D presets/QA/pitch (section 0).

| Tag | Feature | Wow | Hours | Owner | Scope decision |
| --- | --- | --- | --- | --- | --- |
| **MUST** | Live Sentinel-2 two-date analysis (MNDWI + NDVI) with overlay | 10 | 3 | A | The core. Section 5.4 snippets 1 and 2 |
| **MUST** | Before / after / change swipe | 10 | 1 | B | One Leaflet map, custom panes, CSS `clip: rect()` (tested, snippet 4). No plugin, no second map to keep in sync |
| **MUST** | Trust panel: badge, masked-area overlay, valid-% bar, chips | 10 | 1.5 | A + B | The differentiator; spec in 4.2 |
| **MUST** | Stats HUD: baseline, current, net km² and %, big sentence, dates, sensor, football pitches | 9.5 | 1 | B | Fields come straight from `stats` and `quality` |
| **MUST** | Preset story gallery (Tier A cached, offline) | 9.5 | 2.5 | D | One-click cards; 3.3 |
| **MUST** | Simple-mode chat with fly-to and auto-zoom | 9.5 | 3 | C | Plan, pipeline, three cards; `map.flyTo(bbox)` |
| **MUST** | Acquisition date and attribution on every layer | required | 0.3 | B | The brief requires it; strings in 4.3 |
| **MUST** | 'Verify the science' modal | 9 | 0.5 | B | Scene ids, band formulas, thresholds, masks, attribution (from the Blueprint's best add-on) |
| **MUST** | 'Why this scene?' tooltip | 8.5 | 0.5 | B | Lists every candidate day with its real valid % |
| **MUST** | Offline pill and guided demo buttons (Palm, Flood, Ask) | 8.5 | 0.5 | B + D | Pitch-safety mode when the network dies |
| **SHOULD** | Expert mode: two-click box, date pickers, index selector | 8.5 | 1.5 | B | No draw library; MNDWI, NDVI, flood, dNBR |
| **SHOULD** | 'What changed the most here?' ranking (MNDWI versus NDVI km²) | 9 | 1 | A | One load, two indices, one horizontal bar card |
| **SHOULD** | Pixel inspector on hover | 8.5 | 0.75 | A + B | Backend writes a 96 × 96 `grid.json` (before index, after index, valid flag); no LLM call, so it is instant. Replaces Track D's LLM click-to-explain |
| **SHOULD** | Arabic chat plus quick-prompt chips | 8.5 | 0.5 | C | `dir="auto"`; hand-translated templates (3.5) |
| **SHOULD** | One-page report via `window.print()` | 7.5 | 0.75 | B | `@media print` hides chat, keeps map, HUD, three cards |
| **STRETCH** | Projector mode | 8 | 0.5 | B | Brighter labels, overlay opacity 0.75 to 0.92, larger fonts |
| **STRETCH** | Palm timeline slider from pre-rendered frames | 9 | 1.5 | D | Precompute 2001, 2003, 2005, 2008 frames; no live fetching |
| **STRETCH** | ESA WorldCover context layer | 5 | 1 | A | Context only; never differenced |
| **SKIP** | Multi-year live time series | 7 | 4+ | — | Multiplies STAC load time and exceeds the two-date brief |
| **SKIP** | Voice input | 5 | 2 | — | Noisy hall |
| **SKIP** | Guided tour library (Intro.js) | 4 | 1.5 | — | Demo buttons and the presenter do the job |
| **SKIP** | Live Landsat, segmentation models, TiTiler | 6 | 3 to 4+ | — | Presets instead |
| **SKIP** | NDBI 'built-up' headline | 5 | 1 | — | Desert sand reads as concrete; expert mode only, with a caveat chip |

### 4.2 Artefact versus real change: the Trust UI contract

The rule that the whole UI is built on: **a pixel we could not read is never drawn as 'no change'.**

- **Layers** (checkbox list on the map): Before RGB, After RGB, Change, Masked area. Before and After sit under the swipe divider; Change and Masked sit on top. Both dates use the same fixed 0 to 0.30 reflectance stretch so the two images are comparable.
- **Change colours:** gain in blue (RGBA 30, 144, 255, 210), loss in orange (255, 140, 0, 210). The pair stays distinguishable for colour-blind viewers and reads on dark sea and pale sand. The Blueprint's cyan/emerald versus coral works too; this pair is what the code emits.
- **Masked area:** grey with diagonal stripes, drawn from the joint validity mask (cloud, shadow, no data, Landsat 7 stripe gaps). A legend entry reads 'Not measured (cloud, shadow, no data)'. Turn this layer on by default when the badge is Medium or Low.
- **Valid-pixel bar:** a horizontal bar showing the share of the area measurable on both dates (`stats.valid_pct_both`), with before and after shares underneath.
- **Badge** (shows 'Data confidence', not a statistical interval):

| Badge | Rule |
| --- | --- |
| **High** (green) | Valid on both dates ≥ 85% and no downgrade |
| **Medium** (amber) | Valid 60 to 85%, or High with one downgrade |
| **Low** (red) | Valid below 60%, or a second downgrade (floor is Low) |
| Headline hidden | Valid on both dates below 50%: the km² sentence is replaced by 'Too much cloud to measure reliably' and only the masked layer and the candidate list are shown |

A downgrade of one level applies for each of: different sensor families (Sentinel-2 versus Landsat TM, ETM+ or OLI), and a seasonal gap above 45 days. The Landsat 7 stripe-gap flag after 31 May 2003 is a chip only. Track D used 80 and 50 as its thresholds and the Blueprint 85 and 60; we ship the Blueprint's bands plus Track D's 50% headline cut.

- **Chips** (small, under the badge): 'Different satellites (30 m vs 10 m)', 'Landsat 7 stripe gaps', 'Possible sun-glint', 'Turbid water', 'Tidal flats: shoreline moves with the tide', 'Changes under 5 pixels ignored: 0.3 km²'.
- **Measured versus interpreted:** two visually separate boxes (3.5). Only the second one is AI text and it is labelled 'AI hypothesis'.
- **Never show** a km² figure without the two acquisition dates beside it.

### 4.3 Attribution strings (put them on the map and in the modal)

| Layer | Text |
| --- | --- |
| Sentinel-2 | Contains modified Copernicus Sentinel data (year of the scene), processed by Element 84 Earth Search or Microsoft Planetary Computer \[?: check each provider's wording\] |
| Landsat | Landsat data courtesy of the U.S. Geological Survey \[?: confirm preferred wording\] |
| Basemap | © OpenStreetMap contributors. Never cache or bulk-download OSM tiles; offline, fall back to a plain dark canvas |
| WorldCover (if used) | © ESA WorldCover project / Contains modified Copernicus Sentinel data (2020/2021) processed by ESA WorldCover consortium (CC-BY-4.0) \[R\] |

### 4.4 'Verify the science' modal contents

One modal, opened from the HUD, listing for the current analysis: STAC item ids for both dates (and tiles), acquisition timestamps, sensor and platform, collection and catalog, bands and formulas used (section 2.5), thresholds, the reflectance scale and offset applied (section 2.2), the masks applied, working resolution and grid (EPSG:3857, cos²(lat) area correction), minimum mapping unit, valid-pixel shares, the confidence rules, and the attribution strings above. A judge who asks 'how do you know?' gets a screen, not a speech.

## 5. Architecture, API contract, tested snippets, build prompts

### 5.1 Stack and performance tactics

| Layer | Choice | Why |
| --- | --- | --- |
| Backend | Python 3.11 to 3.13, FastAPI + uvicorn (one worker, no `--reload` on stage) | Sync routes run in a thread pool; one analysis at a time keeps RAM safe |
| Raster | `pystac-client`, `odc-stac`, `rasterio`, `numpy`, `scipy`, `pillow`, `pyproj`; `planetary-computer` only for Landsat and the backup catalog | Windowed COG reads, one declared grid |
| LLM | Ollama on `:11434` over plain HTTP with `httpx`; `pydantic` for the plan schema | No Ollama Python package to break |
| Frontend | Leaflet 1.9.4 vendored in `web/` (`leaflet.js`, `leaflet.css`, `images/`); vanilla JS; no CDN, no Tailwind CDN, no build step | Works with the network down |
| Basemap | OSM tiles online with attribution; plain dark canvas offline | OSM policy forbids offline use and prefetching of its tiles \[R: operations.osmfoundation.org/policies/tiles\] |
| Overlay | One RGBA PNG per layer on the EPSG:3857 grid, placed with `L.imageOverlay` and the lon/lat bounds | Leaflet is Web Mercator, so a Mercator-gridded PNG lines up exactly; also gives exact cos²(lat) area |

**Tactics**

- Read only the AOI window of each COG; env vars `GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR` and `AWS_NO_SIGN_REQUEST=YES` are set in `stac_fetch.py`.
- Rank days with a 60 m SCL or QA read; load the 10 to 30 m bands only for the winner.
- Adaptive resolution (3.4); cap boxes at 0.30°; large lakes use 60 to 120 m presets.
- Cache every result under `cache/live/<hash>/`; presets live in `cache/presets/<id>/` and are committed to git.
- Memory budget on the 16 GB laptop (Blueprint estimate \[?\]): OS about 3.5 GB, Chrome about 2.5 GB, backend about 2 GB, model 5 to 7 GB VRAM-resident. Do not run a second analysis while one is loading.
- Before the venue: pull both models, `pip download` or freeze wheels (`pip freeze > requirements.lock.txt`), run every Tier A preset once, vendor Leaflet, and test with Wi-Fi off.
- Set `OLLAMA_KEEP_ALIVE=24h` and warm the model before going on stage.

### 5.2 Folder structure

```text
ask-the-satellite/
├─ README.md  requirements.lock.txt  start_demo.bat  .env
├─ backend/
│  ├─ main.py          routes + analyze orchestrator   (snippet 6)
│  ├─ stac_fetch.py    search, best-day picker, load    (snippet 1)
│  ├─ change.py        masks, indices, stats, PNGs      (snippet 2)
│  ├─ agent.py         planner, cards, guard, router    (snippet 3)
│  ├─ geocode.py  presets.py  precompute.py            (snippet 7)
│  └─ cache/{presets,live,geocode}/
└─ web/  index.html  style.css  map.js  app.js  leaflet.js  leaflet.css  images/   (snippets 4 and 5)
```

`start_demo.bat` (adapt for your OS) \[?\]:

```text
@echo off
set OLLAMA_KEEP_ALIVE=24h
start "" ollama serve
timeout /t 3 >nul
cd backend
start "" http://localhost:8000
uvicorn main:app --port 8000
```

### 5.3 API contract (paste this into every AI prompt)

```text
POST /api/analyze   {bbox:[w,s,e,n], date_before:'2018-01-15', date_after:'2024-01-15',
                     index:'mndwi'|'ndvi'|'flood'|'nbr'|'auto', window_days:30, max_cloud:40, strict:false}
  -> Analysis        errors: 422 {detail} no clear scene; 503 {detail} catalog down

Analysis = {
  analysis_id: 'live:ab12cd34ef' | 'presets:palm_jumeirah',   // ':' -> '/' is the folder under /cache/
  mode: 'live'|'preset',  title: string|null,  index: 'mndwi',
  bounds: [w,s,e,n],                                          // ACTUAL raster extent (lon/lat); place overlays here
  scene_before: {ids:[...], day:'2018-01-14', datetime, platform:'sentinel-2b', sensor:'sentinel-2'|'landsat',
                 resolution_m:20, catalog:'earthsearch'|'pc', candidates:[{day, cloud_tile, valid_pct_aoi}]},
  scene_after:  {...same...},
  stats: {aoi_km2, valid_pct_before, valid_pct_after, valid_pct_both, area_before_km2, area_after_km2,
          gain_km2, loss_km2, net_km2, football_pitches, threshold, min_mapping_unit_px, ignored_small_km2,
          gain_label, loss_label},
  quality: {confidence:'HIGH'|'MEDIUM'|'LOW', flags:['cross_sensor'|'season_mismatch'|'landsat7_slc_gaps'|'low_valid_pixels'],
           headline_hidden: bool},
  ranking: [{index, changed_km2}] | null,                     // only when index was 'auto'
  layers: {rgb_before, rgb_after, change, mask},              // '/cache/<path>/<name>.png'
  attribution: string, error: null }

GET  /api/presets            -> [{id, title, tier, cached, thumb}]
GET  /api/presets/{id}       -> Analysis (mode 'preset'; computed live and cached if the cache is missing)
GET  /api/analysis/{id}      -> Analysis
GET  /api/geocode?q=Palm%20Jumeirah -> {name, bbox, center:[lon,lat], source:'preset'|'nominatim'|'photon', clamped, preset_id}
GET  /api/health             -> {online, stac, ollama, model}

POST /api/chat  {message, lang:'auto'|'en'|'ar'|'hi', last_analysis_id: string|null, preset_id: string|null}
  -> {plan:{intent, place, preset_id, index, date_before, date_after, language, source, note},
      llm_used, reply_measured: string,
      reply_quality: {text, level, flags:[string]} | null,
      reply_interpretation: string | null, interpretation_source: 'llm:<model>'|'template',
      actions: [{type:'fly_to', bbox}, {type:'show_analysis', analysis_id}],
      analysis: Analysis | null}
  // /api/chat never returns an HTTP error: failures come back as a friendly reply_measured.
```

Contract rules: `bounds` are lon/lat; PNG layers are RGBA; `change.png` is blue gain and orange loss; `mask.png` is the grey stripe layer; every response carries both acquisition days; the example values in this document are placeholders, not results.

### 5.4 Tested snippets

**What 'tested' means here:** snippets 1 to 7 were run in a sandbox with synthetic rasters, a stubbed network and a stubbed LLM, and the UI was rendered in headless Chrome (checks listed in section 6). The live STAC, Planetary Computer, Nominatim and Ollama calls were **not** reachable from that sandbox. `smoke.py` (section 0) is your first live test, and every live-call line carries a \[?\] until it passes.

**Snippet 1: `backend/stac_fetch.py`** (search, best-day picker, load on one grid). Key rules: all tiles of one overpass day are mosaicked (the Palm box straddles two tiles); the Landsat catalog is forced to Planetary Computer; `scale_offset` is the section 2.2 table; the winner is chosen by the real valid % of your box.

```python
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
```

**Snippet 2: `backend/change.py`** (radiometry, masks, class-flip change, true km², PNGs, badge). Key rules: never subtract raw reflectance across sensors; area is corrected with cos²(latitude) because EPSG:3857 pixels stretch away from the equator; blobs under 5 pixels are dropped and reported; both dates share one fixed 0 to 0.30 stretch.

```python
"""change.py - radiometry, masks, two-date change, PNGs, stats, confidence. numpy/scipy/pillow only."""
import math
import numpy as np
from PIL import Image
from scipy import ndimage

SCL_BAD = (0, 1, 3, 8, 9, 10)          # no data, saturated, cloud shadow, cloud med/high, cirrus
SCL_BAD_STRICT = SCL_BAD + (2, 7)      # + dark area, unclassified (urban flood / high-rise shadow cases)
BANDS = {"mndwi": ("green", "swir16"), "ndvi": ("nir", "red"), "nbr": ("nir", "swir22")}
THRESH = {"mndwi": 0.0, "ndvi": 0.3}
LABELS = {"mndwi": ("land became water", "water became land"),
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
```

**Snippet 3: `backend/agent.py`** (planner with JSON schema, rule-router fallback, deterministic cards, number guard). Key rules: alias or 'why is it grey' questions skip the LLM; every planner failure falls through to the rule router; the interpretation sentence is accepted only if every number in it already appears in the facts we gave the model, it contains a hedge word (English) and no causal assertion.

```python
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
        "ndvi": ("vegetated area", "مساحة الغطاء النباتي"), "nbr": ("burned area", "المساحة المحترقة")}
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
```

**Snippet 4: `web/map.js`** (Leaflet 1.9.4 swipe, one map). Key rules: the 'after' and change panes are clipped with CSS `clip: rect()` at the divider; the mask pane is not clipped; the OSM layer is online-only; `window.app` is the interface `app.js` uses. Checked in headless Chrome with synthetic overlays.

```javascript
// map.js - Leaflet 1.9.4, ONE map, swipe via two panes + CSS clip. No plugin, no second map to sync.
const map = L.map('map', { zoomSnap: 0.25 }).setView([25.117, 55.138], 12);
const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);   // online only: never cache OSM tiles
map.createPane('beforePane').style.zIndex = 410;
map.createPane('afterPane').style.zIndex = 420;      // clipped: only the right of the divider shows
map.createPane('changePane').style.zIndex = 430;     // clipped like 'after'
map.createPane('maskPane').style.zIndex = 440;       // hatch, not clipped
const layers = {}; let split = 0.5;                  // divider position, 0..1 of map width

function clip() {
  const s = map.getSize(), nw = map.containerPointToLayerPoint([0, 0]), se = map.containerPointToLayerPoint(s);
  const x = nw.x + s.x * split, rect = `rect(${nw.y}px,${se.x}px,${se.y}px,${x}px)`;
  ['afterPane', 'changePane'].forEach(p => map.getPane(p).style.clip = rect);
  document.getElementById('divider').style.left = (split * 100) + '%';
}
map.on('move zoom viewreset resize', clip);

function showAnalysis(a) {                           // a = /api/analyze response
  Object.values(layers).forEach(l => map.removeLayer(l));
  const b = [[a.bounds[1], a.bounds[0]], [a.bounds[3], a.bounds[2]]];         // [[south,west],[north,east]]
  const mk = (url, pane, op) => L.imageOverlay(url, b, { pane, opacity: op }).addTo(map);
  layers.before = mk(a.layers.rgb_before, 'beforePane', 1);
  layers.after  = mk(a.layers.rgb_after,  'afterPane', 1);
  layers.change = mk(a.layers.change,     'changePane', 0.85);
  layers.mask   = mk(a.layers.mask,       'maskPane', 1);
  map.fitBounds(b, { padding: [40, 40] }); clip();
}
const toggle = (name, on) => on ? layers[name].addTo(map) : map.removeLayer(layers[name]);
const flyTo = bbox => map.flyToBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], { padding: [40, 40] });

// divider drag (mouse + touch)
const div = document.getElementById('divider');
const move = e => { const r = map.getContainer().getBoundingClientRect(), cx = (e.touches ? e.touches[0].clientX : e.clientX);
  split = Math.min(1, Math.max(0, (cx - r.left) / r.width)); clip(); };
div.addEventListener('pointerdown', e => { map.dragging.disable(); const up = () => { map.dragging.enable(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); });
window.app = { showAnalysis, toggle, flyTo, map };
```

**Snippet 5: `web/index.html`, `web/style.css`, `web/app.js`** (HUD, Trust panel, chat, story gallery, verify modal, offline pill). Rendered end to end in headless Chrome against the real backend with a stubbed raster source.

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ask the Satellite</title>
<link rel="stylesheet" href="leaflet.css"><link rel="stylesheet" href="style.css"></head>
<body>
<header><b>Ask the Satellite</b><span id="pill" class="pill">checking...</span><span id="stories"></span><button id="verify">Verify the science</button></header>
<main>
  <section id="chat"><div id="log"></div>
    <form id="ask"><input id="q" dir="auto" autocomplete="off" placeholder="Ask about a place: &quot;Show Palm Jumeirah before and after&quot;"><button>Ask</button></form></section>
  <section id="mapwrap"><div id="map"></div><div id="divider" title="Drag"></div>
    <aside id="hud" hidden></aside>
    <div id="layers" hidden>
      <label><input type="checkbox" data-l="change" checked> Change</label>
      <label><input type="checkbox" data-l="mask"> Not measured</label>
      <span class="key"><i class="g"></i>gain <i class="l"></i>loss <i class="m"></i>not measured</span></div>
    <div id="attr"></div></section>
</main>
<dialog id="modal"></dialog>
<script src="leaflet.js"></script><script src="map.js"></script><script src="app.js"></script>
</body></html>
```

```css
:root{--bg:#0b1020;--panel:#121a30;--line:#25304f;--fg:#e8ecf6;--mut:#93a0bd;--hi:#2fbf71;--med:#f0b429;--lo:#e5484d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;height:100vh;display:flex;flex-direction:column}
header{display:flex;gap:10px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--line);flex-wrap:wrap}
header button,#stories button,#ask button{background:#1c2748;color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:5px 9px;cursor:pointer}
#verify{margin-left:auto}.pill{font-size:12px;padding:2px 8px;border-radius:99px;background:#27345e}.pill.off{background:#5a2b2e}
main{flex:1;display:grid;grid-template-columns:380px 1fr;min-height:0}
#chat{display:flex;flex-direction:column;border-right:1px solid var(--line);min-height:0}
#log{flex:1;overflow:auto;padding:10px}#ask{display:flex;gap:6px;padding:10px;border-top:1px solid var(--line)}#q{flex:1;background:var(--panel);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:8px}
.msg{margin:0 0 10px}.me{color:var(--mut)}.card{border-left:4px solid #3b82f6;background:var(--panel);padding:8px 10px;margin:6px 0;border-radius:4px}
.card.q-high{border-color:var(--hi)}.card.q-medium{border-color:var(--med)}.card.q-low{border-color:var(--lo)}.card.ai{border:1px dashed #64708f;border-left:4px dashed #64708f}.card h4{margin:0 0 3px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut)}
.chip{display:inline-block;font-size:11px;background:#27345e;border-radius:99px;padding:1px 8px;margin:3px 3px 0 0}
#mapwrap{position:relative;min-width:0}#map{position:absolute;inset:0;background:#0d1426}
#divider{position:absolute;top:0;bottom:0;width:6px;margin-left:-3px;background:#fff;opacity:.85;cursor:ew-resize;z-index:1000;touch-action:none;display:none}
#hud{position:absolute;top:10px;right:10px;width:270px;background:#121a30ee;border:1px solid var(--line);border-radius:8px;padding:10px;z-index:1000}#hud h2{margin:6px 0 0;font-size:24px}#hud p{margin:2px 0;color:var(--mut)}
.badge{display:inline-block;font-weight:600;border-radius:5px;padding:2px 8px;color:#06101f}.badge.high{background:var(--hi)}.badge.medium{background:var(--med)}.badge.low{background:var(--lo);color:#fff}
.bar{height:8px;background:#27345e;border-radius:4px;margin-top:8px}.bar i{display:block;height:100%;background:var(--hi);border-radius:4px}
#layers{position:absolute;left:10px;bottom:34px;background:#121a30ee;border:1px solid var(--line);border-radius:8px;padding:6px 10px;z-index:1000}.key i{display:inline-block;width:12px;height:12px;margin:0 3px 0 8px;vertical-align:-2px}.key .g{background:#1e90ff}.key .l{background:#ff8c00}.key .m{background:repeating-linear-gradient(45deg,#777,#777 3px,#3c3c3c 3px,#3c3c3c 6px)}
#attr{position:absolute;left:0;right:0;bottom:0;font-size:11px;color:var(--mut);background:#0b1020cc;padding:3px 10px;z-index:1000}
dialog{background:var(--panel);color:var(--fg);border:1px solid var(--line);border-radius:8px;max-width:640px}
@media print{header,#chat,#layers{display:none}main{display:block}#mapwrap{height:60vh}}
```

```javascript
// app.js - wires the API contract to map.js, the HUD, the Trust panel and the chat. Vanilla JS, no build step.
const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = (p, o) => fetch(p, o).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.detail || r.statusText); return j; });
const post = (p, b) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const FLAG = { cross_sensor: 'Different satellites (resolution and bands differ)', season_mismatch: 'Season gap over 45 days', landsat7_slc_gaps: 'Landsat 7 stripe gaps', low_valid_pixels: 'Under 60% measurable' };
let last = null;

function why(s) { return 'Why this scene? Candidates (valid % of your area):\n' + s.candidates.map(c => `${c.day}: ${c.valid_pct_aoi}% valid, tile cloud ${c.cloud_tile}%`).join('\n'); }
function showAnalysis(a) {
  last = a; app.showAnalysis(a);
  const s = a.stats, q = a.quality, b = a.scene_before, f = a.scene_after;
  $('#hud').hidden = $('#layers').hidden = false; $('#divider').style.display = 'block';
  $('#hud').innerHTML = `<span class="badge ${q.confidence.toLowerCase()}">Data confidence: ${q.confidence}</span>` +
    (q.headline_hidden ? `<h2 style="font-size:16px">Too much cloud to measure reliably</h2>`
      : `<h2>${s.net_km2 >= 0 ? '+' : '−'}${Math.abs(s.net_km2).toFixed(1)} km²</h2><p>≈ ${s.football_pitches.toLocaleString()} football pitches</p>`) +
    `<div class="bar"><i style="width:${s.valid_pct_both}%"></i></div><p>${s.valid_pct_both}% measurable on both dates</p>` +
    `<p>Gained ${s.gain_km2} km² · Lost ${s.loss_km2} km²</p>` +
    `<p><span title="${esc(why(b))}">${b.day}</span> → <span title="${esc(why(f))}">${f.day}</span> <small>(hover: why this scene?)</small></p>` +
    q.flags.filter(x => FLAG[x]).map(x => `<span class="chip">${FLAG[x]}</span>`).join('') +
    (s.ignored_small_km2 > 0 ? `<span class="chip">Changes under ${s.min_mapping_unit_px} px ignored: ${s.ignored_small_km2} km²</span>` : '');
  $('#attr').textContent = a.attribution + ' · © OpenStreetMap contributors';
  const mk = document.querySelector('[data-l=mask]'); mk.checked = q.confidence !== 'HIGH'; app.toggle('mask', mk.checked);
  $('#modal').innerHTML = `<h3>Verify the science</h3><p>Index: ${a.index} · threshold ${s.threshold} · min. mapping unit ${s.min_mapping_unit_px} px · grid EPSG:3857, area corrected by cos²(lat)</p>` +
    [b, f].map(x => `<p><b>${x.day}</b> ${esc(x.platform)} · ${x.resolution_m} m · ${esc(x.catalog)}<br><small>${x.ids.map(esc).join('<br>')}</small></p>`).join('') +
    `<p>${esc(a.attribution)}</p><p><small>Confidence is a data-quality badge (valid pixels, sensor match, season match), not a statistical interval.</small></p><form method="dialog"><button>Close</button></form>`;
}
document.querySelectorAll('#layers input').forEach(i => i.onchange = () => app.toggle(i.dataset.l, i.checked));
$('#verify').onclick = () => last ? $('#modal').showModal() : alert('Run an analysis first');

const log = $('#log');
const add = h => { const d = document.createElement('div'); d.className = 'msg'; d.innerHTML = h; log.append(d); log.scrollTop = 1e9; return d; };
const card = (t, body, cls = '') => `<div class="card ${cls}" dir="auto"><h4>${t}</h4>${body}</div>`;
async function ask(message, preset_id = null) {
  add(`<span class="me" dir="auto">${esc(message)}</span>`); const wait = add('<i>Fetching satellite scenes...</i>');
  try {
    const r = await post('/api/chat', { message, preset_id, last_analysis_id: last && last.analysis_id });
    let h = card('Measured by satellite', esc(r.reply_measured));
    if (r.reply_quality) h += card('Data quality', esc(r.reply_quality.text) + r.reply_quality.flags.map(f => `<span class="chip">${esc(f)}</span>`).join(''), 'q-' + r.reply_quality.level.toLowerCase());
    if (r.reply_interpretation) h += card('Interpretation · AI hypothesis', esc(r.reply_interpretation), 'ai');
    wait.innerHTML = h;
    for (const act of r.actions) if (act.type === 'fly_to') app.flyTo(act.bbox);
    if (r.analysis) showAnalysis(r.analysis);
  } catch (e) { wait.innerHTML = card('Error', esc(e.message) + ' Try one of the stories above.', 'q-low'); }
}
$('#ask').onsubmit = e => { e.preventDefault(); const v = $('#q').value.trim(); if (v) { $('#q').value = ''; ask(v); } };

async function boot() {
  try { const h = await api('/api/health'); $('#pill').textContent = h.online ? (h.ollama ? 'online' : 'online · no LLM (rule mode)') : 'offline mode: stories only'; $('#pill').classList.toggle('off', !h.online); } catch { $('#pill').textContent = 'offline mode'; $('#pill').classList.add('off'); }
  try { const ps = await api('/api/presets'); $('#stories').innerHTML = ''; ps.filter(p => p.cached || p.tier === 'A').forEach(p => { const b = document.createElement('button'); b.textContent = p.title; b.onclick = () => ask(p.title, p.id); $('#stories').append(b); }); } catch { }
}
boot();
```

**Snippet 6: `backend/main.py`** (routes and the orchestrator). Key rules: each date gets its own best-day pick, both on one grid and resolution; Earth Search then Planetary Computer for Sentinel-2, Planetary Computer for Landsat; `index='auto'` runs MNDWI and NDVI on the same load and returns the ranking ('what changed the most'); the gallery sends `preset_id`, which skips the planner and the LLM; presets use cached results.

```python
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
    return [dict(id=k, title=v["title"], tier=v["tier"], cached=(CACHE / "presets" / k / "result.json").exists(), thumb=f"/cache/presets/{k}/rgb_after.png")
            for k, v in presets.PRESETS.items()]


@app.get("/api/presets/{pid}")
def get_preset(pid: str):
    if pid not in presets.PRESETS:
        raise HTTPException(404, "unknown preset")
    try:
        return run_preset(pid)
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


app.mount("/cache", StaticFiles(directory=CACHE), name="cache")
if (ROOT.parent / "web").exists():
    app.mount("/", StaticFiles(directory=ROOT.parent / "web", html=True), name="web")
```

**Snippet 7: `backend/geocode.py`, `backend/presets.py`, `backend/precompute.py`.** Geocoder: preset aliases, disk cache, Nominatim at one request per second with an identifying User-Agent (set `GEOCODE_UA` to your team email), then Photon; clamp and resolution rules from 3.4. Presets: the 3.3 registry with target dates and the best-day picker choosing the real scene; boxes marked `verify=True` need an eyeball check on the first render. `precompute.py` writes the offline cache with the same pipeline.

```python
"""geocode.py - preset aliases -> disk cache -> Nominatim (1 req/s, identifying UA) -> Photon. Plus bbox clamp and resolution choice."""
import hashlib, json, math, os, pathlib, threading, time
import httpx
import presets

UA = os.getenv("GEOCODE_UA", "AskTheSatellite-NOVA2026/1.0 (set-your-team-email@example.com)")
CACHE = pathlib.Path(__file__).parent / "cache" / "geocode"
CACHE.mkdir(parents=True, exist_ok=True)
MAX_SIDE_DEG, MIN_HALF_DEG = 0.30, 0.02
_lock, _last = threading.Lock(), [0.0]


def _get(url, params):                                   # one place to patch in tests
    r = httpx.get(url, params=params, headers={"User-Agent": UA}, timeout=8)
    r.raise_for_status()
    return r.json()


def clamp(bbox, max_deg=MAX_SIDE_DEG):
    """Countries and seas come back hundreds of km wide: keep the centre, cap each side, floor at ~4 km."""
    w, s, e, n = bbox
    cx, cy = (w + e) / 2, (s + n) / 2
    hw = max(min((e - w) / 2, max_deg / 2), MIN_HALF_DEG)
    hh = max(min((n - s) / 2, max_deg / 2), MIN_HALF_DEG)
    return [round(cx - hw, 5), round(cy - hh, 5), round(cx + hw, 5), round(cy + hh, 5)], (e - w > max_deg or n - s > max_deg)


def choose_res(bbox, sensors=("sentinel-2",)):
    """<= ~1,600 px per side. Landsat is 30 m native, so one Landsat date forces both dates to 30 m."""
    if "landsat" in sensors:
        return 30
    lat = (bbox[1] + bbox[3]) / 2
    side_km = max((bbox[2] - bbox[0]) * 111.32 * math.cos(math.radians(lat)), (bbox[3] - bbox[1]) * 110.57)
    return 10 if side_km <= 16 else 20 if side_km <= 32 else 30


def _nominatim(q):
    with _lock:                                          # serialise + 1 request per second (OSM policy)
        time.sleep(max(0.0, 1.05 - (time.monotonic() - _last[0])))
        try:
            rows = _get("https://nominatim.openstreetmap.org/search", {"q": q, "format": "jsonv2", "limit": 1})
        finally:
            _last[0] = time.monotonic()
    if not rows:
        return None
    r = rows[0]
    s, n, w, e = (float(v) for v in r["boundingbox"])    # Nominatim order: south, north, west, east
    return dict(name=r["display_name"], bbox=[w, s, e, n], center=[float(r["lon"]), float(r["lat"])], source="nominatim")


def _photon(q):
    j = _get("https://photon.komoot.io/api/", {"q": q, "limit": 1})
    if not j.get("features"):
        return None
    f = j["features"][0]; lon, lat = f["geometry"]["coordinates"]; p = f["properties"]
    ext = p.get("extent")                                # [minlon, maxlat, maxlon, minlat]
    bb = [ext[0], ext[3], ext[2], ext[1]] if ext else [lon - 0.05, lat - 0.05, lon + 0.05, lat + 0.05]
    return dict(name=", ".join(x for x in (p.get("name"), p.get("state"), p.get("country")) if x), bbox=bb, center=[lon, lat], source="photon")


def geocode(q):
    """-> dict(name, bbox(clamped), center, source, clamped, preset_id) or None."""
    pid = presets.match(q)
    if pid:
        pr = presets.PRESETS[pid]; b = pr["bbox"]
        return dict(name=pr["title"], bbox=b, center=[(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], source="preset", clamped=False, preset_id=pid)
    f = CACHE / (hashlib.sha1(q.strip().lower().encode()).hexdigest()[:16] + ".json")
    if f.exists():
        return json.loads(f.read_text())
    hit = None
    for fn in (_nominatim, _photon):
        try:
            hit = fn(q)
        except Exception:                                # 429 / 503 / offline -> next provider
            hit = None
        if hit:
            break
    if not hit:
        return None
    hit["bbox"], hit["clamped"] = clamp(hit["bbox"]); hit["preset_id"] = None
    f.write_text(json.dumps(hit))
    return hit
```

```python
"""presets.py - curated story registry. before/after are TARGET dates: the best-day picker chooses the real scene.
tier A = precompute tonight (offline demo set). tier B = add if time. Boxes marked verify=True: eyeball them on the first render."""
import re


def box(lat, lon, h=0.12):
    return [round(lon - h, 4), round(lat - 0.9 * h, 4), round(lon + h, 4), round(lat + 0.9 * h, 4)]


def P(title, bbox, before, after, index, sensor, res, aliases, context, tier="A", win=(30, 30), max_cloud=40, verify=False):
    return dict(title=title, bbox=bbox, before=before, after=after, index=index, sensor=sensor, res=res,
                aliases=aliases, context=context, tier=tier, win=win, max_cloud=max_cloud, verify=verify)


PRESETS = {
    "palm_jumeirah": P("Palm Jumeirah reclamation", [55.095, 25.085, 55.175, 25.150], "2001-05-22", "2008-05-17", "mndwi", "landsat", 30,
                       ["palm jumeirah", "jumeirah", "palm island", "نخلة جميرا", "نخلة"],
                       "Construction began in June 2001; NASA Earth Observatory describes the Palm as begun in 2001 and completed in 2006.", win=(45, 45), max_cloud=60),
    "the_world": P("The World islands", [55.120, 25.180, 55.230, 25.260], "2003-05-01", "2008-05-01", "mndwi", "landsat", 30,
                   ["the world islands", "world islands", "the world", "جزر العالم"],
                   "NASA Earth Observatory describes The World as begun in 2003 and completed in 2008.", win=(45, 45), max_cloud=60, verify=True),
    "lake_mead": P("Lake Mead drought", [-114.87, 35.98, -114.05, 36.55], "2019-08-14", "2022-09-07", "mndwi", "sentinel-2", 60,
                   ["lake mead", "mead", "بحيرة ميد"],
                   "The reservoir stood at 1,040.58 feet in late July 2022, a record low at that time.", win=(3, 3), max_cloud=60),
    "dubai_flood_2024": P("UAE flood, April 2024", [55.080, 24.840, 55.240, 24.980], "2024-04-07", "2024-04-21", "flood", "sentinel-2", 20,
                          ["dubai flood", "uae flood", "flood 2024", "april 2024", "فيضان", "فيضانات"],
                          "On 16 April 2024 the UAE recorded its heaviest rainfall since records began in 1949; 254.8 mm fell at Khatm Al Shakla in under 24 hours (National Center of Meteorology).",
                          win=(6, 4), max_cloud=60, verify=True),
    "abu_dhabi_mangroves": P("Abu Dhabi mangroves", [54.400, 24.420, 54.520, 24.500], "2017-10-15", "2026-10-15", "ndvi", "sentinel-2", 20,
                             ["mangrove", "mangroves", "abu dhabi mangrove", "المانغروف", "القرم"],
                             "Eastern Mangrove National Park and Jubail Island are conservation areas; vegetation over tidal flats also moves with the tide.", verify=True),
    "aral_sea": P("Aral Sea east basin", [59.0, 43.9, 61.6, 45.8], "2000-08-15", "2014-08-19", "mndwi", "landsat", 120,
                  ["aral sea", "aral", "بحر آرال", "بحر ارال"],
                  "NASA Earth Observatory reported the east basin completely dried by 19 August 2014.", win=(45, 45), max_cloud=60, verify=True),
    # ---- tier B ----
    "palm_jebel_ali": P("Palm Jebel Ali", box(24.99, 54.98), "2001-05-22", "2008-05-17", "mndwi", "landsat", 30, ["jebel ali", "palm jebel ali"],
                        "USGS notes it was built in the early 2000s and suspended in 2009.", "B", (45, 45), 60, True),
    "kakhovka": P("Kakhovka reservoir drained", box(46.78, 33.37, 0.15), "2022-06-07", "2023-06-18", "mndwi", "landsat", 30, ["kakhovka", "kakhovka dam"],
                  "The dam was breached on 6 June 2023; NASA reported about 75 percent of the reservoir water had drained by 18 June.", "B", (10, 10), 60, True),
    "derna": P("Derna dam collapse", box(32.77, 22.64, 0.08), "2023-08-25", "2023-09-16", "flood", "sentinel-2", 20, ["derna", "درنة"],
               "The dams failed on the night of 10 to 11 September 2023 during Storm Daniel.", "B", (10, 6), 60, True),
    "pakistan_manchar": P("Sindh floods 2022", box(26.4, 67.65, 0.25), "2022-06-25", "2022-08-31", "flood", "landsat", 30, ["pakistan flood", "sindh", "manchar"],
                          "NASA described 31 August 2022 as near the peak of the flooding in Sindh.", "B", (10, 10), 60, True),
    "lake_poopo": P("Lake Poopo", box(-18.75, -67.1, 0.3), "2013-03-01", "2016-01-15", "mndwi", "landsat", 30, ["poopo", "lake poopo"],
                    "The lake was reported dried up by December 2015.", "B", (45, 45), 60, True),
    "great_salt_lake": P("Great Salt Lake", box(41.1, -112.5, 0.45), "1986-09-01", "2022-10-20", "mndwi", "landsat", 60, ["great salt lake", "salt lake"],
                         "USGS recorded a record low of 4,188.5 feet on 7 November 2022.", "B", (45, 45), 60, True),
    "lake_chad": P("Lake Chad", box(13.0, 14.0, 0.5), "1984-11-01", "2018-10-15", "mndwi", "landsat", 60, ["lake chad", "chad"],
                   "NASA reports the lake is now under one tenth of its 1960s area.", "B", (45, 45), 60, True),
    "rondonia": P("Rondonia deforestation", [-62.950, -10.550, -62.800, -10.400], "1990-07-15", "2023-07-15", "ndvi", "landsat", 30, ["rondonia", "rondônia", "amazon deforestation"],
                  "NASA describes a fishbone clearing pattern that spread from the 1970s to the 1990s.", "B", (45, 45), 60, True),
    "jasper_wildfire": P("Jasper burn scar, July 2024", [-118.150, 52.800, -117.980, 52.920], "2024-07-05", "2024-08-25", "nbr", "sentinel-2", 20, ["jasper", "jasper wildfire"],
                         "A large wildfire burned in and around Jasper National Park in July 2024.", "B", (7, 7), 60, True),
    "al_ain_flood_2024": P("Al Ain flood, April 2024", [55.660, 24.140, 55.820, 24.270], "2024-04-07", "2024-04-21", "flood", "sentinel-2", 20, ["al ain flood"],
                           "The 16 April 2024 storm was the heaviest in the UAE since records began in 1949.", "B", (6, 4), 60, True),
}

_ALIASES = sorted(((a.lower(), k) for k, v in PRESETS.items() for a in v["aliases"]), key=lambda t: -len(t[0]))


def match(text):
    t = text.lower()
    for a, k in _ALIASES:
        if re.search(r"(?<![a-z])" + re.escape(a) + r"(?![a-z])", t) if a.isascii() else a in t:
            return k
    return None
```

```python
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
```

### 5.5 Build prompts for the four roles

The code in 5.4 already exists. These prompts only extend or harden it, so each one is short and ends with an acceptance test. Paste the context block first, then the role prompt, then the files that prompt names.

**Context block (paste first, every time)**

```text
Project: "Ask the Satellite", hackathon demo, pitch Fri 13 Nov 2026.
Stack: Python 3.11, FastAPI, rasterio, numpy, httpx. Frontend: Leaflet 1.9.4 vendored, no build step, no CDN.
Existing tested files: backend/stac_fetch.py, change.py, agent.py, main.py, geocode.py, presets.py, precompute.py; web/map.js, index.html, style.css, app.js.
Hard rules:
1. Do not change the Analysis JSON contract or any function signature unless this prompt says so. Additive fields only.
2. Numbers come only from change.py. The LLM never computes, converts or invents a number.
3. Radiometry: Sentinel-2 DN x 0.0001 with offset 0 when earthsearch:boa_offset_applied is true; otherwise offset -0.1 when processing baseline >= 4.0. Landsat C2 L2: DN x 2.75e-5 - 0.2, valid DN 7273 to 43636.
4. Return complete files. No placeholders, no TODO, no new heavy dependency.
5. End with one line: what you could not test.
```

**Prompt A: live hardening and inspector grid (backend)**

```text
Role A. Files: stac_fetch.py, change.py, main.py, smoke.py.
1. Run smoke.py against the live network. Fix every failure in stac_fetch.py (anonymous Earth Search COG windowed reads, Planetary Computer fallback with sign_inplace, 20 s search timeout, 3 retries with backoff).
2. Make the open-sea reflectance sanity test (0.01 to 0.10) add a flag to quality.flags instead of raising.
3. Write cache/<id>/grid.json for every analysis: a 96 x 96 downsample with before index, after index and valid flag per cell, plus bounds. Add layers.grid (URL) to the Analysis. This is the only allowed contract change.
4. Map NoScene, Timeout and DataError to friendly messages in the error field; never a stack trace.
Acceptance: Palm Jumeirah bbox returns the full contract JSON in under 15 s warm; Lake Mead benchmark printed by precompute.py is within about 5% of the tutorial figures it prints [R]; killing the network returns a friendly error, not a 500.
```

**Prompt B: UI extensions (frontend)**

```text
Role B. Files: web/index.html, style.css, app.js, map.js.
1. Expert mode: two-click box on the map, two date pickers, index selector (MNDWI, NDVI, flood, dNBR), a Run button posting to /api/analyze. Keep 'Analyze current view' as the fallback if drawing breaks.
2. Pixel inspector: on hover or tap, read layers.grid once, show 'before 0.31 water -> after -0.12 land' or 'masked: cloud'. No network call per move.
3. Projector mode (key P): fonts at least 22 px, overlay opacity 0.92, brighter labels.
4. Print view: @media print hides chat, keeps map, HUD, three cards, badge and attribution on one page.
5. Arabic quick-prompt chips; dir="auto" on every card.
Acceptance: no horizontal scroll at 1280x720 and 1920x1080; every preset works with the network off; browser console shows no errors; swipe stays smooth with the inspector on.
```

**Prompt C: agent bake-off and Arabic proofreading**

```text
Role C. Files: agent.py plus a new bench_llm.py.
1. bench_llm.py: 20 questions (10 English, 10 Arabic, including unknown place, cloudy-scene wording, 'why is part of it grey?'). For qwen3.5:9b-q4_K_M and qwen2.5:7b-instruct-q4_K_M record: valid JSON %, correct plan %, numbers_ok %, p50 and p95 latency. Print one table.
2. Choose the model with the rule in section 3.1; set MODELS order in agent.py; keep qwen3.5:4b-q4_K_M as the last fallback.
3. Proofread the Arabic NOUN, FLAG and card templates for grammar and number formatting. Do not translate with the LLM at run time.
Acceptance: planner returns a valid Plan for at least 18 of 20 questions or the rule router takes over; no card ever shows a number that is not in the analysis (numbers_ok test passes).
```

**Prompt D: precompute, QA, README, launcher**

```text
Role D. Files: precompute.py, presets.py, README.md, start_demo.bat, qa_checklist.md.
1. Run precompute.py for Tier A, then Tier B. For each preset record dates, sensors, valid %, badge, km², and one line on whether the magnitude is plausible.
2. Write qa_checklist.md with one row per preset and a tick for: scene dates visible, attribution visible, badge matches valid %, loads with the network off.
3. README: run steps from a clean machine, data sources and attribution, models and licences, limitations, 'no model training was performed'.
4. start_demo.bat: warm Ollama, start uvicorn, open the browser. Power plan Best performance.
Acceptance: with Wi-Fi off, all Tier A presets and three chat questions work from README commands only.
```

**Prompt E: integration contract test (A runs it at each checkpoint)**

```text
Write tests/contract_test.py. It calls a running server on :8000: /api/health, /api/presets, /api/presets/{id}, /api/geocode, /api/analyze, /api/chat (with and without preset_id), /api/analysis/{id}. For each response assert the keys and types listed in section 5.3 and that every number in reply_measured appears in analysis.stats. Print PASS or the first failing key. Exit non-zero on failure.
```

### 5.6 Stage failure fallbacks

| Failure on stage | How you notice | Fallback | What to say |
| --- | --- | --- | --- |
| Venue Wi-Fi drops or is slow | Offline pill, request over 8 s | Presets and gallery cards are served from disk; chat for preset places uses the rule router; skip the live-proof beat | "Everything on screen was measured earlier by the same code; a live run needs internet." |
| Earth Search 5xx or timeout | NoScene or Timeout error | Automatic Planetary Computer fallback in `_pick`, then the matching preset | "Primary catalogue is down; the backup catalogue answered." |
| Ollama hangs, runs out of memory or is not running | `llm_up` false or 20 s timeout | Rule router plus f-string cards; the measured and quality cards always show | "AI wording is off; the numbers and the trust check are unchanged." |
| Projector washes out the map | Overlay hard to see | Projector mode (key P); fixed 0 to 0.30 stretch stays; test at 12:30 | None; fix quietly |
| Laptop throttles or runs on battery | Slow responses, `ollama ps` shows CPU | Mains power, Best performance plan, close Slack, Discord and extra tabs | None |
| Place not found | Geocoder returns nothing | Friendly message plus preset suggestions | "Try one of these prepared places." |
| Chosen live scene is cloudy | LOW badge, valid under 50% | Show the badge as a feature; headline is hidden by design; switch to a preset | "The system refuses to give a number it cannot trust." |
| Server crashes | Blank map, failed requests | Rerun `start_demo.bat` (under 20 s); if still down, play the 3-minute backup video | "Let me show the recorded run while it restarts." |
| Browser tab freezes | UI unresponsive | Reload; re-click the preset (served from disk) | None |
| Jury asks for an uncached place while offline | Live run fails | Say it needs internet; show the nearest preset | "Offline I can show prepared places; online it works anywhere with clear skies." |

## 6. Hour-by-hour plan, cut-list, freeze checklist, morning prep

Catch-up plan, Dubai time, starting Thu 12 Nov 20:15. Both source plans assumed a 6 PM start; you are about two hours behind, but the code in 5.4 already exists, so the first hour is install and live testing, not writing. Hard feature cut-off is **01:30** (not 3 AM). Sleep 04:00 to 07:45. Pitch is Fri 13 Nov 1 PM. The submission time is not confirmed (section 0b); the Blueprint says code is due before 12 noon, so plan to submit at 11:30.

| Time | A (Data / backend) | B (Map UI) | C (Agent / LLM) | D (Presets / QA / pitch) |
| --- | --- | --- | --- | --- |
| 20:15 to 21:15 | venv, `pip install`, run `smoke.py` live; fix STAC and Planetary Computer issues (Prompt A, step 1) | Serve `web/` from the backend; open the Palm bbox in the browser; confirm vendored Leaflet loads with Wi-Fi off | Install Ollama, pull both models, check `ollama ps` shows GPU; run `test_app.py` | Start `precompute.py` Tier A in the background; send the 0b questions to organizers; create the repo and README stub |
| **21:15 CP1** | **Slice works: bbox, two dates, overlay and km² in the browser. `git tag v0.1`** |  |  |  |
| 21:15 to 22:15 | Live best-day picker, Planetary Computer fallback, `grid.json` (Prompt A, steps 2 to 4) | Expert mode (Prompt B, step 1); check Trust Panel visuals | `bench_llm.py` and lock the model (Prompt C, steps 1 and 2) | Check each Tier A output against `qa_checklist.md`; rerun any that fail |
| 22:15 to 22:45 | **Dinner in shifts: A and B at 22:15, C and D at 22:30. One person always coding.** |  |  |  |
| 22:45 to 00:00 | Live geocode (Nominatim user agent), clamp, hash cache; `contract_test.py` | Pixel inspector, Arabic chips, offline pill | Edge cases: unknown place, cloudy scene, no scenes; 20 test questions; Arabic proofread | Tier B precompute; QA; README draft |
| **00:00 CP2** | **Chat to fly-to to analysis to narration works end to end. At least 8 presets load with Wi-Fi off. `git tag v0.2`** |  |  |  |
| 00:00 to 01:30 | 'What changed the most' (`index=auto`) live check; friendly errors | Projector mode, print view, legend and mask hatch | 'Why this scene?' content check; freeze prompts | 6-slide draft; first rehearsal against the script (section 8); everyone takes a 20-minute break in this window |
| **01:30 CP3, HARD CUT-OFF** | **All MUSTs in 4.1 done? Cut the rest by the cut-list below. After this, bugs only.** |  |  |  |
| 01:30 to 03:00 | Bugs; make the 3 pitch scenarios cache hits | Projector check at 1920x1080 and 1280x720 | Kill Ollama and test the fallbacks (5.6); final Arabic check | Rough 3-minute backup video |
| 03:00 to 04:00 | Freeze checklist below |  |  |  |
| 04:00 to 07:45 | Sleep. Nobody codes. |  |  |  |

**Cut-list, in order.** Palm timeline slider, WorldCover layer, projector mode, print view, pixel inspector, Arabic quick-prompt chips (keep Arabic answers), expert-mode box drawing (keep 'Analyze current view' and the date pickers), `index=auto` ranking (ship water-only). **Never cut:** Trust Panel, preset gallery, acquisition dates and attribution, offline mode.

**Freeze checklist (03:00 to 04:00)**

- [ ] `git tag v1.0-submission`; push; put the commit hash in the README.
- [ ] Reboot the demo laptop, Wi-Fi off, start from README commands only; run every preset and 3 chat questions.
- [ ] Wi-Fi on: one live analysis at a random lake.
- [ ] `ollama ps` shows GPU; close Slack, Discord and extra tabs.
- [ ] The 3 pitch scenarios are cache hits.
- [ ] 3-minute backup video recorded; saved on the laptop, on a USB stick and in the repo.
- [ ] README has run steps, data sources and attribution, models and licences, limitations, 'no model training was performed'.
- [ ] `start_demo.bat` works from a cold start; power plan Best performance; sleep and updates off; display scaling 100%.

**Morning, Fri 13 Nov**

| Time | What |
| --- | --- |
| 07:45 | Wake. |
| 08:00 to 08:45 | Slides, 6 maximum: (1) problem, (2) live demo placeholder, (3) how it works: question, plan, satellites, measured change, trust check, explanation, (4) Trust Panel, (5) who uses it and business model, (6) team and next steps (Sentinel-1 radar, change alerts). |
| 09:00 | Timed run-through 1; cut to fit. |
| 10:00 | Run-through 2; target 6:00. |
| 10:45 | Run-through 3 with Wi-Fi off. |
| 11:00 | Cold reboot of the demo laptop; clean start from README; all presets and 3 chat questions. |
| 11:30 | Confirm `git log -1` on the demo laptop equals the submitted commit; submit (time to be confirmed in 0b). Do not touch code after this. |
| 12:15 | Be on stage early; test the projector with the app and with the backup video; eat. |
| 13:00 | Pitch. |

**Speakers.** D opens and closes. B drives the laptop. A narrates scenarios 1 and 2 and takes technical questions. C narrates the chat scenario and takes AI and trust questions.

### 6.1 What was tested in the sandbox, and what was not

Passed with synthetic rasters and stubbed network, LLM and geocoder: `test_change.py`, `test_load.py`, `test_app.py` (rule router on 10 questions, `numbers_ok`, end-to-end `TestClient`, Arabic card, LOW headline hidden, clamp and `choose_res`), and a headless-Chrome screenshot of the UI. **Not run anywhere yet:** live Earth Search, Planetary Computer, Nominatim, Ollama. `smoke.py` at 20:15 is the first real test; treat any failure there as the top priority.

## 7. Top 10 risks and mitigations

| # | Risk | Mitigation | Owner |
| --- | --- | --- | --- |
| 1 | The live data path has never run (sandbox had no network). `smoke.py` may fail on first contact | Run `smoke.py` at 20:15; Planetary Computer fallback is already coded; Tier A presets are precomputed so the demo does not depend on the live path | A |
| 2 | Wi-Fi dies or STAC is slow on stage | Pitch scenarios are cache hits; presets on disk; offline pill; 3-minute backup video; phone hotspot as a spare. Table in 5.6 | A, D |
| 3 | Planetary Computer or Earth Search search timeouts during precompute \[R\] | Start Tier A at 20:15 with retries; fewer presets rather than none; if a scene cannot be fetched, drop that preset instead of faking it | D |
| 4 | LLM returns bad JSON, invents numbers, is slow, or runs out of memory | Schema-constrained output, temperature 0, `numbers_ok` guard, f-string cards, 20 s timeout then rule router, `num_ctx` 4096, close other apps, fall back to the 4B model (3.1, 3.2) | C |
| 5 | Clouds over the flood scenes | Best-day picker (2.4); LOW badge shown as a feature; headline hidden when valid area is under 50%; pick the flood preset at 01:30 by real valid %, with Kakhovka as the backup story | A, D |
| 6 | False change from comparing different sensors, or Landsat 7 stripes after May 2003 | Class comparison rather than raw index differencing, 30 m resampling, SLC gaps treated as no-data, automatic MEDIUM badge and flag chip (4.2) | A |
| 7 | Wrong areas or wrong reflectance (EPSG:3857 distortion; Sentinel-2 offset applied twice or not at all) | cos²(lat) area correction; per-item offset rule from the `earthsearch:boa_offset_applied` flag; open-sea reflectance check (0.01 to 0.10); Lake Mead benchmark in `precompute.py`. Do not use the Blueprint's 'query c1-l2a and subtract 1000' fix, it conflicts with the verified rule (1.2) | A |
| 8 | Four people's modules do not fit together | One API contract (5.3) in every prompt; `contract_test.py` at 21:15 and 00:00; A integrates | A |
| 9 | Late start, and the deadline or submission format is misunderstood | Ask the 10 questions in 0b now; tag `v0.1` by 21:15; hard feature cut-off 01:30; submit at 11:30 unless organizers say otherwise | D |
| 10 | Projector washes out or breaks the layout | Projector mode (key P); test 1280x720 and 1920x1080 at 02:00 and again on stage at 12:30; fixed 0 to 0.30 reflectance stretch | B |

## 8. Six-minute script and jury questions

The two source scripts quoted figures that nobody measured (areas, pitch counts, valid percentages, query cost). This version has none. Every number is **read off the screen** from the HUD and Trust Panel at the moment you show it; square brackets mark what to read. Facts stated from memory are limited to those with a source in section 9.

| Time | Speaker | On screen | Say |
| --- | --- | --- | --- |
| 0:00 to 0:30 | D | Title slide, then the app | "Every few days a European satellite photographs almost every coast, forest and lake on Earth, for free. Reading those images takes GIS training. Ask the Satellite lets you ask in English or Arabic, and answers with measured evidence and how much to trust it." |
| 0:30 to 1:50 | A talks, B drives | Gallery card 'Palm Jumeirah reclamation'; swipe before and after | "Sentinel-2 did not exist in 2001, so history uses USGS Landsat. Here is open sea on \[before date\]; here is the Palm on \[after date\]. Construction began in June 2001." Swipe. Read the big sentence. "Trust Panel: \[read badge and first chip\]. Dates and sources are always on screen." |
| 1:50 to 3:10 | A | Gallery card 'UAE flood, April 2024'; swipe; toggle the mask | "On 16 April 2024 the UAE recorded its heaviest rainfall since records began in 1949, according to the National Center of Meteorology. Left is \[before date\], right is \[after date\]." Read the new-water km². Toggle the mask: "Grey is hidden by cloud or no data. We never count it as 'no change'." **Backup story:** Kakhovka, "the dam was breached on 6 June 2023; NASA reported about 75 percent of the water had drained by 18 June". |
| 3:10 to 4:30 | C | Chat: type 'Did Lake Mead shrink?' (Arabic version if time allows) | The map flies and the layers switch on. Read the Measured card, then the Quality card, then the 'what it might mean' box (it hedges; it does not claim a cause). "The AI never computes a number. It plans the question and words the answer. Our code measures, and a validator rejects any number that is not in the results. It runs on this laptop, free." Say '2022 low', not a record claim. |
| 4:30 to 5:00 | A | Expert mode or search box, **only if online** | "Pick any lake." One live Sentinel-2 run. If it takes more than 15 s: "While it runs, here is how the trust check works" and carry on. If offline, skip this beat. |
| 5:00 to 5:30 | D | Slide 5 | "Journalists checking claims, Gulf planners tracking reclamation, NGOs and insurers doing first-pass flood checks, teachers. Free public tool; a paid tier for saved areas, change alerts and branded reports. The data is open Copernicus and USGS." |
| 5:30 to 6:00 | D | Closing slide | "Free data, honest numbers, plain language. Ask the Satellite." |

**Stage rules.** Behind schedule at 3:10: skip the Arabic question. Network drops: skip 4:30 to 5:00 and use the line in 5.6. A scene fails to load: switch to the backup preset without commenting. Never say a number that is not on the screen.

### 8.1 Jury questions and answers

1. **How accurate are the km² figures?** They are pixel counts at 10, 20 or 30 m after masking, with an area correction for map-projection distortion. Edges are uncertain by about one pixel, blobs under 5 pixels are dropped, and the valid percentage is always shown. We have not validated against ground truth; the only external check is one published Lake Mead benchmark (section 9), and we say so.
2. **What about clouds and shadows?** Sentinel-2 scene-classification classes and Landsat QA bits mask cloud, shadow and cirrus. Masked pixels are grey and excluded from both areas. Below 50% valid, the headline number is hidden.
3. **Why should we trust the AI?** Code measures; the model only plans the query and words the result. A validator blocks any number that is not in the results, the interpretation sits in a separate hedged box, and if the model fails the system falls back to rules and templates.
4. **Comparing 2001 Landsat with modern Sentinel-2 is not fair.** Agreed. We never subtract raw values across sensors: we compare classes (water or not), resample to the coarser grid, and drop the confidence badge one level when the sensor family differs. The preset histories use Landsat for both dates.
5. **What about Landsat 7 stripes?** Its scan-line corrector failed on 31 May 2003, so later scenes have gaps (USGS gives roughly 22 percent of each scene \[R\]). We treat gaps as no data and show a chip; we do not hide it.
6. **Is it global?** Anywhere Sentinel-2 L2A has coverage and the sky is clear. Sentinel-2 starts in 2015, and the scene picker reports what the catalogue holds for a given place. Deeper history is curated Landsat presets today; live Landsat is the next step.
7. **Why indices instead of a trained model?** MNDWI, NDVI and dNBR are published, deterministic and auditable: the Verify modal lists the scene ids, formulas, thresholds and masks, so anyone can reproduce a number. No model training was performed.
8. **Will it scale?** It reads only the box's pixels from cloud-optimised files and caches results by area and date. Heavy use would need a job queue and a hosted model.
9. **Why a local model?** Privacy, zero cost and offline operation. A rule-based path and an optional hosted model mean no single point of failure.
10. **What about clouds during floods?** Optical imagery cannot see through them, which is why the badge exists. The next step is free Sentinel-1 radar.
11. **Business model and licences?** Copernicus Sentinel data is free and open, including commercial use, with attribution; Landsat is public domain with a USGS credit requested. Freemium: free answers, paid alerts and reports.

## 9. Reference matrix, validation benchmark, unverified list and sources

### 9.1 Endpoint and dataset matrix

| Component | What we use | Endpoint or page | Terms and notes |
| --- | --- | --- | --- |
| Primary STAC | Element 84 Earth Search v1, collection `sentinel-2-l2a`; anonymous COG reads | https://earth-search.aws.element84.com/v1 (docs: /v1/api.html; repo: github.com/Element84/earth-search) | Copernicus attribution. Per-item flag `earthsearch:boa_offset_applied` decides the offset \[V\]. Its `landsat-c2-l2` is requester-pays: never use it \[R\] |
| Backup and Landsat STAC | Microsoft Planetary Computer: `sentinel-2-l2a`, `landsat-c2-l2`, `esa-worldcover` | https://planetarycomputer.microsoft.com/api/stac/v1 (SAS tokens: /api/sas/v1/token) | Free anonymous signing with `planetary_computer.sign` / `sign_inplace`; USGS and Copernicus attribution. Search timeouts reported in 2026 \[R\] |
| Land-cover context | ESA WorldCover 10 m (2020 v100, 2021 v200) | planetarycomputer.microsoft.com/dataset/esa-worldcover | CC-BY-4.0 \[R\]. Context only, never differenced; STRETCH feature |
| Python | pystac-client, rasterio, numpy, httpx, planetary-computer, FastAPI (5.1) | pypi.org | Current versions not checked tonight \[?\]: pin whatever resolves and `pip freeze` |
| Frontend | Leaflet 1.9.4, vendored, no plugin, no CDN | unpkg.com/leaflet@1.9.4/dist/ | BSD-2-Clause. Leaflet 2.0 was still unreleased in the sources \[R\] |
| Geocoding | Nominatim, then Photon | https://nominatim.openstreetmap.org/search ; https://photon.komoot.io/api/ | ODbL attribution. Nominatim needs a custom User-Agent and at most 1 request per second. Photon terms not checked \[?\] |
| Basemap | OpenStreetMap tiles | operations.osmfoundation.org/policies/tiles/ | Attribution required; never cache or pre-download tiles; dark canvas when offline |
| Landsat scaling | Collection 2 Level-2: DN x 2.75e-5 - 0.2 | USGS LSDS-2032 user guide | \[R\]. QA\_PIXEL bit positions still to confirm \[?\] |
| Local models | Ollama: `qwen3.5:9b-q4_K_M`, `qwen2.5:7b-instruct-q4_K_M`, fallback `qwen3.5:4b-q4_K_M` | ollama.com/library | Sizes and speeds to be measured by `bench_llm.py`, not taken from the reports |
| Optional hosted model | Gemini free tier | ai.google.dev | Limits are unpublished and change; never the primary demo path \[R\] |

### 9.2 Validation benchmark

`precompute.py` prints the Lake Mead open-water area before and after and compares it with a published Sentinel-2 STAC tutorial: **324.1 km² on 14 Aug 2019 and 267.1 km² on 7 Sep 2022** \[R\]. Expect agreement within about 5%; our figures differ slightly because we use a joint valid mask, and the comparison is only indicative if our box differs from the tutorial's \[?\]. The same tutorial shows the scene-classification water class over-reading MNDWI by 50 to 82 km² a year \[V\], which is why SCL is used only as a mask. For the UAE flood, the Al-Ain flood study (DOI below) is the external reference for scene dates and method \[R\]. None of this is ground truth, and the pitch says so (8.1, question 1).

### 9.3 Not verified, and figures deliberately not reused

- **Confirm at the step named (⚠):** Landsat C2 QA bits and the Planetary Computer `qa_pixel` key; Ollama `think` and structured-output fields on your installed version; Qwen 3.5 Hindi quality; Photon terms; `qwen3.5:4b` size; scene dates for Derna, the Lake Poopo 'before' image and post-flood Dubai; every preset box marked verify in 3.3 (eyeball on first render).
- **Say '2022 low' for Lake Mead.** One source reports the July 2022 low was broken in August 2026 \[R\].
- **Not reused from the Blueprint because no source or measurement backs them:** the 5.8 km², 812 pitches, 99.1% valid, 17.6 km² flood and 43.1 km² Lake Mead figures in its script; the $0.002 per query and $499 per month figures; its tokens-per-second table; its three-storm rainfall table. Also not reused: its 'query `c1-l2a` and subtract 1000' fix, which conflicts with the verified per-item offset rule.

### 9.4 Sources

**Data access and method**

- [Introducing Earth Search v1 (Element 84)](https://element84.com/geospatial/introducing-earth-search-v1-new-datasets-now-available/)
- [Earth Search repository and general notes](https://github.com/Element84/earth-search)
- [Planetary Computer documentation](https://planetarycomputer.microsoft.com/docs)
- [Planetary Computer: Sentinel-2 L2A](https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a)
- [Planetary Computer: ESA WorldCover](https://planetarycomputer.microsoft.com/dataset/esa-worldcover)
- [Planetary Computer issue tracker (timeouts)](https://github.com/microsoft/PlanetaryComputer/issues)
- [Reading Landsat data from Microsoft (STAC tutorial)](https://stacspec.org/en/tutorials/reading-stac-planetary-computer/)
- [USGS LSDS-2032 Landsat cloud direct access guide](https://d9-wret.s3.us-west-2.amazonaws.com/assets/palladium/production/s3fs-public/atoms/files/LSDS-2032-Landsat-Commercial-Cloud-Direct-Access-Users-Guide-v2.pdf.pdf)
- [Sentinel-2 or Landsat? Choosing an imagery source](https://www.spatialworkflow.io/sentinel-2-vs-landsat-explained/)
- [Cloud Native Remote Sensing with Python (course)](https://courses.spatialthoughts.com/python-remote-sensing.html)
- [Arab Youth Space Hackathon data and satellite resources](https://spaceacademy-hackathons.space.gov.ae/data)

**Benchmarks**

- [Lake Mead shoreline change with Sentinel-2, STAC and Python](https://www.technicalgis.com/tutorials/sentinel-2-stac-lake-mead/)
- [Al-Ain flood impact study (DOI)](https://doi.org/10.1038/s41598-025-12234-w)

**Preset context**

- [NASA Earth Observatory: Artificial Archipelagos, Dubai](https://www.earthobservatory.nasa.gov/images/42477/artificial-archipelagos-dubai-united-arab-emirates)
- [The National: when Palm Jumeirah construction began](https://www.thenationalnews.com/weekend/2023/06/16/timeframe-when-construction-on-palm-jumeirah-began-22-years-ago/)
- [USGS EarthShots: Palm Jebel Ali](https://eros.usgs.gov/earthshots/palm-jebel-ali)
- [Arabian Business: UAE rainfall record](https://www.arabianbusiness.com/culture-society/uae-rain-breaks-record-as-country-sees-biggest-downpour-in-75-years)
- [2024 United Arab Emirates floods](https://en.wikipedia.org/wiki/2024_United_Arab_Emirates_floods)
- [The aftermath of the Kakhovka Dam's destruction](https://www.maproomblog.com/2023/07/the-aftermath-of-the-kakhovka-dams-destruction/)
- [Derna dam collapses](https://en.wikipedia.org/wiki/Derna_dam_collapses)
- [NASA: Lake Manchar is overflowing](https://earthobservatory.nasa.gov/images/150306/lake-manchar-is-overflowing)
- [NASA: Flood woes continue in Pakistan](https://earthobservatory.nasa.gov/images/150470/flood-woes-continue-in-pakistan)
- [NASA: Bolivia's Lake Poopo disappears](https://science.nasa.gov/earth/earth-observatory/bolivias-lake-poopo-disappears-87363/)
- [NASA: the Aral Sea loses its eastern lobe](https://science.nasa.gov/earth/earth-observatory/the-aral-sea-loses-its-eastern-lobe-84437)
- [USGS: Great Salt Lake elevations and areal extent](https://www.usgs.gov/centers/utah-water-science-center/science/great-salt-lake-elevations-and-areal-extent)
- [NASA: Lake Chad](https://science.nasa.gov/earth/earth-observatory/lake-chad/)
- [NASA SVS: deforestation in Rondonia](https://svs.gsfc.nasa.gov/3967)
- [Lake Mead falls to lowest level ever recorded (Aug 2026)](https://www.western-water.com/2026/08/07/lake-mead-falls-to-lowest-level-ever-recorded/)

**Tools and policies**

- [Nominatim (OSM wiki)](https://wiki.openstreetmap.org/wiki/Nominatim)
- [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
- [Ollama: qwen3.5:9b-q4\_K\_M](https://ollama.com/library/qwen3.5:9b-q4_K_M)
- [Leaflet 2.0 release status](https://github.com/Leaflet/Leaflet/issues/9869)
- [Gemini API free tier limits](https://benchlm.ai/free-tier/google-ai-studio)
