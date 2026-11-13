# Ask the Satellite: team study guide

Read this before the demo and the judges' Q&A. It explains what the project does, how each part works, and why we built it this way. Every claim here matches the code; file paths point to where the code lives.

---

## 1. The one-minute version

**What it is.** A 3D globe like Google Earth, with an assistant beside it. Type a place and the globe flies there and tells you about it. Ask how a place changed ("Did Lake Mead shrink?", "Palisades fire 2025") and it measures the change from real Landsat or Sentinel-2 satellite images, then shows a before/after swipe and a number in km².

**What makes it different.** Most "AI + maps" demos let a language model make up the answer. Here the model never produces a number:

- **Numbers come from the change engine** (`backend/change.py`): pixel maths on real satellite scenes.
- **The language model only does two jobs:** it works out what you asked (planning) and writes a short summary (narration).
- **A guard checks every sentence the model writes.** It is deleted unless every number and every proper name in it already appears in the facts the model was given.
- **Every number shows its evidence:** the scene dates, the satellite, how much of the area was cloud-free, and a confidence level.

**The pitch in one sentence.** "Ask the Satellite measures how any place on Earth changed, from real satellite images, and shows its evidence for every number. The AI explains the result but is never allowed to invent it."

---

## 2. What a user sees

| Area | What it does |
| --- | --- |
| **Globe** (left) | CesiumJS 3D globe. NASA Blue Marble and clouds from orbit; Esri World Imagery when zoomed in. Live Earth-observation satellites can be switched on. |
| **Search bar** (top) | Type-ahead place search. Pick a result and the globe flies there. |
| **Stories** (top) | Pre-measured case studies: Palm Jumeirah, Lake Mead, UAE flood 2024, Aral Sea, Palm Jebel Ali, and the Los Angeles fires of January 2025 (Palisades and Eaton). |
| **Before / After, Before / Today** | Switches the swipe between two measured scenes, or one measured scene against today's basemap. |
| **Verify** | Opens the "Verify the science" panel: scene IDs, acquisition times, reflectance formula, cloud mask, thresholds, confidence rules. |
| **Assistant** (right) | Selector bar (region, index, two dates, Run), then the conversation and the reports. |

### Two kinds of answer

1. **Explore** ("Kyoto", "Burj Khalifa"). A place card from Wikipedia, a few nearby places, and a short brief written by the model from the Wikipedia text only.
2. **Measure a change** ("Palm Jumeirah 2001 to 2008"). The report, in this order:
   1. The headline number, for example **−8.59 km² net water area**, with the confidence level.
   2. The dates, satellites and grid, and the share of the area that was clear on both dates.
   3. A before/after swipe and Before, After and Change thumbnails (click one for full size).
   4. "What this shows": at most three sentences of narration, all checked by the guard.
   5. "Background": sourced context such as what happened and the reported impacts, with numbered citations. It is marked "not from the satellite".
   6. "Look next": one-click follow-up comparisons.

---

## 3. How a question flows through the system

```
Browser (web/app.js)                    Server (FastAPI, backend/)
---------------------                   --------------------------
User types a question  ──POST /api/chat/stream──▶  extras._stream()
                                                    │
                                                    ├─ agent.plan(): rule router first (0 ms);
                                                    │   the LLM only when the rules are unsure
                                                    ├─ where is it? story bbox, or geocode (place.py, geocode.py)
◀── event: plan (fly_to bbox) ──────────────────────┤
globe.js flies there                                │
                                                    ├─ EXPLORE: Wikipedia (place.py) ──▶ event: place
                                                    │
                                                    └─ CHANGE:
                                                        ├─ story? cached result on disk (cache/presets/)
                                                        ├─ else live: stac_fetch.pick_scene() ×2
                                                        │          then change.run()
◀── event: analysis (stats + PNG layers) ───────────────┤
globe.js drapes the PNGs, swipe appears                 │
                                                        ├─ narrate.stream(): model writes; guard
◀── event: say (one checked sentence at a time) ────────┤  drops any sentence that fails
◀── event: cards (measured text, quality, sources) ─────┤
◀── event: done ────────────────────────────────────────┘
```

The answer streams as **Server-Sent Events**, so the user sees progress ("Picking scenes", "Change measured") and the sentences appear one at a time.

