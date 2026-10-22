# analysis.py — turns raw satellite data into suitability scores and advice.
#
# The chosen area is split into a 10 x 10 grid of cells. For every cell we measure land cover,
# people, slopes and flood-prone land, then:
#   * score the whole area for the chosen purpose (data centre or township),
#   * rank cells to find the best spots to build,
#   * find heat hotspots (lots of roofs/roads, little shade) that need trees,
#   * write plain-language recommendations.
# Every score is 0-100, where higher means better for building responsibly.

import base64  # turns the land-cover PNG into text that can travel inside JSON
import io  # an in-memory file for building the PNG
import logging  # writes download problems to the server log
from concurrent.futures import ThreadPoolExecutor  # download several datasets at the same time

import numpy as np  # maths on whole grids
from PIL import Image  # builds the land-cover overlay picture
from scipy.ndimage import distance_transform_edt, minimum_filter, uniform_filter  # image filters for the height map

import datasources as ds  # the satellite/climate readers

log = logging.getLogger(__name__)  # this module's logger

CELLS = 10  # the area is split into CELLS x CELLS cells
LANDCOVER_PX = 400  # land cover is read at 400 x 400 pixels (40 x 40 per cell)
DEM_PX = 200  # height map is read at 200 x 200 pixels (20 x 20 per cell)
CATCHMENT_KM = 20  # water supply/demand is estimated over at least a 20 km wide area

# Planning assumptions (shown to the user so the numbers can be checked).
DC_WATER_L_PER_KWH = 1.8  # typical water use of evaporative data-centre cooling (industry average WUE)
LITRES_PER_PERSON_DAY = 200  # household water use per resident
USABLE_RAIN_SHARE = 0.3  # share of rainfall that ends up in rivers/groundwater instead of evaporating
CANOPY_TARGET = 0.30  # the "30" in the 3-30-300 urban greening rule: 30% tree canopy
TREE_CROWN_M2 = 50  # ground shaded by one mature street tree
LOW_LYING_M = 5  # land less than this many metres above nearby water counts as flood-prone
FLOOD_REACH_M = 1000  # ...but only within this distance of the water
GROUND_WINDOW_M = 150  # trees/buildings narrower than this are removed from the height map
STEEP_SLOPE_PCT = 15  # slopes steeper than this are hard and risky to build on
MAX_CANDIDATE_SENSITIVE_PCT = 30  # never suggest building where 30%+ is forest, mangrove or wetland
MIN_LAND_SHARE = 0.1  # an area that is over 90% water scores 0

# Land-cover groups used by the scores (ESA WorldCover class codes).
GROUPS = {
    "tree": [10],
    "shrub": [20],
    "grass": [30],
    "crop": [40],
    "built": [50],
    "bare": [60],
    "snow": [70],
    "water": [80],
    "wetland": [90],
    "mangrove": [95],
    "moss": [100],
}

DATASET_NAMES = {  # names used in "could not be downloaded" messages
    "height": "Terrain data (Copernicus DEM)",
    "people": "Population data (Meta HRSL)",
    "climate": "Climate data (NASA POWER)",
}

PURPOSES = {  # factor weights for each purpose (they add up to 100)
    "datacentre": {
        "label": "Data centre",
        "weights": {"water": 30, "nature": 25, "people": 20, "cooling": 15, "terrain": 10},
    },
    "township": {
        "label": "Township",
        "weights": {"heat": 25, "green": 25, "water": 20, "terrain": 15, "nature": 15},
    },
}
FACTOR_LABELS = {  # names shown in the dashboard
    "water": "Water availability",
    "nature": "Nature protected",
    "people": "Distance from homes",
    "cooling": "Cooling climate",
    "terrain": "Flood & slope safety",
    "heat": "Heat comfort",
    "green": "Green space",
}


# ---------- Scoring curves (all return 0-100, higher = better) ----------

def score_water(stress):
    """Share of rain-fed water used: below 10% is fine, 40%+ is high stress, 100%+ is not sustainable."""
    return np.interp(stress, [0.1, 0.2, 0.4, 0.8, 1.0], [100, 80, 50, 20, 0])  # bands follow WRI water-stress levels


