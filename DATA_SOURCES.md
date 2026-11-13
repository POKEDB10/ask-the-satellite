# Data sources and terms

Every layer and fact on screen has a source. Analysed data comes from Landsat and Sentinel-2 only. The basemap is context only and is never analysed.

| Source | Used for | Access | Terms and attribution shown |
| --- | --- | --- | --- |
| USGS Landsat 5 TM, Landsat 7 ETM+ (Collection 2 Level-2) | Palm frames 2000–2008, Palm Jebel Ali | Microsoft Planetary Computer STAC `landsat-c2-l2`, signed URLs | Public domain. "Landsat data courtesy of the U.S. Geological Survey" |
| Copernicus Sentinel-2 L2A | Lake Mead, UAE flood 2024, Palm 2018 and 2024 frames, live runs | Element 84 Earth Search v1 `sentinel-2-l2a` (anonymous COG reads); Planetary Computer as backup | Free and open, including commercial use, with attribution. "Contains modified Copernicus Sentinel data <year>, processed by ESA" |
| Esri World Imagery | Basemap only (context, current mixed dates, never analysed) | ArcGIS basemap service with a free developer key, or the keyless public service | Attribution required: "Esri, Vantor, Earthstar Geographics, and the GIS User Community" (the text the service returned on 12 Nov 2026). Never cached, prefetched or exported offline. Free developer tier; re-check the usage limits on the day |
| Esri World Boundaries and Places | Optional labels layer (off by default) | ArcGIS public service | Esri attribution, as above |
| Natural Earth II | Offline globe floor | Bundled with CesiumJS | Public domain |
| NASA Blue Marble Next Generation (July 2004, topography) and Blue Marble land, ocean, ice and clouds | Orbit view; fades out below about 4,500 km in favour of Esri | Vendored 4096 × 2048 JPEGs (`web/vendor/earth/`), from assets.science.nasa.gov and Wikimedia Commons | Public domain; credit "NASA Earth Observatory". Decoration only, never analysed |
| OpenStreetMap via Nominatim, then Photon | Place lookup for chat questions | Public APIs, 1 request per second, identifying User-Agent, results cached on disk | © OpenStreetMap contributors, ODbL |
| GeoNames via the Open-Meteo geocoding API | Search type-ahead | Public API, no key, cached 6 h | GeoNames, CC BY 4.0; Open-Meteo terms (free for non-commercial use: re-check for a paid tier) |
| Wikipedia (REST summary, geosearch, page views) | Place card, nearby highlights, the facts the guide may use | Public APIs with a contact User-Agent, cached 24 h | Text CC BY-SA 4.0; linked on every card |
| CelesTrak NORAD GP elements (groups "resource" and "stations") | Live satellite positions and orbits | Fetched at most every 6 h, copy kept on disk for offline use; propagated in the browser with satellite.js (MIT) | Public; credit "CelesTrak". Positions are approximate |
| Curated Los Angeles fires context (Jan 2025) | "What happened" for the Palisades and Eaton stories | `backend/presets.json`, each line with its link | CBS News, 31 Jan 2025 (start date, Santa Ana winds, 37,469 acres combined, 6,837 and 9,418 structures, 29 deaths); checked against the article on 13 Nov 2026 |
| Curated Palm Jumeirah context | "What happened", downsides, counterpoints | `backend/presets.json`, each line with its link | Al Jazeera (27 Oct 2005); Mongabay (23 Aug 2005); The National (18 Feb 2009; 16 Jun 2023); NASA Earth Observatory; Cavalcante et al. 2011, J. Coastal Research, doi:10.2112/JCOASTRES-D-09-00177.1; Mansourmoghaddam et al. 2022, Water 14(4):634, doi:10.3390/w14040634 |

Checked on 12 Nov 2026:
- Each context line was compared with its source.
- The Al Jazeera article does not say marine life was "buried or asphyxiated". That wording was dropped. The burial claim is attributed to Mongabay, which reports it.
- No openable source was found for "the developer cut gaps in the breakwater", so that line was not used.
- The Mansourmoghaddam paper is cited for its topic only; its results were not read.