---

## 4. The science (what judges ask about most)

### 4.1 Where the images come from

| Satellite | Years | Pixel size | Where we get it |
| --- | --- | --- | --- |
| Landsat 5, 7 (USGS, Collection 2 Level-2) | before 2016 | 30 m | Microsoft Planetary Computer (STAC catalogue) |
| Sentinel-2 A/B/C (ESA, Level-2A) | 2016 to today | 10–20 m | Element 84 Earth Search (STAC); Planetary Computer as backup |

- **STAC** (SpatioTemporal Asset Catalog) is the standard search API for satellite scenes. We ask "scenes over this box, around this date, under X% cloud".
- **Level-2** means surface reflectance: the atmosphere has already been corrected, so the numbers are comparable between dates.
- The code converts raw pixel values to reflectance with each sensor's official scale and offset (Landsat `DN × 0.0000275 − 0.2`; Sentinel-2 `DN × 0.0001`, with a −0.1 offset for processing baseline 04.00 and later).

### 4.2 Picking the best day (`stac_fetch.pick_scene`)

1. Search a window around the target date (for example ±30 days).
2. For up to 6 candidate days, read a cheap 60 m cloud mask and compute **what share of *our* box is clear**. Tile-wide cloud percentages lie: a tile can be 5% cloudy with all of it over your city.
3. The clearest day wins. If two days are within 2 points, the one nearer the target date wins.
4. The "why these scenes?" link in the report shows every candidate and its clear percentage.

### 4.3 Measuring change (`change.py`)

We compute a **spectral index** per pixel. Each index is a normalised difference of two bands, so it runs from −1 to +1:

| Index | Formula | Measures | Rule |
| --- | --- | --- | --- |
| **MNDWI** | (green − SWIR1) / (green + SWIR1) | open water | water if > 0 |
| **NDWI** | (green − NIR) / (green + NIR) | surface water | water if > 0 |
| **NDVI** | (NIR − red) / (NIR + red) | vegetation | vegetated if > 0.3 |
| **Flood rule** | MNDWI on both dates | new flooding | was < 0, now > −0.05, and rose by more than 0.18 |
| **dNBR** | NBR = (NIR − SWIR2) / (NIR + SWIR2); dNBR = NBR before − NBR after | burn scars | burned if dNBR > 0.27 |

**Why water shows up in MNDWI:** water reflects green light but absorbs short-wave infrared almost completely, so green − SWIR is positive over water and negative over land.

**Why burns show up in dNBR:** healthy plants reflect strongly in near-infrared; burned ground reflects more in SWIR2. After a fire NBR drops sharply, so before − after is large. 0.27 is where "moderate-low" severity starts in the standard dNBR classes (Key and Benson, USGS FIREMON); 0.10 to 0.27 is "low severity", which we leave out to avoid counting dry grass and shadows.

**Class flip, not raw difference.** For water and vegetation we classify each date separately (water / not water), then report pixels that *flipped*. We never subtract raw reflectance across sensors, because Landsat 7 and Landsat 5 are calibrated differently; comparing classes is robust to that.

**Area.** Both dates are loaded onto one shared grid (EPSG:3857, Web Mercator). Web Mercator stretches pixels away from the equator, so each pixel's area is corrected by cos²(latitude).

**Noise filter.** Changed blobs smaller than 5 pixels are dropped (minimum mapping unit). The dropped area is reported, never hidden.

### 4.4 Clouds and bad pixels

- **Sentinel-2** uses its scene classification layer (SCL): classes 0, 1, 3, 8, 9 and 10 are masked (no data, saturated, cloud shadow, medium and high cloud, cirrus).
- **Landsat** uses QA_PIXEL bits 0–4 (fill, dilated cloud, cirrus, cloud, shadow).
- **Landsat 7 after May 2003** has diagonal stripe gaps (a hardware failure, the "SLC-off" problem). Those count as no data.
- Masked pixels are drawn as grey hatching and are **never counted as "no change"**.

### 4.5 Confidence badge (`change.confidence`)

- **High:** at least 85% of the area clear on both dates.
- **Medium:** 60–85% clear, or one downgrade.
- **Low:** under 60% clear, or two downgrades.
- **Downgrades:** different satellite families (for example Landsat 7 vs Landsat 5), and a season gap over 45 days. Seasons change water levels and vegetation, which could look like change.
- **Under 50% clear,** the km² headline is hidden altogether.