def score_nature(sensitive):
    """Forest, mangrove and wetland that building would destroy: 5% or less is fine, 60%+ scores 0."""
    return np.interp(sensitive, [0.05, 0.6], [100, 0])


def score_people(density):
    """People per km² nearby: rural (<300) is ideal for a data centre, dense city (10,000+) scores 0."""
    return np.interp(density, [300, 1000, 3000, 10000], [100, 75, 35, 0])


def score_cooling(mean_temp_c):
    """Cooler climates need less energy and water for cooling: 15 °C scores 100, 30 °C scores 20."""
    return np.interp(mean_temp_c, [15, 30], [100, 20])


def score_terrain(low_lying, steep):
    """Penalise flood-prone low land and steep slopes."""
    return np.clip(100 - 120 * low_lying - 100 * steep, 0, 100)


def score_heat(surface_heat, hottest_max_c):
    """Hard surfaces vs shade/water, plus how hot the hottest month gets."""
    surface = np.interp(surface_heat, [-0.5, 0.6], [100, 0])  # -0.5 = very leafy, +0.6 = almost all concrete
    if hottest_max_c is None:  # no climate data: judge by surfaces only
        return surface
    climate = np.interp(hottest_max_c, [28, 36], [100, 0])  # average daily high of the hottest month
    return 0.5 * surface + 0.5 * climate  # both matter equally


def score_green(tree, green):
    """Tree canopy against the 30% target, plus all other greenery."""
    canopy = np.interp(tree, [0, CANOPY_TARGET], [0, 100])  # 30% canopy or more = full marks
    other = np.interp(green, [0, 0.5], [0, 100])  # half the area green = full marks
    return 0.7 * canopy + 0.3 * other  # canopy matters most for shade


# ---------- Turning pixels into per-cell numbers ----------

def cell_mean(mask, cells=CELLS):
    """Average of a pixel grid inside each cell (e.g. share of tree pixels per cell)."""
    n = mask.shape[0] // cells  # pixels along one cell edge
    return mask.reshape(cells, n, cells, n).mean(axis=(1, 3))  # cells x cells result


def neighbourhood_mean(values):
    """Average of each cell and its 8 neighbours — 'what is within walking distance'."""
    padded = np.pad(values, 1, mode="edge")  # repeat the edge cells so border cells have neighbours
    rows, cols = values.shape  # grid size
    return sum(padded[r:r + rows, c:c + cols] for r in range(3) for c in range(3)) / 9  # mean of 9 shifted copies


def landcover_fractions(codes):
    """Share (0-1) of each land-cover group in a pixel array."""
    return {name: float(np.isin(codes, ids).mean()) for name, ids in GROUPS.items()}


def derived_groups(f):
    """Combined groups used by several scores. Works for single numbers and for per-cell arrays."""
    return {
        "green": f["tree"] + f["shrub"] + f["grass"] + f["mangrove"],  # anything leafy
        "sensitive": f["tree"] + f["mangrove"] + f["wetland"],  # ecosystems that shouldn't be cleared
        "hard": f["built"] + f["bare"],  # surfaces that soak up heat (roofs, roads, bare soil)
        "cooling": f["tree"] + f["water"] + f["wetland"] + f["mangrove"],  # surfaces that cool the air
        "buildable": f["shrub"] + f["grass"] + f["crop"] + f["bare"],  # open land where something new can go
    }


def ground_level(height, pixel_m):
    """The DEM measures the top of trees and roofs. Taking the lowest value nearby removes them,
    leaving (roughly) the ground, which is then smoothed so single pixels don't look like cliffs."""
    window = max(1, int(round(GROUND_WINDOW_M / pixel_m)))  # how many pixels make up ~150 m
    ground = minimum_filter(height, size=window | 1)  # lowest point within the window (odd size keeps it centred)
    return uniform_filter(ground, size=3)  # gentle smoothing


