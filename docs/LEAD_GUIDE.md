# Ask the Satellite: the lead's 30-minute guide

You answer the hard questions. This guide is six 5-minute parts. Read each part, then cover it and say the **"Must know"** lines out loud. The self-test at the end tells you if you're ready.

Read [TEAM_GUIDE.md](TEAM_GUIDE.md) first (5 minutes); it gives you the big picture.

---

## Part 1: How a question flows (5 min)

```
Question ─▶ Planner ─▶ Find place ─▶ Pick 2 clear scenes ─▶ Measure change ─▶ AI summary + guard ─▶ Screen
            (rules     (story box     (STAC catalogue)        (change.py)          (narrate.py)
             first)     or geocode)
```

- **Planner** (`agent.py`): simple pattern rules answer first, in 0 ms. The AI is asked only if the rules are unsure. The AI must return strict JSON. A date it gives is thrown away unless that year was in your question.
- **Two modes:** a *change* question gets a measurement; a plain place name gets an *explore* card from Wikipedia.
- **Stories** (Palm, Lake Mead, UAE flood, LA fires…) were measured in advance and saved to disk, so they load instantly and work offline and on the public site. Live measuring of any place works only on the laptop version.
- **Streaming:** the answer arrives in pieces (Server-Sent Events), so the screen fills in step by step.

**Must know:** "Rules plan first, the AI only helps. Numbers come only from the measuring code. Stories are pre-measured."

---

## Part 2: The images (5 min)

| | Landsat 5 / 7 | Sentinel-2 |
| --- | --- | --- |
| Who | NASA / USGS | ESA (Europe) |
| Years we use | before 2016 | 2016 → today |
| Pixel size | 30 m | 10–20 m |
| From | Microsoft Planetary Computer | Element 84 Earth Search |

- We search them through **STAC**, the standard search API for satellite images ("this box, around this date, under X% cloud").
- We use **Level-2 / surface reflectance**: the atmosphere is already corrected, so two dates are comparable.
- **Picking the day:** for up to 6 candidate days we check how much of *our exact box* is cloud-free, not the whole 100 km tile. The clearest day wins; if two days are within 2 points, the one nearer the asked date wins. The "why these scenes?" tooltip shows this.

**Must know:** "Free public satellites, atmosphere-corrected, and we pick the clearest day for *your* area, not the tile."

---

## Part 3: How we measure change (5 min)

Each index compares two colours (bands) of light, giving a value from −1 to +1:

| Use | Index | Formula | Counts as yes when |
| --- | --- | --- | --- |
| Water | MNDWI | (Green − SWIR1) / (Green + SWIR1) | > 0 |
| Plants | NDVI | (NIR − Red) / (NIR + Red) | > 0.3 |
| Flood | MNDWI rule | dry before, wetter after | before < 0, after > −0.05, rise > 0.18 |
| Fire | dNBR | NBR before − NBR after, where NBR = (NIR − SWIR2) / (NIR + SWIR2) | > 0.27 |

**The physics in one line each:**
- **Water** reflects green but absorbs short-wave infrared, so the index is positive over water.
- **Healthy plants** reflect near-infrared strongly.
- **Burned ground** loses that near-infrared and gains short-wave infrared, so NBR drops after a fire.

**Three design choices judges ask about:**
1. **Class flip, not raw difference.** We label each date first (water or not), then count pixels that flipped. Different satellites are calibrated differently, so comparing labels is safer than subtracting brightness.
2. **One shared grid** for both dates (Web Mercator, EPSG:3857). Web Mercator stretches land away from the equator, so each pixel's area is multiplied by **cos²(latitude)** to get true km².
3. **Noise filter:** changed patches smaller than 5 pixels are dropped, and the dropped area is shown on screen, never hidden.

**Must know:** "We classify each date, then count flips, on one grid, corrected for latitude."

---

## Part 4: Trust: clouds, confidence, checking (5 min)

**Clouds:** each satellite ships a per-pixel quality layer (Sentinel-2 *SCL*, Landsat *QA_PIXEL*). Cloud, shadow, cirrus and no-data pixels are masked, drawn as grey hatching, and **never counted as "no change"**. Landsat 7's stripe gaps (a 2003 hardware fault) are masked too.

**Confidence badge:**
- **High:** ≥ 85% of the area clear on both dates.
- **Medium:** 60–85% clear, or one downgrade.
- **Low:** < 60% clear, or two downgrades.
- **Downgrades:** different satellite families, and a season gap of more than 45 days.
- **Under 50% clear:** the km² headline is hidden altogether.

> Palm is **Medium** even though it is 100% clear, because 2001 is Landsat 7 and 2008 is Landsat 5. That's a good example to give.

**It is not a statistical confidence interval.** It is a data-quality badge. Say this plainly if asked.