It is a **data-quality badge, not a statistical confidence interval**. Say this plainly if asked.

### 4.6 How do we know the numbers are right?

- **Lake Mead check:** we measured 316.9 km² of water in Aug 2019 and 264.9 km² in Sep 2022. The published benchmark is 324.1 and 267.1 km² (−2.2% and −0.8%). That is agreement with a published reference, not ground truth.
- The Palm Jumeirah reclamation shows up as roughly 8.6 km² of water becoming land between 2001 and 2008, which matches the island's visible footprint.
- Everything is reproducible: the Verify panel lists the exact STAC item IDs, so anyone can download the same scenes.

---

## 5. The AI part, and how we keep it honest

**Model:** Qwen 2.5 7B (4-bit), run locally through Ollama on the laptop GPU. No cloud AI and no data leaves the machine. The README has a bake-off table showing why this model was picked.

**Job 1: planning** (`agent.plan`). Turn "how did the Palm change since 2001?" into a structured plan: intent, place, index and dates.
- A **rule router** (regular expressions) answers first, in 0 ms. The model is asked only when the rules are unsure.
- The model must return JSON that matches a schema.
- Its answer is then **grounded**: a date it gives is dropped unless that year appears in the question, and a story ID is dropped unless it exists.

**Job 2: narration** (`narrate.py`). Writes up to three sentences from a facts block (the measurement plus the named sources). Each sentence streams through a guard and is **dropped** if:
- it contains a number not in the facts (`agent.numbers_ok`);
- it contains a capitalised name not in the facts (`_names_ok`), so the model cannot add places or sources;
- it makes a banned causal claim (`agent.BAD`), or credits a measured number to a news source.

**Without a model** (as on the public Render site), the answer still works: rule-based planning, hand-written measured and quality cards, and narrations recorded earlier from the local model (`backend/cache/narration.json`), which passed the same guard.

**Arabic** questions get hand-written Arabic cards but no AI narration, because the name guard cannot check Arabic script.

**No model training was done.** We use a pre-trained model as is.

---

## 6. The globe (`web/globe.js`)

- **CesiumJS 1.147**, vendored, so it works offline.
- **Imagery stack**, bottom to top: Natural Earth II (offline floor), Esri World Imagery (detailed, current), NASA Blue Marble and clouds (orbit look, faded out as you zoom in), our measured overlays, optional labels.
- **The basemap is context only.** Esri imagery has mixed, unknown dates, so we never measure from it. Only Landsat and Sentinel-2 are analysed.
- **Flights** zoom out to orbit, turn the globe, then zoom in, like Google Earth.
- **The chat covers the right of the screen.** At orbit the camera is turned a few degrees so the Earth sits centred in the part you can see. That turn depends only on altitude and is always removed before the code reads the camera's heading, so zoom and flights keep north up. After any movement at orbit height the view settles back to straight down, north up and centred.
- **Measured layers** are PNGs draped on the globe. The swipe uses Cesium's split-screen feature: before on the left, after and change on the right.
- **Live satellites:** orbit elements from CelesTrak, positions computed in the browser with satellite.js (SGP4).

---

## 7. Stories (pre-computed case studies)

Stories are measured once with `backend/precompute.py` and saved to `backend/cache/presets/<id>/` (four PNGs plus `result.json`). They load instantly and work offline and on Render. Curated, sourced context for each story lives in `backend/presets.json`; every line has its link.

| Story | Index | Dates | What it shows |
| --- | --- | --- | --- |
| Palm Jumeirah | MNDWI (also NDVI and NDWI frames) | 2000, 2001, 2003, 2008, 2018, 2024 | Sea turned to land; the year selector compares any two years |
| Lake Mead | MNDWI | Aug 2019 → Sep 2022 | Reservoir shrinking in drought |
| UAE flood | Flood rule | 7 Apr → 21 Apr 2024 | Flooding after the record 16 April 2024 rain |
| Aral Sea | MNDWI | 2000 → 2014 | East basin drying out |
| Palm Jebel Ali | MNDWI | 2001 → 2008 | Second palm island, construction stopped in 2009 |
| **Palisades fire, LA 2025** | dNBR | late Dec 2024 → late Jan 2025 | Burn scar over Pacific Palisades |
| **Eaton fire, Altadena 2025** | dNBR | late Dec 2024 → late Jan 2025 | Burn scar over Altadena |

