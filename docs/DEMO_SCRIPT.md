# Demo script: Ask the Satellite

About 5 minutes: a short opening, four scenarios, then a close. **Bold** lines are what you do; quoted lines are what you say. Every number below is what the app shows on screen today, checked on 13 Nov 2026.

Say the numbers the way the screen shows them; don't round them differently. For deeper questions afterwards, see [STUDY_GUIDE.md](STUDY_GUIDE.md).

---

## Before you start (backstage checklist)

- [ ] Run `start_demo.bat` (local, with the AI model), or open https://ats.pokedb.site (public; open it 2 minutes early because the free server sleeps).
- [ ] Hard-refresh the page (Ctrl+Shift+R) so the latest version loads.
- [ ] The chat panel is open on the right. The header should say "Online · qwen2.5 · on this machine" if you are running locally.
- [ ] Have the four prompts below ready to type, or use the shortcut keys as a backup: **1** Palm, **2** UAE flood, **3** Lake Mead, **4** LA fire. Press the key with the cursor outside the chat box.
- [ ] Click **Orbit** (bottom right) so you start from the full globe.

---

## Opening (about 5 seconds)

**The page is open: the globe on the left, the assistant on the right.**

> "This is Ask the Satellite. You ask how any place on Earth has changed, and real satellite images answer, with the evidence behind every number."

Optional extra 10 seconds, if you have time:

> "On the left is a live 3D globe. On the right is our assistant. The AI never makes up a number; every figure is measured from Landsat or Sentinel-2 scenes."

---

## Scenario 1: Palm Jumeirah, 2001 to 2008

**Type:** `Palm Jumeirah 2001 to 2008` and press Enter.

**What happens:** the globe zooms out, turns, and flies into Dubai. A before/after swipe appears over the Palm, and the report fills in on the right.

**Say, while it flies:**
> "Watch the globe: it zooms out to orbit, turns, and lands on Dubai, like Google Earth."

**When the report appears, say:**
> "In May 2001 this was open sea. By May 2008 the Palm had been built. We measured **8.59 square kilometres of water turned into land**, about **1,200 football pitches**."

**Drag the swipe handle on the globe left and right.**
> "On the left is the Landsat 7 image from 22 May 2001; on the right is Landsat 5 from 17 May 2008. Orange marks where water became land."

**Point at the confidence label (Medium) and the line below it.**
> "Notice it says **Medium confidence**, even though 100% of the area was cloud-free. That's because the two dates come from **different satellites**, Landsat 7 and Landsat 5. The app downgrades itself when the comparison isn't perfect. It tells you the limits of its own answer."

**Scroll the report to "Background".**
> "Below the measurement is sourced context: when construction began, and the reported environmental downsides, like coral reefs being buried by dredged sand. Every line has a numbered citation. Where the developer disputed a claim, we show that too."

**Feature to show: the dates and index bar.** It opened by itself for this story. Change **Date 2** to **2024** (or Index to **NDVI**).
> "Because this is pre-computed data, we can pick any two years from our archive, 2000 to 2024, and it re-measures instantly."

**Feature to show: Verify the science.** Click **Verify** in the top bar.
> "And this is the important part: **Verify the science**. These are the exact satellite scene IDs, the formula, the cloud mask and the confidence rules. Anyone can download the same scenes and reproduce our number."

**Close the Verify panel.**

---

## Scenario 2: Lake Mead drought

**Type:** `Did Lake Mead shrink?` and press Enter.

**Say:**
> "We can also just ask in plain English. Lake Mead is the largest reservoir in the United States, and it was hit hard by drought."

**When the report appears:**
> "Between August 2019 and September 2022, Sentinel-2 measured the lake losing **47.6 square kilometres of water**, about **15%**. That's around **6,600 football pitches**. Confidence is **High**: 99% of the area was cloud-free on both dates."

**Drag the swipe.** Orange along the shoreline is water that became dry land.
> "You can see the shoreline pulling back around the whole lake."

**The accuracy point (important):**
> "How do we know it's right? We checked it against a published benchmark. We measured **317 and 265 square kilometres** of water on the two dates, against the benchmark's **324 and 267**. That's within **2.2%** and **0.8%**."

**Feature to show: the AI guard.** Point at the "What this shows" summary and the grey line under it.
> "This short summary is written by our AI, running locally on this laptop. But every sentence is checked before it's shown: if it contains a number or a name that isn't in our measured facts, it is deleted. The AI explains; it never invents."

---

## Scenario 3: UAE flood, April 2024

**Type:** `UAE flood April 2024` and press Enter.

**Say:**
> "On 16 April 2024 the UAE had its heaviest rainfall since records began in 1949. The National Center of Meteorology recorded 254.8 millimetres in under 24 hours."

**When the report appears:**
> "Comparing 12 April with 22 April, our flood rule found **6.6 square kilometres of newly flooded land**, about **900 football pitches**. Confidence is **High**, with 93% of the area clear."