def terrain_masks(height, water, pixel_m):
    """Find flood-prone land (just above nearby water) and steep slopes from the height map."""
    ground = ground_level(height, pixel_m)  # trees and buildings removed
    dy, dx = np.gradient(ground, pixel_m)  # rise in metres per metre, north-south and east-west
    slope_pct = np.hypot(dx, dy) * 100  # slope as a percentage
    land = ~water  # we only care about land pixels
    steep = land & (slope_pct > STEEP_SLOPE_PCT)  # land too steep to build on easily
    if not water.any():  # no river, lake or sea in the area
        return np.zeros_like(land), steep, land  # nothing nearby to flood from
    distance_m, (iy, ix) = distance_transform_edt(~water, sampling=pixel_m, return_indices=True)  # nearest water
    above_water = ground - ground[iy, ix]  # how far each pixel sits above its nearest water
    low = land & (distance_m <= FLOOD_REACH_M) & (above_water < LOW_LYING_M)  # close to water and barely above it
    return low, steep, land


def landcover_png(codes):
    """Colour each land-cover pixel with the official WorldCover legend and return a PNG data URL."""
    rgb = np.zeros(codes.shape + (3,), dtype=np.uint8)  # black picture the size of the grid
    for code, (_, colour) in ds.LANDCOVER_CLASSES.items():  # paint each class in its colour
        rgb[codes == code] = [int(colour[i:i + 2], 16) for i in (1, 3, 5)]  # "#rrggbb" -> [r, g, b]
    buf = io.BytesIO()  # in-memory file
    Image.fromarray(rgb, "RGB").save(buf, format="PNG", optimize=True)  # encode as PNG
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()  # embeddable in JSON/HTML


# ---------- Water budget ----------

def water_budget(climate, catchment_km, catchment_people, purpose, size):
    """Rough yearly water balance for the surrounding area, in cubic metres."""
    if not climate or climate.get("rain_mm_year") is None:  # no rainfall figure, no budget
        return None
    area_m2 = (catchment_km * 1000) ** 2  # catchment area
    supply = climate["rain_mm_year"] / 1000 * area_m2 * USABLE_RAIN_SHARE  # rain that becomes usable water
    residents = catchment_people * LITRES_PER_PERSON_DAY * 365 / 1000  # what people there already use
    if purpose == "datacentre":
        new = size * 1000 * 24 * 365 * DC_WATER_L_PER_KWH / 1000  # MW -> kWh per year -> litres -> m³
    else:
        new = size * LITRES_PER_PERSON_DAY * 365 / 1000  # new residents' yearly use
    stress = (residents + new) / supply if supply > 0 else float("inf")  # share of supply that would be used
    return {
        "catchment_km": catchment_km,  # width of the area the budget covers
        "supply_m3": round(supply),  # usable rain-fed water per year
        "residents_m3": round(residents),  # existing residents' use
        "new_m3": round(new),  # the project's use
        "stress": round(min(stress, 9.99), 3),  # 0.25 = a quarter of the supply would be used
        "new_share": round(min(new / supply, 9.99), 4) if supply > 0 else None,  # the project's own share
    }


# ---------- Main entry point ----------

