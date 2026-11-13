# Ask the Satellite (NOVA 2026, Track D)

A Google-Earth-style globe with an evidence assistant.

- **Name a place** and the globe zooms out to orbit, turns, and zooms in. The assistant shows a place card from Wikipedia with nearby highlights, and a short guide written by a local model.
- **Ask how a place changed** ("compare Palm Jumeirah 2000 and 2001") and you get real Landsat or Sentinel-2 imagery with a before/after swipe. The answer gives the measured change, a confidence level, a narrated story and sourced context, including the reported downsides.

Every measured number comes from the change engine (`backend/change.py`). The local model only plans the question and narrates. A sentence it writes is shown only if all its numbers and proper names appear in the facts it was given.

New to the project? Read the team study guide first: [docs/STUDY_GUIDE.md](docs/STUDY_GUIDE.md). Presenting? Use [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

## Run it (Windows)

First time, with internet:

```bat
setup.bat
```

`setup.bat` creates `.venv` (Python 3.12), installs `requirements.lock.txt`, copies `.env.example` to `.env`, and pulls `qwen2.5:7b-instruct-q4_K_M`. It needs Python 3.12 and Ollama (ollama.com).

Every time, including on stage:

```bat
start_demo.bat
```

It starts Ollama, warms the model, starts the API on http://localhost:8000 and opens Chrome full screen. At startup the server also narrates the pitch stories once, so they replay instantly.

- **Shortcuts:** `Ctrl K` search, `/` ask, `C` assistant, `S` swipe, `T` tilt, `O` back to orbit, `P` projector, `1` Palm 2001 to 2008, `2` UAE flood 2024, `3` Lake Mead, `4` Palisades fire 2025, `Esc` close.
- **Globe:** the bottom-right controls are live satellites, tilt, north-up, zoom and back to orbit. The globe spins on its own after 20 s idle at orbit; turn that off under Layers.
- **Legacy:** the original Leaflet UI is at `/legacy/`.
- **Stage checklist:** mains power, Windows power plan "Best performance", display scaling 100%, close Slack, Discord and Overwolf, and check `ollama ps` shows `100% GPU`.

### Configuration (`.env`, never committed)

| Key | Meaning |
| --- | --- |
| `ARCGIS_API_KEY` | Optional free ArcGIS developer key for Esri World Imagery. Without it the keyless service is used. Restrict the key by HTTP referrer (`http://localhost:8000/*`, plus your public URL). |
| `LLM_MODEL` | `qwen2.5:7b-instruct-q4_K_M` (bake-off below). Empty means no model: rules, templates and recorded narrations only. |
| `LLM_FALLBACK`, `LLM_SMALL` | Left empty on purpose. On an 8 GB GPU with the globe open, a second model evicts the first and adds about 10 s per answer. |
| `GEOCODE_UA` | Nominatim User-Agent. Put a team contact email in it; the `example.com` placeholder gets HTTP 403. |
| `ALLOW_LIVE` | `0` turns off live Sentinel-2 measuring (public demo host). Default `1`. |
| `TRUST_PROXY` | `1` behind exactly one reverse proxy (Render). Visitor IPs for rate limits are then read from the proxy's own `X-Forwarded-For` hop. |
| `PREWARM`, `THREADS`, `LIVE_CONCURRENCY`, `LIVE_TIMEOUT` | Start-up narration warm-up (default on), thread-pool size (400), parallel live jobs (1), live time-out in seconds (150). |

## Put it online (Render, free plan, pre-computed data, no model)

The repository includes a `Dockerfile` and a Render Blueprint (`render.yaml`). The public image runs:
- with no language model; the pitch stories play back their recorded, guarded narrations;
- with live measuring off;
- with the place guide, search, satellites and all stories working.

1. Render dashboard: New, then Blueprint, then pick this GitHub repository, then Apply.
2. Optional: add `ARCGIS_API_KEY`, and restrict it in the ArcGIS dashboard to the `onrender.com` URL.
3. The free plan sleeps after 15 minutes idle; the first visit after that takes about a minute.

## Built for a burst of visitors

- **Stories cost almost nothing.** Pre-computed analyses, frame comparisons and narrations are served from disk and memory: a shared narration file, an in-memory cache for PNG and JSON with ETag/304, and Cache-Control on static assets.
- **No duplicate work.** Many people asking the same thing at once trigger one model call, one Wikipedia lookup and one geocode; the rest wait for it and replay.
- **Expensive paths are gated.** One live raster job at a time (queue of 3, then a friendly "busy" card). One model call at a time; if the model is busy for more than 2.5 s, the answer goes out without the story. A 400-thread pool means streaming answers never starve static files.
- **Small-container RAM guard.** On Render, or with no model, the in-memory file cache holds at most 24 MB and skips files over 1.5 MB. The 4–6 MB story PNGs stream from disk and browsers cache them.
- **Per-visitor rate limits.** Chat 20 burst then 40 a minute; search 30 burst then 4 a second. These answer with a friendly card or HTTP 429, never a stack trace. Limits are per worker process.
- **Measured** (`tests/load_test.py`, this laptop, 4 workers, 3,000 visitors arriving 160 at a time, 7 requests each including a full streamed story answer):
  - 21,000 requests in 36.8 s (571 requests/s), **0 errors**.
  - Story answer complete: p50 136 ms, p95 253 ms.
  - Page: p95 247 ms.
  - Config: p95 196 ms.
  - Image layers: p50 122 ms. The p95 of 2.4 s is the 4 MB Lake Mead images.

## What is measured, and how

- **Indices:** MNDWI for water (threshold 0), NDWI (McFeeters, green vs NIR, threshold 0; frame bank only), NDVI for vegetation (0.3), an MNDWI flood rule, and dNBR for burns. Change is a class flip between two dates on one EPSG:3857 grid. Area is corrected by cos²(latitude). Blobs under 5 pixels are dropped and reported.
- **Masks:** Sentinel-2 SCL 0, 1, 3, 8, 9, 10 and Landsat QA_PIXEL bits 0–4. Landsat 7 stripe gaps count as no data. Unreadable pixels are grey hatching, never "no change".
- **Confidence:**
  - HIGH: at least 85% valid on both dates.
  - MEDIUM: 60–85%, or one downgrade.
  - LOW: under 60%, or two downgrades.
  - One downgrade each for a sensor-family change and for a season gap over 45 days.
  - Under 50% valid, the km² headline is hidden.
- **Palm history bank:**
  - 2000, 2001 and 2003 (Landsat 7); 2008 (Landsat 5); Jan 2018 and Jan 2024 (Sentinel-2B, on the same 30 m grid).
  - Dropped: 2002 (51.7% valid), and 2004–2006 (no Landsat 5 scene for April–June in Planetary Computer).
- **Los Angeles fires, January 2025 (dNBR, Sentinel-2, 2 Jan → 1 Feb 2025):** Palisades 93.4 km² of burn scar against a CAL FIRE perimeter of about 95 km²; Eaton 33.7 km² against about 57 km² (much of Eaton burned homes in Altadena, which shift NBR less than burned chaparral). Both HIGH confidence.
- **Validation:** Lake Mead water 316.9 and 264.9 km² against the published benchmark's 324.1 and 267.1 km² (−2.2% and −0.8%). This is not ground truth.

## The assistant

- **Date and index selector bar** (top of the assistant): Region, Date 1 (before), Date 2 (after), Index (MNDWI, NDVI, NDWI).
  - Changing any of them runs the comparison, flies the globe and redraws the report.
  - Any analysis opened by chat, story or chip updates the selectors.
  - Palm Jumeirah offers every year in its frame bank (2000, 2001, 2003, 2008, Jan 2018, Jan 2024). The single-pair stories (Lake Mead, UAE flood, Palm Jebel Ali, Aral Sea) show their fixed dates and index.
- **Report order:**
  1. Telemetry banner: net km² and %, dates, sensors, grid, confidence, valid pixels.
  2. Before/after swipe and Before/After/Change thumbnails.
  3. Field summary: at most 3 sentences and 65 words.
  4. Named sources, with [n] citations and "Disputed by developer" tags.
  5. Next comparisons.
- **Explore mode is an Earth observation brief** (terrain, urban footprint, coastline, water). Geographic features come first; restaurants, hotels and retail are filtered out. Every place card ends with one-click comparison chips.
- **Arabic questions** get the hand-written Arabic measured and quality cards, but no AI narration: the names guard cannot check Arabic script.
- **Two modes, chosen by rules.** A change question (years, compare, before/after, flood, shrink, and the like) gets a measurement. Anything else that names a place gets the explore card.
- **Planner.** The rule router answers first (0 ms). The model refines the plan only when the rules are unsure, and it may not:
  - tie a different place to a story;
  - re-explain the previous map (only the rules can choose that);
  - overrule a place the rules found.
- **Narration guard** (`backend/narrate.py`). Text streams sentence by sentence. A sentence is dropped unless every number and every capitalised name in it appears in the facts the model was given (the measurement and the named sources, or Wikipedia). Claims about the measurement may not be credited to a news source.
- **Search.** Type-ahead from GeoNames (Open-Meteo geocoding API), with Photon as backup and the stories first. Picking a result flies there and opens its place card.

## LLM bake-off (12 Nov 2026, RTX 4060 Laptop 8 GB, globe open)

| Model | Valid JSON | Correct plan | Plan p50 / p95 | Interpretation p50 | VRAM | `ollama ps` |
| --- | --- | --- | --- | --- | --- | --- |
| qwen2.5:7b-instruct-q4_K_M | 30/30 | 27/30 | 1.90 / 2.43 s | 1.65 s | 4.6 GB | 100% GPU |
| qwen3.5:9b-q4_K_M | 30/30 | 27/30 | 2.51 / 3.03 s | 1.59 s | 5.5 GB | 100% GPU |
| qwen3.5:4b | 30/30 | 27/30 | 1.34 / 1.51 s | 0.81 s | 3.1 GB | 100% GPU |

**No model training was performed.**

## Limits

- Optical imagery only: clouds hide the ground. Radar (Sentinel-1) is the next step.
- Live analysis needs internet and covers Sentinel-2, 2016 to today. Pre-2016 history is the cached Landsat bank and the stories.
- Esri imagery is current and mixed-date: context only, never analysed. Deeper zoom levels (up to 23) load only where Esri's tilemap reports imagery; elsewhere the "Beyond native imagery detail" chip shows.
- Place notes and guides come from Wikipedia and can be incomplete. The guide's model is held to Wikipedia's facts, not to the truth of the world.
- Offline: NASA Blue Marble and Natural Earth globe, stories, frames and recorded narrations. No place search, no Esri tiles; Esri tiles are never cached.

## Licences and attribution

See [DATA_SOURCES.md](DATA_SOURCES.md).

- CesiumJS 1.147.0: Apache-2.0.
- satellite.js 7.2.0: MIT (`web/vendor/satellite/LICENSE.md`).
- Leaflet 1.9.4 (legacy page): BSD-2-Clause.
- IBM Plex Sans, Mono and Sans Arabic: SIL Open Font License 1.1 (`web/vendor/fonts/`).
- NASA Blue Marble textures: public domain, credit NASA Earth Observatory.
- Python packages: see `requirements.lock.txt`. FastAPI and pydantic are MIT; numpy and scipy are BSD; rasterio is BSD-3; pystac-client and odc-stac are Apache-2.0.
- UI inspired by God's Eye View (MIT), https://github.com/bilawalsidhu/gods-eye-view. Inspiration only: no code from it is used.

## Open organiser questions (research §0b)

Still unresolved; confirm them on the day:
- Is the deadline noon or midnight?
- May anything change after submission?
- What must the submission contain?

Tags: `v1.0-submission` (first freeze), `v1.1`, `v1.2` (this version). Offline self-checks: `.venv\Scripts\python tests\test_v12.py`.