**Feature to show: the flood rule.**
> "For floods we use a stricter rule: a pixel counts only if it was dry before and clearly wetter after. That catches muddy floodwater too, which normal water detection misses."

**Feature to show: "why these scenes?"** Hover over the dotted **why these scenes?** link under the clear-percentage bar; a tooltip lists every candidate day.
> "Clouds are the enemy of satellites. The app doesn't take the first image it finds: it checks every candidate day and picks the one where **our area** is clearest. It shows you that choice here."

**Feature to show: Before | Today.** Click **Before | Today** in the top bar, then drag the swipe.
> "And with Before | Today we compare against today's map. Today's imagery is shown for context only: it's mixed-date, so we never measure from it, and the app labels it that way."

**Click Before | After again** to switch back.

---

## Scenario 4: Los Angeles wildfire, January 2025

**Type:** `Los Angeles wildfire 2025` and press Enter. (It opens the Palisades fire story.)

**Say:**
> "Last one: the Los Angeles fires of January 2025. Same engine, different science. For fire we use a burn index called dNBR: healthy plants reflect near-infrared light strongly, burned ground doesn't."

**When the report appears:**
> "Between 2 January and 1 February 2025, Sentinel-2 measured **93.4 square kilometres of burn scar** from the Palisades fire. Confidence **High**, 98% clear."

**The validation point (strong moment):**
> "The official CAL FIRE figure for the Palisades fire is about 23,400 acres, roughly **95 square kilometres**. We measured **93.4** from orbit. That's within about 2%."

**Drag the swipe.** Before the fire on the left; on the right, **blue marks the burn scar**.
> "Everything in blue is burn scar, measured from orbit a few weeks after the fire."

**Scroll to "Background".**
> "And the context, from CBS News: both fires started on 7 January in a Santa Ana wind storm with gusts near 100 miles an hour. Together they burned over 37,000 acres and killed 29 people. The Palisades fire destroyed 6,837 structures."

**Optional: click the "Eaton fire, Altadena" chip** under "Look next".
> "For the Eaton fire we measure 33.7 square kilometres, less than the official perimeter of about 57. That's honest, not a bug: much of Eaton burned houses in Altadena's streets, which change the signal less than burned hillside. We show what the satellite can actually see."

---

## Other things worth a quick mention (if there's time)

- **Stories** (top bar): every pre-measured case study, with dates and sensor. It works offline.
- **EO Satellites** (bottom right): live positions of Landsat, Sentinel and other Earth-observation satellites, from real orbit data.
- **Explore any place:** type a city like `Kyoto` and you get a short brief from Wikipedia, held to Wikipedia's facts.
- **Arabic:** questions in Arabic work too, for example the Arabic Palm prompt on the start screen.
- **Runs locally:** the AI model runs on this laptop's GPU. No cloud AI, no data leaves the machine, and it works without internet for the stories.
- **Built for a crowd:** load-tested with 3,000 simulated visitors and 21,000 requests, with zero errors.

---

## Closing (about 10 seconds)

**Click Orbit** to return to the full globe.

> "So that's Ask the Satellite: real satellite measurements, honest confidence, sources for every claim, and an AI that explains but never invents. The satellite measures; the AI explains; and you can verify every number."

---

## If something goes wrong

| Problem | Do this |
| --- | --- |
| A typed prompt goes to the wrong place | Press the shortcut key (1 to 4) with the cursor outside the chat box, or open **Stories** and click the story |
| No AI summary appears | Fine. The measured numbers, sources and confidence still show. Say: "Even without the AI, every number is still here." |
| The globe looks stuck or black | Click **Orbit**, or refresh the page. The stories load from disk |
| The public site is slow to start | The free server was asleep. Wait about a minute, or switch to the local copy |
| Wrong region in the dates bar | Ignore it and type the next prompt. The bar updates itself |

## Key numbers cheat sheet

| Scenario | Dates | Satellite | Measured | Confidence | Compare with |
| --- | --- | --- | --- | --- | --- |
| Palm Jumeirah | 22 May 2001 → 17 May 2008 | Landsat 7 → Landsat 5, 30 m | 8.59 km² water became land (−17% water) | Medium (different satellites), 100% clear | ≈ 1,200 football pitches |
| Lake Mead | 14 Aug 2019 → 7 Sep 2022 | Sentinel-2B | −47.6 km² water (−15%) | High, 99% clear | Benchmark 324 / 267 km² vs ours 317 / 265 km² |
| UAE flood | 12 Apr → 22 Apr 2024 | Sentinel-2B, 20 m | +6.6 km² newly flooded | High, 93% clear | Record rain on 16 Apr: 254.8 mm in under 24 h |
| LA Palisades fire | 2 Jan → 1 Feb 2025 | Sentinel-2A → 2C, 20 m | 93.4 km² burn scar | High, 98% clear | CAL FIRE ≈ 95 km² |
| LA Eaton fire (optional) | same | same | 33.7 km² burn scar | High, 87% clear | Official ≈ 57 km² (urban burn shows less) |