def analyse(lat, lon, width_km, purpose, size):
    """Run the full analysis for one area. size = MW for a data centre, new residents for a township."""
    grid = ds.Grid(lat, lon, width_km, LANDCOVER_PX)  # fine grid for land cover
    catchment_km = max(width_km, CATCHMENT_KM)  # water is judged over a wider area
    warnings = []  # problems worth telling the user about

    with ThreadPoolExecutor(max_workers=5) as pool:  # fetch all datasets in parallel
        jobs = {
            "landcover": pool.submit(ds.read_landcover, grid),
            "height": pool.submit(ds.read_elevation, grid.resized(DEM_PX)),
            "people": pool.submit(ds.read_population, grid.resized(CELLS)),  # people per cell
            "catchment": pool.submit(ds.read_population, ds.Grid(lat, lon, catchment_km, 1)),  # one total
            "climate": pool.submit(ds.read_climate, lat, lon),
        }
    results = {}  # dataset name -> data (or None if it failed)
    for name, job in jobs.items():
        try:
            results[name] = job.result()  # re-raises any error from the download
        except ds.DataUnavailable as err:
            results[name] = None  # carry on without it
            log.warning("%s download failed: %s", name, err)  # full details for the server log
            if name in DATASET_NAMES:  # the catchment total is part of the population download, no separate message
                warnings.append(f"{DATASET_NAMES[name]} could not be downloaded")  # short message for the user
    if results["landcover"] is None:  # nothing useful can be said without land cover
        raise ds.DataUnavailable("ESA WorldCover land cover could not be downloaded")

    codes = results["landcover"]  # land-cover class per pixel
    climate = results["climate"]  # dict or None
    cell_km = width_km / CELLS  # width of one cell
    cell_km2 = cell_km ** 2  # area of one cell

    # --- land cover per cell and overall ---
    cell_f = {name: cell_mean(np.isin(codes, ids)) for name, ids in GROUPS.items()}  # cells x cells shares
    area_f = landcover_fractions(codes)  # shares over the whole area
    cell_d = derived_groups(cell_f)  # combined groups per cell
    area_d = derived_groups(area_f)  # combined groups overall

    # --- terrain ---
    if results["height"] is not None:
        height = results["height"]  # metres
        water_small = codes[::LANDCOVER_PX // DEM_PX, ::LANDCOVER_PX // DEM_PX] == ds.WATER_CLASS  # water at DEM size
        low, steep, land = terrain_masks(height, water_small, grid.pixel_m * LANDCOVER_PX / DEM_PX)
        land_cells = np.maximum(cell_mean(land), 1e-9)  # share of land per cell (avoid dividing by 0)
        cell_low = cell_mean(low) / land_cells  # share of each cell's land that is low-lying
        cell_steep = cell_mean(steep) / land_cells  # share of each cell's land that is steep
        land_total = max(land.mean(), 1e-9)
        area_low, area_steep = float(low.mean() / land_total), float(steep.mean() / land_total)
        elevation = {"min_m": round(float(height.min())), "max_m": round(float(height.max()))}
    else:
        cell_low = cell_steep = None
        area_low = area_steep = None
        elevation = None

    # --- people ---
    people_cells, covered = results["people"] if results["people"] is not None else (None, False)
    if people_cells is not None and not covered and area_f["built"] > 0.02:  # buildings but no population data
        warnings.append("population data does not cover this country, so 'distance from homes' is not scored")
        people_cells = None
    people_total = float(people_cells.sum()) if people_cells is not None else None
    catchment_people = float(results["catchment"][0].sum()) if results["catchment"] is not None else 0.0

    water = water_budget(climate, catchment_km, catchment_people if people_cells is not None else 0.0, purpose, size)

    # --- whole-area factor scores ---
    hottest = climate.get("hottest_month_max_c") if climate else None
    mean_temp = climate.get("mean_temp_c") if climate else None
    factor_values = {
        "water": score_water(water["stress"]) if water else None,
        "nature": score_nature(area_d["sensitive"]),
        "people": score_people(people_total / width_km ** 2) if people_total is not None else None,
        "cooling": score_cooling(mean_temp) if mean_temp is not None else None,
        "terrain": score_terrain(area_low, area_steep) if area_low is not None else None,
        "heat": score_heat(area_d["hard"] - area_d["cooling"], hottest),
        "green": score_green(area_f["tree"], area_d["green"]),
    }
    weights = PURPOSES[purpose]["weights"]  # which factors count, and how much
    factors = []  # list for the dashboard
    for key, weight in weights.items():
        value = factor_values[key]
        factors.append({
            "key": key,
            "label": FACTOR_LABELS[key],
            "weight": weight,
            "score": None if value is None else round(float(value)),
            "detail": factor_detail(key, area_f, area_d, people_total, width_km, climate, water, area_low, area_steep, purpose),
        })
    scored = [f for f in factors if f["score"] is not None]  # factors we had data for
    overall = round(sum(f["score"] * f["weight"] for f in scored) / sum(f["weight"] for f in scored))
    if area_f["water"] > 1 - MIN_LAND_SHARE:  # (almost) all sea or lake: nothing to build on
        overall = 0
    missing_weight = sum(f["weight"] for f in factors if f["score"] is None)  # how much of the score had no data

    # --- per-cell scores, best spots and hotspots ---
    cells = build_cells(grid, cell_f, cell_d, cell_low, cell_steep, people_cells, cell_km2, factor_values,
                        hottest, weights)
    candidates = pick_candidates(cells)
    hotspots = pick_hotspots(cells, cell_km2)

    flags = red_flags(purpose, water, area_f, area_d, area_low, people_total, width_km, factor_values, candidates)
    verdict = make_verdict(overall, flags, missing_weight)
    context = {
        "purpose": purpose, "size": size, "area_f": area_f, "area_d": area_d, "climate": climate, "water": water,
        "people_total": people_total, "width_km": width_km, "area_low": area_low, "area_steep": area_steep,
        "candidates": candidates, "hotspots": hotspots,
    }
    return {
        "location": {"lat": lat, "lon": lon, "width_km": width_km, "bounds": grid.bounds},
        "purpose": purpose,
        "purpose_label": PURPOSES[purpose]["label"],
        "size": size,
        "overall": overall,
        "verdict": verdict,
        "factors": factors,
        "flags": flags,
        "recommendations": recommendations(context),
        "landcover": [  # breakdown for the chart, biggest first
            {"code": code, "name": name, "color": colour, "pct": round(float((codes == code).mean()) * 100, 1)}
            for code, (name, colour) in sorted(ds.LANDCOVER_CLASSES.items(), key=lambda kv: -(codes == kv[0]).mean())
            if (codes == code).any()
        ],
        "metrics": {
            "tree_pct": pct(area_f["tree"]),
            "green_pct": pct(area_d["green"]),
            "built_pct": pct(area_f["built"]),
            "water_pct": pct(area_f["water"]),
            "sensitive_pct": pct(area_d["sensitive"]),
            "low_lying_pct": pct(area_low) if area_low is not None else None,
            "steep_pct": pct(area_steep) if area_steep is not None else None,
            "people": round(people_total) if people_total is not None else None,
            "density_per_km2": round(people_total / width_km ** 2) if people_total is not None else None,
            "elevation": elevation,
        },
        "climate": climate,
        "water": water,
        "cells": cells,
        "candidates": candidates,
        "hotspots": hotspots,
        "overlay": {"png": landcover_png(codes), "bounds": grid.bounds},
        "assumptions": {
            "dc_water_l_per_kwh": DC_WATER_L_PER_KWH,
            "litres_per_person_day": LITRES_PER_PERSON_DAY,
            "usable_rain_share": USABLE_RAIN_SHARE,
            "canopy_target_pct": CANOPY_TARGET * 100,
            "low_lying_m": LOW_LYING_M,
            "steep_slope_pct": STEEP_SLOPE_PCT,
        },
        "warnings": warnings,
        "sources": [
            "ESA WorldCover 2021 (10 m, Sentinel-1/2)",
            "Meta High Resolution Settlement Layer (30 m population)",
            "Copernicus DEM GLO-30 (30 m terrain)",
            "NASA POWER climatology (temperature, rainfall)",
        ],
    }


def pct(x):
    """0.1234 -> 12.3 (percent, one decimal)."""
    return round(float(x) * 100, 1)


def fmt_int(x):
    """12345.6 -> '12,346'."""
    return f"{round(x):,}"


def factor_detail(key, f, d, people, width_km, climate, water, low, steep, purpose):
    """One sentence explaining where a factor's score comes from."""
    if key == "water":
        if not water:
            return "Rainfall data unavailable, so water could not be estimated."
        what = "the data centre" if purpose == "datacentre" else "the new residents"
        return (f"{fmt_int(climate['rain_mm_year'])} mm of rain a year. Existing residents plus {what} would use about "
                f"{water['stress'] * 100:.0f}% of the rain-fed water within {water['catchment_km']:g} km.")
    if key == "nature":
        return f"{pct(d['sensitive'])}% of the area is tree cover (forest or plantation), mangrove or wetland that building could destroy."
    if key == "people":
        if people is None:
            return "Population data unavailable here."
        return f"About {fmt_int(people)} people live in the area ({fmt_int(people / width_km ** 2)} per km²)."
    if key == "cooling":
        if not climate or climate.get("mean_temp_c") is None:
            return "Temperature data unavailable."
        return f"Average temperature {climate['mean_temp_c']} °C; hotter sites need more energy and water to cool servers."
    if key == "terrain":
        if low is None:
            return "Height data unavailable."
        return f"{pct(low)}% of the land is low-lying near water level (flood-prone) and {pct(steep)}% is steep."
    if key == "heat":
        text = f"{pct(d['hard'])}% roofs, roads and bare soil vs {pct(d['cooling'])}% shade and water."
        if climate and climate.get("hottest_month_max_c") is not None:
            text += f" Hottest month averages {climate['hottest_month_max_c']} °C highs."
        return text
    if key == "green":
        return f"Tree canopy {pct(f['tree'])}% (target {CANOPY_TARGET * 100:.0f}%); all greenery {pct(d['green'])}%."
    return ""


def build_cells(grid, cell_f, cell_d, cell_low, cell_steep, people_cells, cell_km2, area_scores, hottest, weights):
    """Score every cell of the grid. Water and cooling are area-wide; the rest is measured per cell."""
    lat_step = (grid.north - grid.south) / CELLS  # cell height in degrees
    lon_step = (grid.east - grid.west) / CELLS  # cell width in degrees
    near_tree = neighbourhood_mean(cell_f["tree"])  # canopy within walking distance
    near_green = neighbourhood_mean(cell_d["green"])  # greenery within walking distance
    per_cell = {
        "nature": score_nature(cell_d["sensitive"]),
        "people": score_people(people_cells / cell_km2) if people_cells is not None else None,
        "terrain": score_terrain(cell_low, cell_steep) if cell_low is not None else None,
        "heat": score_heat(cell_d["hard"] - cell_d["cooling"], hottest),
        "green": score_green(near_tree, near_green),
    }
    cells = []
    for r in range(CELLS):  # row 0 is the northern edge
        for c in range(CELLS):  # column 0 is the western edge
            total, weight_sum = 0.0, 0  # weighted average of the factors we have
            for key, weight in weights.items():
                if per_cell.get(key) is not None:
                    value = per_cell[key][r, c]  # measured for this cell
                elif area_scores.get(key) is not None and key not in per_cell:
                    value = area_scores[key]  # same for the whole area (water, cooling)
                else:
                    continue  # no data for this factor
                total += value * weight
                weight_sum += weight
            north = grid.north - r * lat_step  # top edge of the cell
            west = grid.west + c * lon_step  # left edge of the cell
            cells.append({
                "row": r,
                "col": c,
                "bounds": [[north - lat_step, west], [north, west + lon_step]],
                "center": [north - lat_step / 2, west + lon_step / 2],
                "score": round(total / weight_sum) if weight_sum else None,
                "heat_risk": round(float(cell_d["hard"][r, c] - cell_d["cooling"][r, c]), 3),  # -1 leafy .. +1 concrete
                "tree_pct": pct(cell_f["tree"][r, c]),
                "built_pct": pct(cell_f["built"][r, c]),
                "water_pct": pct(cell_f["water"][r, c]),
                "bare_pct": pct(cell_f["bare"][r, c]),
                "buildable_pct": pct(cell_d["buildable"][r, c]),
                "sensitive_pct": pct(cell_d["sensitive"][r, c]),
                "low_lying_pct": pct(cell_low[r, c]) if cell_low is not None else None,
                "people": round(float(people_cells[r, c])) if people_cells is not None else None,
                "main_cover": dominant_cover(cell_f, r, c),
            })
    return cells


def dominant_cover(cell_f, r, c):
    """Name of the land-cover group that covers most of a cell."""
    names = {"tree": "trees", "shrub": "shrubland", "grass": "grassland", "crop": "cropland", "built": "buildings",
             "bare": "bare land", "snow": "snow", "water": "water", "wetland": "wetland", "mangrove": "mangroves",
             "moss": "moss"}
    best = max(cell_f, key=lambda k: cell_f[k][r, c])  # group with the biggest share
    return names[best]


def pick_candidates(cells, count=3, min_buildable=35.0):
    """Best cells to build on: enough open land, not on water or forest, and spread apart (not neighbours)."""
    usable = [
        c for c in cells
        if c["score"] is not None  # we could score it
        and c["buildable_pct"] >= min_buildable  # enough open land to build on
        and c["water_pct"] < 50  # not a lake or the sea
        and c["sensitive_pct"] < MAX_CANDIDATE_SENSITIVE_PCT  # not forest, mangrove or wetland
    ]
    chosen = []
    for cell in sorted(usable, key=lambda c: -c["score"]):  # best first
        if all(max(abs(cell["row"] - o["row"]), abs(cell["col"] - o["col"])) >= 2 for o in chosen):  # not touching
            chosen.append(cell)
        if len(chosen) == count:
            break
    return [
        {**c, "rank": i + 1, "reason": f"Mostly {c['main_cover']}; {c['buildable_pct']:.0f}% open land, "
                                       f"{c['sensitive_pct']:.0f}% trees/wetland"
                                       + (f", ~{c['people']:,} residents" if c["people"] is not None else "")}
        for i, c in enumerate(chosen)
    ]


def pick_hotspots(cells, cell_km2, count=5):
    """Built-up cells with the most heat-absorbing surfaces and the least shade."""
    hot = [c for c in cells if c["built_pct"] >= 15 and c["tree_pct"] < CANOPY_TARGET * 100 and c["heat_risk"] > 0.2]
    hot.sort(key=lambda c: -c["heat_risk"])  # hottest first
    result = []
    for i, c in enumerate(hot[:count]):
        trees = (CANOPY_TARGET - c["tree_pct"] / 100) * cell_km2 * 1e6 / TREE_CROWN_M2  # trees to reach 30% canopy
        if c["built_pct"] >= 50:
            action = "street trees, shaded walkways and cool (light-coloured) roofs"
        elif c["bare_pct"] >= 20:
            action = "turn bare land into a shaded pocket park"
        else:
            action = "tree-lined streets and shaded paths"
        result.append({**c, "rank": i + 1, "trees_needed": int(round(trees, -1)), "action": action})
    return result


def red_flags(purpose, water, f, d, low, people, width_km, scores, candidates):
    """Serious problems that should stop or reshape a project."""
    flags = []
    if f["water"] >= 0.6:
        flags.append({"level": "high", "text": f"{pct(f['water'])}% of the area is sea, lakes or rivers — little land to build on."})
    if water and water["stress"] >= 0.8:
        flags.append({"level": "high", "text": "Severe water stress: demand would use most of the local rain-fed water."})
    if d["sensitive"] >= 0.4:
        flags.append({"level": "high", "text": f"{pct(d['sensitive'])}% tree cover, mangrove or wetland — clearing natural forest here would harm the ecosystem."})
    if low is not None and low >= 0.4:
        flags.append({"level": "high", "text": f"{pct(low)}% of the land is low-lying near water — high flood risk."})
    if purpose == "datacentre" and people is not None and people / width_km ** 2 >= 5000:
        flags.append({"level": "high", "text": "Dense housing nearby — noise, water and power competition with residents."})
    if purpose == "township" and scores["heat"] is not None and scores["heat"] < 30:
        flags.append({"level": "medium", "text": "Strong heat exposure — few trees and lots of heat-absorbing surfaces."})
    if not candidates and f["water"] < 0.6:
        flags.append({"level": "medium", "text": "No part of the area has enough open land away from trees and water — try a bigger area."})
    return flags


def make_verdict(overall, flags, missing_weight=0):
    """Turn the overall score, red flags and missing data into a short label."""
    serious = any(f["level"] == "high" for f in flags)  # at least one show-stopper
    if overall >= 70 and not serious and missing_weight < 30:  # high score that isn't hiding a big data gap
        verdict = {"level": "good", "label": "Good fit"}
    elif overall >= 50:  # decent score, or a high score held back by a red flag or missing data
        verdict = {"level": "caution", "label": "Possible with mitigation"}
    else:
        verdict = {"level": "poor", "label": "Not recommended"}
    if missing_weight:  # some factors couldn't be scored
        verdict["label"] += " (provisional)"
    return verdict


def recommendations(ctx):
    """Plain-language advice built from the measured numbers."""
    recs = []
    f, d, climate, water = ctx["area_f"], ctx["area_d"], ctx["climate"], ctx["water"]
    low, steep = ctx["area_low"], ctx["area_steep"]

    def add(tag, title, text):
        recs.append({"tag": tag, "title": title, "text": text})

    if ctx["purpose"] == "datacentre":
        if not water:
            add("water", "Check the water supply on site", "Rainfall data was unavailable, so confirm water rights and supply with the local utility.")
        elif water["stress"] >= 0.4:
            add("water", "Use water-free cooling",
                f"Local water is under pressure (about {water['stress'] * 100:.0f}% of rain-fed supply would be used). "
                "Choose air-cooled or closed-loop liquid cooling and use recycled water instead of drinking water.")
        elif water["stress"] >= 0.2:
            add("water", "Cut cooling water",
                "Combine evaporative cooling with rainwater harvesting and recycled water, and set a water-use target below 1.0 L/kWh.")
        else:
            add("water", "Water supply looks sufficient",
                f"Rain-fed supply comfortably covers the estimated {fmt_int(water['new_m3'])} m³ a year the data centre would use. "
                "Still meter water use and publish it.")
        if d["sensitive"] >= 0.2:
            add("nature", "Don't clear forest or wetland",
                f"{pct(d['sensitive'])}% of the area is tree cover, mangrove or wetland. Check on the ground which trees are natural forest "
                "(plantations also show as trees), build on the open-land spots marked on the map and keep a green buffer around them.")
        else:
            add("nature", "Low impact on nature", "The area is mostly open or already developed land, so little forest or wetland would be lost.")
        people = ctx["people_total"]
        if people is not None and people / ctx["width_km"] ** 2 >= 1000:
            add("people", "Keep a buffer from homes",
                f"About {fmt_int(people)} people live in the area. Keep at least 500 m from housing, use low-noise cooling and talk to the community early.")
        if climate and climate.get("mean_temp_c") is not None and climate["mean_temp_c"] >= 24:
            add("cooling", "Plan for a hot climate",
                f"An average of {climate['mean_temp_c']} °C leaves little free-air cooling. Use liquid cooling, run servers warmer and reuse waste heat.")
    else:
        hotspots = ctx["hotspots"]
        if hotspots:
            trees = sum(h["trees_needed"] for h in hotspots)
            add("heat", f"Cool {len(hotspots)} heat hotspot{'s' if len(hotspots) > 1 else ''}",
                f"The orange zones on the map have the most roofs and roads and the least shade. About {fmt_int(trees)} trees would bring them to 30% canopy.")
        if f["tree"] < CANOPY_TARGET:
            add("green", "Grow tree canopy to 30%",
                f"Canopy is {pct(f['tree'])}% today. Follow the 3-30-300 rule: 3 trees visible from every home, 30% canopy in every neighbourhood, a park within 300 m.")
        else:
            add("green", "Protect the existing canopy", f"Tree canopy is already {pct(f['tree'])}% — keep mature trees during construction.")
        if climate and climate.get("hottest_month_max_c") is not None and climate["hottest_month_max_c"] >= 32:
            add("heat", "Design for heat",
                f"The hottest month averages {climate['hottest_month_max_c']} °C highs. Use light-coloured roofs and paving, shaded walkways and covered bus stops.")
        if water and water["stress"] >= 0.4:
            add("water", "Save and store water", "Water is under pressure: fit rainwater harvesting, water-efficient fittings and grey-water recycling.")
        elif climate and climate.get("rain_mm_year") and climate["rain_mm_year"] >= 2000:
            add("water", "Make heavy rain an asset", "Use rain gardens, retention ponds and permeable paving to store storm water and cool the streets.")
        if d["sensitive"] >= 0.2:
            add("nature", "Keep forest as a green lung", f"Protect the {pct(d['sensitive'])}% tree cover, mangrove and wetland, and link it to parks with green corridors.")

    if low is not None and low >= 0.15:
        add("terrain", "Keep low land for parks and ponds",
            f"{pct(low)}% of the land is low-lying near water. Use it for parks and flood-retention ponds rather than buildings, and raise building platforms.")
    if steep is not None and steep >= 0.2:
        add("terrain", "Avoid steep slopes", f"{pct(steep)}% of the land is steep — building there risks landslides and costs more.")
    if ctx["candidates"]:
        best = ctx["candidates"][0]
        add("site", "Best spot in this area", f"Spot 1 scores {best['score']}/100: {best['reason']}. Click it on the map to zoom in.")
    return recs