**Validation:**

| Case | Ours | Reference | Gap |
| --- | --- | --- | --- |
| Lake Mead water, 2019 / 2022 | 317 / 265 km² | 324 / 267 km² (published benchmark) | −2.2% / −0.8% |
| LA Palisades fire | 93.4 km² burn scar | ≈ 95 km² (CAL FIRE, 23,448 acres) | ≈ −2% |
| LA Eaton fire | 33.7 km² | ≈ 57 km² (CAL FIRE) | lower: urban burn |

**Reproducible:** the Verify panel lists the exact scene IDs, the formula and the mask, so anyone can download the same scenes.

**Must know:** "Clouds are masked, not guessed. Confidence is a quality badge. We're within about 2% on Lake Mead and the Palisades fire."

---

## Part 5: The AI and its guard (5 min)

- **Model:** Qwen 2.5, 7B parameters, 4-bit, running **locally** on the laptop GPU through Ollama. There is no cloud AI and no training (we use it as is). It won our bake-off on plan accuracy and speed on an 8 GB GPU.
- **It does two jobs only:** planning the question, and writing a 2–3 sentence summary.
- **The guard** (`narrate.py`) checks each sentence before it is shown and **deletes** it if:
  - it contains a **number** that is not in the measured facts;
  - it contains a **capitalised name** (place, source) that is not in the facts;
  - it makes a forbidden causal claim ("caused by", "proves", "due to"…).
- **Without the AI** (as on the public site), the app still answers: rule-based planning, template cards, and summaries recorded earlier that passed the same guard.
- **Arabic** questions get the hand-written Arabic cards but no AI summary, because the name check can't read Arabic script.

**Must know:** "The AI can't add a number or a name that we didn't measure or source; the sentence gets deleted."

---

## Part 6: Hard questions and weak spots (5 min)

Be honest; judges respect it. Each answer below is a short version you can say.

**"Thresholds are fixed. Isn't that crude?"**
Yes. They're standard published values (MNDWI 0, NDVI 0.3, dNBR 0.27). They work well for clear-cut change like reclamation, drought, floods and fires. Next step: test how the result changes when the threshold moves, and show that as an uncertainty range.

**"Is this ground truth?"**
No. We compare against published benchmarks and official figures, not field surveys.

**"Why is Eaton so far below the official number?"**
Much of Eaton burned houses in Altadena's streets and gardens. Burned houses change the infrared signal less than burned brush, and official figures are perimeters that include unburned patches. We report what the satellite can see.

**"Clouds during floods?"**
That's the real limit of optical satellites. Radar (Sentinel-1) sees through cloud, and it's our next step.

**"Can the guard be fooled?"**
It's a strong filter, not a proof. It works on text matching, so a name hidden inside a longer phrase can slip through. For example, "National" is allowed because "Jasper National Park" is in the facts. That's why we keep the AI's job small, and the numbers never come from it.

**"Why not measure from the Esri / Google-style basemap?"**
It's a mosaic of unknown dates with no calibrated bands. We use it only for orientation, and the screen says so.

**"Why a local AI?"**
It's free, private, and works offline. A 7B model is enough because it only plans and summarises.

**"How does it scale?"**
Stories are served from cache. Identical questions share one AI call. Live jobs run one at a time in a queue, and visitors are rate-limited. A load test with 3,000 simulated visitors (21,000 requests) had 0 errors.

**"Licences?"**
- Landsat: public domain.
- Sentinel-2: free with attribution.
- Esri basemap: attribution, never cached.
- Wikipedia: CC BY-SA.
- See `DATA_SOURCES.md`.

**"What next?"**
Radar for cloudy places, time series instead of two dates, building change, and uncertainty ranges.

---

## Self-test (answer out loud, then check)

1. Where do the numbers come from, and where don't they come from?
2. Name the two satellites, their years and pixel sizes.
3. Why do we compare labels instead of subtracting images?
4. Why multiply area by cos²(latitude)?
5. What makes a result High, Medium or Low? Why is Palm Medium?
6. What exactly does the AI guard delete?
7. Give our two validation numbers.
8. Why is the Eaton fire measurement lower than the official figure?
9. Name two honest weaknesses and the fix for each.

If you can answer all nine without looking, you're ready.

---

**Code map, if someone asks "where is that in the code?"**

| What | File |
| --- | --- |
| Measuring | `backend/change.py` |
| Picking scenes | `backend/stac_fetch.py` |
| Planner and number check | `backend/agent.py` |
| AI summary guard | `backend/narrate.py` |
| Chat stream | `backend/extras.py` |
| Stories | `backend/presets.py`, `backend/presets.json` |
| Globe | `web/globe.js` |
| Interface | `web/app.js` |