The LA fires (CBS News, 31 Jan 2025): both started on 7 January 2025 in a Santa Ana wind storm with gusts near 100 mph. Together they burned 37,469 acres (about 152 km²) and killed 29 people. The Palisades fire destroyed 6,837 structures and the Eaton fire 9,418 buildings. Our dNBR figure measures the burn scar we can see from orbit, so it will not equal the official fire perimeter exactly. Unburned pockets inside the perimeter, smoke and our 20 m pixels all make a difference.

**Adding a story:** add an entry to `PRESETS` in `backend/presets.py`, optionally add sourced context in `backend/presets.json`, run `python precompute.py <id>` from `backend/` with internet, then commit `backend/cache/presets/<id>/`.

---

## 8. Running and deploying

- **Local:** `setup.bat` once, then `start_demo.bat`. That starts Ollama, warms the model, starts the API on http://localhost:8000 and narrates the stories once so they replay instantly.
- **Public:** Render, from `render.yaml` and the `Dockerfile`, on the free plan. There is no model and live measuring is off (`ALLOW_LIVE=0`); stories, search, the place guide and satellites all work. The free plan sleeps after 15 minutes idle, so the first visit takes about a minute.
- **Built for a crowd:** stories are served from disk and memory caches. Identical questions share one model call. Live raster jobs run one at a time with a short queue. Visitors are rate-limited. Load test: 21,000 requests in 36.8 s with 0 errors (`tests/load_test.py`).

---

## 9. File map

| File | What is in it |
| --- | --- |
| `backend/main.py` | FastAPI app, `analyze()` orchestrator, preset and analysis routes |
| `backend/extras.py` | Streaming chat (`_stream`), frame bank comparisons, search, place, satellites, warm-up |
| `backend/agent.py` | Rule router, LLM planner, number guard, measured and quality cards |
| `backend/narrate.py` | Streamed narration and the sentence guard; recorded narrations |
| `backend/change.py` | Indices, cloud masks, change maps, area, confidence |
| `backend/stac_fetch.py` | STAC search, best-day picking, band loading, reflectance scaling |
| `backend/place.py`, `geocode.py` | Wikipedia place cards, search, geocoding with caches |
| `backend/ops.py` | Rate limits, caches, concurrency gates |
| `backend/presets.py`, `presets.json` | Story definitions and their curated, sourced context |
| `web/globe.js` | Cesium globe, camera, flights, overlays, swipe, satellites |
| `web/app.js` | Search, chat, report rendering, Verify panel, stories, shortcuts |
| `web/style.css`, `index.html` | Layout and look |
| `tests/` | Contract test, load test, offline self-checks |

---

## 10. Likely questions, with answers

**Q: Isn't this just ChatGPT on a map?**
No. The model never computes or states a number of its own. Every number comes from pixel maths on real satellite scenes, and the model's sentences are deleted unless every number and name in them is in the measured facts. Without any model the app still answers, from rules and templates.

**Q: How do you stop the AI hallucinating?**
Three layers. (1) Planning output must match a JSON schema and is grounded: invented dates and story IDs are thrown away. (2) The narration guard drops any sentence with a number or proper name that is not in the facts. (3) Science is never delegated to the model: change.py does all measurement.

**Q: How accurate is it?**
On Lake Mead we are within 2.2% and 0.8% of a published benchmark for the two dates. Accuracy is limited by pixel size (10–30 m), clouds and the index thresholds. That is why every result shows how much of the area was clear and a confidence level, and hides the headline when under 50% is clear.

**Q: What about clouds?**
We pick the clearest day for *your* box, not the tile, mask cloud and shadow pixels, and show masked areas as grey hatching. Optical satellites cannot see through clouds; radar (Sentinel-1) is the next step.

**Q: Why not just subtract the two images?**
Different satellites, sun angles and seasons change raw brightness. Classifying each date first (water or not), then comparing classes, is far more robust, especially across Landsat 5, 7 and Sentinel-2.

