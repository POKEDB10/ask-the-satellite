# Ask the Satellite: the 10-minute team guide

Read this once and you can explain the project and answer the easy questions. For anything deeper, hand over to our lead (see [LEAD_GUIDE.md](LEAD_GUIDE.md)).

---

## 1. What is it? (learn this word for word)

> "Ask the Satellite is a 3D globe with an AI assistant. You ask how a place changed, and it measures the change from real satellite images. Every number shows its evidence, and the AI is never allowed to make a number up."

## 2. How does it work? Four steps

1. **You ask** a question, like "Did Lake Mead shrink?"
2. **We find the images.** The app searches free satellite archives (NASA/USGS Landsat and the European Sentinel-2) and picks the clearest, least cloudy day before and after.
3. **We measure.** A program compares the two images pixel by pixel and counts what changed, for example water turning into land, in km².
4. **The AI explains.** A small AI running on our laptop writes a 2–3 sentence summary. Every sentence is checked, and any sentence with a number or name we didn't measure or source is deleted.

**The one idea to remember:** *the satellite measures, the AI only explains.*

## 3. The four demo stories

| Story | What we found | Confidence |
| --- | --- | --- |
| Palm Jumeirah, 2001 → 2008 | 8.6 km² of sea became land | Medium (two different satellites) |
| Lake Mead, 2019 → 2022 | Lost 47.6 km² of water (−15%) | High |
| UAE flood, April 2024 | 6.6 km² newly flooded | High |
| LA Palisades fire, Jan 2025 | 93.4 km² burned (official figure: ~95 km²) | High |

## 4. Words you might hear

- **Landsat / Sentinel-2:** free government satellites that photograph the whole Earth every few days.
- **Confidence (High / Medium / Low):** how much we trust a result, based on clouds and whether the same satellite took both pictures.
- **Swipe:** the slider on the globe that shows before on one side and after on the other.
- **Verify the science:** a button that shows exactly which images and formulas we used, so anyone can check.

## 5. Easy questions and short answers

**"Is this just ChatGPT?"**
No. The numbers come from measuring real satellite pixels. The AI only writes the summary, and we delete any sentence it makes up.

**"Where do the images come from?"**
NASA/USGS Landsat and ESA's Sentinel-2. Both are free and public.

**"Is it accurate?"**
We checked it against published figures. Lake Mead was within about 2%, and the LA fire was within about 2% of the official burned area.

**"What about clouds?"**
We pick the clearest day for that exact area. Cloudy pixels are greyed out and never counted.

**"Does it need the internet?"**
The demo stories work offline. Searching new places needs internet.

**"Where does the AI run?"**
On our own laptop, not in the cloud, so it's free and private.

**"Can I try it?"**
Yes: https://ats.pokedb.site

**Anything harder?**
> "Great question. Our lead built that part, let me hand over."
