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
    "la_palisades_2025": P("Palisades fire, Los Angeles 2025", [-118.720, 34.020, -118.480, 34.130], "2024-12-28", "2025-01-27", "nbr", "sentinel-2", 20,
                           ["palisades fire", "pacific palisades", "los angeles fire", "los angeles wildfire", "la fire", "la wildfire", "la fires", "malibu fire", "حريق لوس أنجلوس"],
                           "The Palisades fire started on 7 January 2025 in a Santa Ana wind storm and destroyed 6,837 structures; with the Eaton fire it burned 37,469 acres (CBS News).", win=(12, 12), max_cloud=60),
    "la_eaton_2025": P("Eaton fire, Altadena 2025", [-118.200, 34.150, -118.020, 34.250], "2024-12-28", "2025-01-27", "nbr", "sentinel-2", 20,
                       ["eaton fire", "altadena", "altadena fire", "pasadena fire"],
                       "The Eaton fire started on 7 January 2025 in a Santa Ana wind storm and destroyed 9,418 buildings; with the Palisades fire it burned 37,469 acres (CBS News).", win=(12, 12), max_cloud=60),
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
