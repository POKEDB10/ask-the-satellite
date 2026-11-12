# Ask the Satellite (NOVA 2026, Track D)

Ask a question about a place and a time. The globe flies there and shows real before and after satellite imagery with a swipe. The chat answers with measured change, data quality and sourced context.

Every number comes from the change engine (`backend/change.py`). The local language model only plans the question and words the reply. A number guard rejects any figure the model did not receive.

## Run it (Windows)

First time, with internet:

```bat
setup.bat
```

`setup.bat` creates `.venv` (Python 3.12), installs `requirements.lock.txt`, copies `.env.example` to `.env`, and pulls `qwen2.5:7b-instruct-q4_K_M`. It needs Python 3.12 and Ollama (ollama.com) installed.

Every time, including on stage:

```bat
start_demo.bat
```

It starts Ollama, warms the model, starts the API on http://localhost:8000 and opens Chrome full screen.

- Shortcuts: `C` assistant, `/` question box, `S` swipe, `P` projector mode, `1` Palm 2001 to 2008, `2` UAE flood 2024, `3` Lake Mead, `Esc` closes dialogs.
- The previous Leaflet UI is still at http://localhost:8000/legacy/.
- Stage checklist: laptop on mains power, Windows power plan "Best performance", display scaling 100%, close Slack, Discord and Overwolf. Check `ollama ps` shows `100% GPU`.

### Configuration (`.env`, never committed)

| Key | Meaning |
| --- | --- |
| `ARCGIS_API_KEY` | Optional free ArcGIS developer key for Esri World Imagery. Without it the keyless public service is used. **In the ArcGIS dashboard, restrict the key by HTTP referrer to `http://localhost:8000/*`.** The key reaches the browser through `/api/config`. |
| `LLM_MODEL` | `qwen2.5:7b-instruct-q4_K_M` (chosen by the bake-off below). |
| `LLM_FALLBACK`, `LLM_SMALL` | Left empty on purpose. With the globe open on an 8 GB GPU only one model fits; a second model evicts the first and adds about 10 s to every answer. If the model is missing or slow, the app falls back to the rule router and fixed templates. |
| `GEOCODE_UA` | User-Agent for Nominatim. Its policy wants contact details: set it to `AskTheSatellite-NOVA2026/1.0 (your team email)`. The placeholder `example.com` address is refused with HTTP 403. |

### Refresh the data (internet needed)

```bat
cd backend
..\.venv\Scripts\python precompute.py lake_mead dubai_flood_2024 palm_jebel_ali palm_jumeirah
..\.venv\Scripts\python precompute_frames.py
```

The first command caches the preset analyses. The second caches one frame per year for Palm Jumeirah, used by `/api/compare`.

### Checks

```bat
.venv\Scripts\python tests\contract_test.py
```

Needs the server running. It checks the API contract, the additive routes, and that every number in the cards is in `analysis.stats`.

- `backend\bench_llm.py <model>`: the planner bake-off.
- `tools\shots.js`: headless-Chrome screenshots. Run `npm i playwright-core` next to it first.

## What is measured, and how

- **Indices**: MNDWI for water (threshold 0), NDVI for vegetation (0.3), an MNDWI flood rule, and dNBR for burns. Change is a **class flip** between two dates on one EPSG:3857 grid. Area is corrected by cos²(latitude). Blobs under 5 pixels are dropped and their area is reported.
- **Masks**: Sentinel-2 SCL classes 0, 1, 3, 8, 9 and 10. Landsat QA_PIXEL bits 0–4. Landsat 7 stripe gaps count as no data. A pixel that could not be read is never drawn as "no change": it is grey hatching.
- **Confidence badge**:
  - HIGH: at least 85% valid on both dates.
  - MEDIUM: 60–85% valid, or one downgrade.
  - LOW: under 60% valid, or two downgrades.
  - One downgrade each for a sensor-family change and for a season gap over 45 days.
  - Under 50% valid, the km² headline is hidden.
- **History bank** (`backend/cache/frames/palm_jumeirah/`):
  - 2000-05-19, 2001-05-22 and 2003-05-28 (Landsat 7).
  - 2008-05-17 (Landsat 5).
  - 2018-01-14 and 2024-01-23 (Sentinel-2B, resampled to the same 30 m grid).
  - Dropped: 2002 (only 51.7% valid). 2004, 2005 and 2006 (Planetary Computer has no Landsat 5 scene over Dubai for April–June in those years).
- **Validation**: our Lake Mead water areas are 316.9 km² (14 Aug 2019) and 264.9 km² (7 Sep 2022). The published tutorial benchmark gives 324.1 and 267.1 km² (−2.2% and −0.8%). This is not ground truth.

## LLM bake-off (12 Nov 2026, RTX 4060 Laptop 8 GB, globe open on Palm at the same time)

| Model | Valid JSON | Correct plan (grounded) | Plan p50 / p95 | Interpretation p50 | VRAM | `ollama ps` |
| --- | --- | --- | --- | --- | --- | --- |
| qwen2.5:7b-instruct-q4_K_M | 30/30 | 27/30 | 1.90 / 2.43 s | 1.65 s | 4.6 GB | 100% GPU |
| qwen3.5:9b-q4_K_M | 30/30 | 27/30 | 2.51 / 3.03 s | 1.59 s | 5.5 GB | 100% GPU |
| qwen3.5:4b | 30/30 | 27/30 | 1.34 / 1.51 s | 0.81 s | 3.1 GB | 100% GPU |

The 7B was kept. The 9B is no more accurate, is slower, and leaves the least VRAM headroom beside Chrome. Known gap: a cold 7B load takes longer than the 6 s chat timeout, so the server warms it at start-up and so does `start_demo.bat`.

**No model training was performed.**

## Limits

- Optical imagery only: clouds hide the ground and smoke and haze lower confidence. Radar (Sentinel-1) is the next step.
- Live analysis needs internet and covers Sentinel-2, 2016 to today. Pre-2016 history is the cached Landsat bank and the cached presets.
- The Esri basemap is current, mixed-date imagery. It is context only and never analysed. Its native detail over Dubai ends at zoom level 19. Above that the "Beyond native imagery detail" chip shows.
- Offline: the globe uses the bundled Natural Earth II texture. Presets, frames and chat about cached places work. Esri tiles are never cached or prefetched.
- Curated context is attributive ("reported", "according to") and sourced. Disputed claims are labelled.

## Licences and attribution

See [DATA_SOURCES.md](DATA_SOURCES.md) for every data source and its terms.

- CesiumJS 1.147.0: Apache-2.0 (`web/vendor/cesium/LICENSE.md`). No Cesium ion, no Google or Bing imagery.
- Leaflet 1.9.4 (legacy page): BSD-2-Clause.
- Inter and JetBrains Mono: SIL Open Font License 1.1 (`web/vendor/fonts/`).
- Python packages: see `requirements.lock.txt`. FastAPI and pydantic are MIT; numpy and scipy are BSD; rasterio is BSD-3; pystac-client and odc-stac are Apache-2.0.
- UI inspired by God's Eye View (MIT), https://github.com/bilawalsidhu/gods-eye-view. Inspiration only: no code from it is used or vendored.

## Open organiser questions (research §0b)

These are still unresolved. Confirm them on the day:
- Is the deadline noon Friday or midnight?
- May anything change after submission?
- What must the submission contain?

The plan assumes submission at 11:30 from tag `v1.0-submission`.