**Q: Why EPSG:3857 and cos²(latitude)?**
Both dates must sit on exactly the same pixel grid to compare pixel by pixel, and 3857 matches the web globe. Web Mercator enlarges areas away from the equator by 1/cos²(latitude), so we multiply each pixel's area by cos²(latitude) to get true km².

**Q: What is the confidence level, statistically?**
It is a data-quality badge built from clear-pixel share, sensor mismatch and season gap. It is not a statistical interval, and we say so in the Verify panel.

**Q: Why is the Esri imagery not analysed?**
It is a mosaic of different, unknown dates and has no calibrated reflectance bands. It is for orientation only. We label it "context only" on screen.

**Q: Why a local model?**
Privacy, cost and offline use: it runs on a laptop GPU with no API fees and keeps working without internet. Qwen 2.5 7B won our bake-off on plan accuracy and speed with the globe open on an 8 GB GPU.

**Q: Does it work offline?**
The globe (Blue Marble and Natural Earth), all stories, frame comparisons and recorded narrations work offline. Place search, Esri tiles and live measuring need internet.

**Q: Can I measure anywhere?**
Locally, yes: any place, Sentinel-2, from 2016 to today, about a 33 km window. On the public Render demo live measuring is off to keep it free and fast, so only stories are measured there.

**Q: Do your LA fire numbers match the official ones?**
Palisades: we measure **93.4 km²** of burn scar; CAL FIRE's perimeter is 23,448 acres, about 95 km². That is very close. Eaton: we measure **33.7 km²**, against a perimeter of about 14,021 acres (57 km²). The gap is expected: much of the Eaton fire burned houses in Altadena's streets and gardens, which do not change NBR as strongly as burned forest or chaparral, and we count only dNBR > 0.27 at 20 m pixels. Official figures are perimeters, which include lightly burned and unburned patches. (CBS News gives the combined 37,469 acres; the per-fire acreages are CAL FIRE's.)

**Q: How does it scale?**
Stories come from cache; identical questions share one model call; live jobs are queued one at a time; per-visitor rate limits apply. The load test handled 3,000 simulated visitors (21,000 requests) with 0 errors.

**Q: What would you build next?**
Sentinel-1 radar to see through clouds (floods happen under clouds); building-footprint change; time series instead of two dates; and an uncertainty estimate from threshold sensitivity.

**Q: Data licences?**
Landsat is public domain (USGS). Sentinel-2 is free and open with attribution ("Contains modified Copernicus Sentinel data"). Esri requires attribution and is never cached. Wikipedia text is CC BY-SA. Full table: `DATA_SOURCES.md`.

---

## 11. Glossary

- **STAC:** standard API for searching satellite scenes by place, time and cloud cover.
- **Surface reflectance (Level-2):** pixel values corrected for the atmosphere, as a fraction of light reflected (0–1).
- **Band:** one slice of the light spectrum the satellite records (red, green, NIR, SWIR1, SWIR2…).
- **NIR / SWIR:** near-infrared / short-wave infrared, invisible to the eye. Plants are bright in NIR; water is dark in SWIR.
- **SCL / QA_PIXEL:** per-pixel quality layers from ESA and USGS that say "cloud", "shadow", "no data" and so on.
- **SLC-off:** the Landsat 7 hardware fault (2003) that leaves stripe gaps.
- **Minimum mapping unit:** smallest blob we count as change (5 pixels).
- **SSE:** Server-Sent Events, a one-way stream from server to browser, used for the streamed answer.
- **Ollama:** program that runs language models locally.
- **CesiumJS:** open-source 3D globe library.

---

## 12. Demo script (about 3 minutes)

1. **Orbit view.** "This is a live 3D globe. Real Landsat and Sentinel-2 data sits behind every number."
2. **Press 1** (Palm 2001 to 2008). The globe flies to Dubai and the swipe appears. Drag it. Read the headline (about −8.6 km² of water became land) and point at the confidence level and the clear percentage.
3. **Click Verify.** "Here are the exact scene IDs, the formula and the cloud mask. Anyone can reproduce this."
4. **Press 4** (Palisades fire). "Same engine, different index: dNBR finds the burn scar from January 2025."
5. **Type "Kyoto".** Explore mode: a place card and a short brief, held to Wikipedia's facts.
6. **Close:** "The AI explains, the satellite measures, and every number shows its evidence."
