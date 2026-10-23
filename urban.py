# urban.py — urban heat and greening intelligence for one area, shaped exactly like the
# ClimateSearch dashboard's data types (ClimateZone, Hotspot, GreeningCandidate, ClimateMetric, ...).
#
# The area is split into a 12 x 12 grid of cells. For every cell we measure:
#   surface temperature  Landsat 8/9 thermal band (real, landsat.py), or an estimate when it's unavailable
#   vegetation / NDVI    Sentinel-2 (real, sentinel2.py), or ESA WorldCover when it's unavailable
#   land cover, people   ESA WorldCover 2021 and Meta HRSL (datasources.py)
# Then: 3 x 3 compass zones, heat hotspots (clusters of hot, bare, built-up cells), greening sites,
# headline numbers, map overlays and notifications. Every number says where it came from.

import base64  # map overlays travel inside JSON as base64 PNGs
import io  # in-memory files for the PNGs
import logging  # download problems go to the server log
import warnings  # silences "mean of empty slice" for cloudy cells
from concurrent.futures import ThreadPoolExecutor  # download all datasets at once
from datetime import datetime, timezone  # timestamps for notifications

import numpy as np  # maths on whole grids
from PIL import Image  # builds the overlay pictures
from scipy.ndimage import label  # groups touching hot cells into one hotspot

import datasources as ds  # land cover, population, climate and the shared Grid
import landsat  # real surface temperature
import sentinel2  # real NDVI
from analysis import cell_mean, CANOPY_TARGET, TREE_CROWN_M2  # shared helpers and planning constants

log = logging.getLogger(__name__)

CELLS = 12  # 12 x 12 cells
SECTORS = 3  # 3 x 3 compass zones (4 x 4 cells each)
LC_PX = 480  # land cover pixels across (40 per cell)
RS_PX = 240  # Landsat thermal pixels across (20 per cell; Landsat thermal is ~100 m, sharpened to 30 m)
NDVI_PX = 960  # Sentinel-2 pixels across (80 per cell): about 10 m, so a pixel is roof OR tree, not a mix
VEG_NDVI = 0.4  # NDVI at or above this counts as vegetated
MIN_REAL_COVERAGE = 0.5  # use a satellite layer only if at least half the area has a clear view
MAX_HOTSPOTS = 8  # hotspots listed
MAX_CANDIDATES = 6  # greening sites listed

# Estimated daytime surface temperature above the hottest-month air temperature, by WorldCover class (°C).
# Used only when Landsat thermal data is unavailable; typical midday contrasts reported for tropical cities.
SURFACE_OFFSET_C = {10: 1, 20: 4, 30: 5, 40: 4, 50: 9, 60: 10, 70: -8, 80: -3, 90: 1, 95: 0, 100: 2}
GREEN_CODES = [10, 20, 30, 40, 90, 95, 100]  # every vegetated WorldCover class

COMPASS_ROWS, COMPASS_COLS = ["North", "", "South"], ["West", "", "East"]
HEAT_COLOURS = [(0.0, (69, 184, 129)), (0.5, (244, 185, 66)), (1.0, (240, 82, 82))]  # the dashboard's green→amber→red
VEG_COLOURS = [(0.0, (223, 231, 239)), (0.5, (114, 200, 91)), (1.0, (35, 122, 83))]  # the dashboard's pale→green→dark


# ---------- Small helpers ----------

def nan_cell_mean(values, cells=CELLS):
    """Average of each cell ignoring NaN (no clear view), plus the share of pixels that had a value."""
    n = values.shape[0] // cells
    blocks = values.reshape(cells, n, cells, n)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN cells just stay NaN
        return np.nanmean(blocks, axis=(1, 3)), np.isfinite(blocks).mean(axis=(1, 3))


def compass(row, col, size):
    """'North-East', 'Central', ... for a (possibly fractional) row/column in a size x size grid."""
    r = COMPASS_ROWS[min(int(row * 3 / size), 2)]
    c = COMPASS_COLS[min(int(col * 3 / size), 2)]
    return "-".join(x for x in (r, c) if x) or "Central"


def severity_of(priority):
    """The dashboard's three severity levels from a 0-100 priority score."""
    return "high" if priority >= 70 else "medium" if priority >= 45 else "low"


def colour_png(values, lo, hi, stops):
    """Colour a grid with a 3-stop ramp (NaN = transparent) and return a PNG data URL."""
    t = np.nan_to_num(np.clip((values - lo) / max(hi - lo, 1e-6), 0, 1))  # NaN -> 0 (made transparent below)
    rgba = np.zeros(values.shape + (4,), dtype=np.uint8)
    for i in range(3):  # red, green, blue channels interpolated between the stops
        rgba[..., i] = np.interp(t, [s[0] for s in stops], [s[1][i] for s in stops])
    rgba[..., 3] = np.where(np.isfinite(values), 210, 0)  # mostly opaque, see-through where no data
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def fmt_date(iso):
    """'2026-08-14' -> '14 Aug 2026'."""
    try:
        return datetime.strptime(iso[:10], "%Y-%m-%d").strftime("%d %b %Y").lstrip("0")
    except (TypeError, ValueError):
        return iso


# ---------- Surface temperature ----------

def estimated_surface_temp(codes, base_c):
    """Estimated midday surface temperature from land cover and the hottest-month air temperature."""
    offsets = np.zeros(codes.shape, dtype="float32")
    for code, offset in SURFACE_OFFSET_C.items():
        offsets[codes == code] = offset
    n = codes.shape[0] // RS_PX  # land-cover pixels per satellite pixel
    smoothed = offsets.reshape(RS_PX, n, RS_PX, n).mean(axis=(1, 3))  # average onto the Landsat-sized grid
    return (base_c + smoothed).astype("float32")


def surface_temperature(landsat_out, codes, climate):
    """Pick the best temperature source. Returns (grid in °C or None, provenance dict)."""
    base = climate.get("hottest_month_max_c") if climate else None
    if landsat_out and landsat_out["coverage"] >= MIN_REAL_COVERAGE:
        lst = landsat_out["lst"].copy()
        scenes = landsat_out["scenes"]
        gaps = ~np.isfinite(lst)
        note = None
        if gaps.any() and base is not None:  # fill cloud gaps with the estimate, shifted to match the real readings
            estimate = estimated_surface_temp(codes, base)
            shift = float(np.nanmean(lst) - estimate[~gaps].mean())
            lst[gaps] = estimate[gaps] + shift
            note = f"{gaps.mean() * 100:.0f}% cloud gaps filled with a land-cover model"
        platforms = sorted({s["platform"] for s in scenes})
        return lst, {
            "kind": "landsat",
            "label": f"{' & '.join(platforms)} thermal · {fmt_date(scenes[0]['date'])}",
            "sensor": f"{' & '.join(platforms)} TIRS (Collection 2 surface temperature, 30 m)",
            "dates": [s["date"] for s in scenes],
            "note": note,
            "isEstimate": False,
        }
    if base is not None:
        return estimated_surface_temp(codes, base), {
            "kind": "estimate",
            "label": "Estimated (NASA air temperature + land cover)",
            "sensor": "Model: NASA POWER hottest-month air temperature + ESA WorldCover surface type (±3 °C)",
            "dates": [],
            "note": "Landsat thermal data was unavailable, so surface temperature is estimated",
            "isEstimate": True,
        }
    return None, {"kind": "none", "label": "Unavailable", "sensor": "No temperature source reachable", "dates": [],
                  "note": "Neither Landsat nor NASA POWER could be reached", "isEstimate": True}


def vegetation(s2_out, codes):
    """Vegetated (1) or not (0) per ~10 m pixel, and NDVI. Returns (veg grid, ndvi grid or None, provenance dict)."""
    n = NDVI_PX // codes.shape[0]  # Sentinel-2 pixels per land-cover pixel
    green = np.isin(codes, GREEN_CODES).repeat(n, axis=0).repeat(n, axis=1).astype("float32")  # WorldCover, same grid
    if s2_out and s2_out["coverage"] >= MIN_REAL_COVERAGE:
        ndvi = s2_out["ndvi"]
        veg = np.where(np.isfinite(ndvi), (ndvi >= VEG_NDVI).astype("float32"), green)  # gaps fall back to WorldCover
        first = s2_out["scenes"][0]
        return veg, ndvi, {
            "kind": "sentinel2",
            "label": f"{first['platform']} NDVI · {fmt_date(first['date'])}",
            "sensor": "Sentinel-2 MSI Level-2A, 10 m (NDVI ≥ 0.4 counts as vegetated)",
            "dates": [s["date"] for s in s2_out["scenes"]],
            "isEstimate": False,
        }
    return green, None, {
        "kind": "worldcover",
        "label": "ESA WorldCover 2021",
        "sensor": "ESA WorldCover 2021 land cover, 10 m (Sentinel-1/2)",
        "dates": ["2021-12-31"],
        "isEstimate": False,
    }


# ---------- Cells ----------

def build_cells(grid, codes, temp, veg, ndvi, people):
    """Per-cell measurements and priority scores."""
    lc = lambda codes_list: cell_mean(np.isin(codes, codes_list), CELLS) * 100  # % of each cell
    built, bare, tree, water = lc([50]), lc([60]), lc([10]), lc([80])
    grass, crop, shrub = lc([30]), lc([40]), lc([20])
    green_lc = lc(GREEN_CODES)
    cell_temp = nan_cell_mean(temp)[0] if temp is not None else np.full((CELLS, CELLS), np.nan)
    cell_veg = nan_cell_mean(veg)[0] * 100
    cell_ndvi = nan_cell_mean(ndvi)[0] if ndvi is not None else np.full((CELLS, CELLS), np.nan)
    cell_km = grid.width_km / CELLS
    density = people / cell_km ** 2 if people is not None else None

    finite = cell_temp[np.isfinite(cell_temp)]
    median = float(np.median(finite)) if finite.size else None
    tmax = float(finite.max()) if finite.size else None
    heat_rel = np.interp(cell_temp, [median, tmax], [0, 100]) if median is not None and tmax > median else np.zeros_like(cell_temp)
    heat_abs = np.interp(cell_temp, [28, 42], [0, 100])  # how hot in absolute terms
    heat = np.where(np.isfinite(cell_temp), 0.5 * heat_rel + 0.5 * heat_abs, 0)
    veg_deficit = np.interp(cell_veg, [0, 40], [100, 0])  # under 40% vegetation is a deficit
    exposure = np.interp(density, [0, 10000], [0, 100]) if density is not None else np.full((CELLS, CELLS), 50.0)
    priority = 0.45 * heat + 0.35 * veg_deficit + 0.20 * exposure

    lat_step = (grid.north - grid.south) / CELLS
    lon_step = (grid.east - grid.west) / CELLS
    cells = []
    for r in range(CELLS):
        for c in range(CELLS):
            north, west = grid.north - r * lat_step, grid.west + c * lon_step
            shares = {"built": built[r, c], "bare": bare[r, c], "trees": tree[r, c], "water": water[r, c],
                      "grass": grass[r, c], "crops": crop[r, c], "shrubs": shrub[r, c]}
            cells.append({
                "row": r, "col": c,
                "bounds": [[north - lat_step, west], [north, west + lon_step]],
                "center": {"lat": north - lat_step / 2, "lng": west + lon_step / 2},
                "surfaceTemp": None if not np.isfinite(cell_temp[r, c]) else round(float(cell_temp[r, c]), 1),
                "vegetationCoverage": round(float(cell_veg[r, c])),
                "ndvi": None if not np.isfinite(cell_ndvi[r, c]) else round(float(cell_ndvi[r, c]), 2),
                "builtPct": round(float(built[r, c])), "barePct": round(float(bare[r, c])),
                "treePct": round(float(tree[r, c])), "waterPct": round(float(water[r, c])),
                "openPct": round(float(bare[r, c] + grass[r, c] + shrub[r, c])),  # ground free to plant on
                "cropPct": round(float(crop[r, c])),
                "greenPct": round(float(green_lc[r, c])),
                "people": None if people is None else int(round(float(people[r, c]))),
                "priorityScore": int(round(float(priority[r, c]))),
                "severity": severity_of(priority[r, c]),
                "mainCover": max(shares, key=shares.get),
            })
    return cells, {"median": median, "max": tmax, "min": float(finite.min()) if finite.size else None,
                   "p75": float(np.percentile(finite, 75)) if finite.size else None,
                   "p90": float(np.percentile(finite, 90)) if finite.size else None}


def character(cell_like):
    """A short description of a place from its land cover."""
    if cell_like["waterPct"] >= 40:
        return "Waterfront"
    if cell_like["treePct"] >= 50:
        return "Green Belt"
    if cell_like["builtPct"] >= 55:
        return "Dense Urban"
    if cell_like["builtPct"] >= 30:
        return "Urban Mix"
    if cell_like.get("cropPct", 0) >= 35:
        return "Farmland Edge"
    if cell_like["barePct"] >= 25:
        return "Open Ground"
    return "Green Edge" if cell_like["greenPct"] >= 50 else "Mixed Land"


def merge_cells(group):
    """Average a group of cells into one place (temperatures, shares, people summed)."""
    temps = [c["surfaceTemp"] for c in group if c["surfaceTemp"] is not None]
    ndvis = [c["ndvi"] for c in group if c["ndvi"] is not None]
    mean = lambda key: sum(c[key] for c in group) / len(group)
    people = [c["people"] for c in group if c["people"] is not None]
    south = min(c["bounds"][0][0] for c in group)
    west = min(c["bounds"][0][1] for c in group)
    north = max(c["bounds"][1][0] for c in group)
    east = max(c["bounds"][1][1] for c in group)
    return {
        "surfaceTemp": round(sum(temps) / len(temps), 1) if temps else None,
        "maxTemp": max(temps) if temps else None,
        "ndvi": round(sum(ndvis) / len(ndvis), 2) if ndvis else None,
        "vegetationCoverage": round(mean("vegetationCoverage")),
        "builtPct": round(mean("builtPct")), "barePct": round(mean("barePct")), "treePct": round(mean("treePct")),
        "waterPct": round(mean("waterPct")), "openPct": round(mean("openPct")), "greenPct": round(mean("greenPct")),
        "cropPct": round(mean("cropPct")),
        "people": sum(people) if people else None,
        "priorityScore": round(mean("priorityScore")),
        "bounds": [[south, west], [north, east]],
        "coordinates": {"lat": sum(c["center"]["lat"] for c in group) / len(group),
                        "lng": sum(c["center"]["lng"] for c in group) / len(group)},
        "row": sum(c["row"] for c in group) / len(group), "col": sum(c["col"] for c in group) / len(group),
    }


# ---------- Zones, hotspots and greening sites ----------

def build_zones(cells, ctx):
    """3 x 3 compass zones (ClimateZone)."""
    step = CELLS // SECTORS
    zones = []
    for zr in range(SECTORS):
        for zc in range(SECTORS):
            group = [c for c in cells if c["row"] // step == zr and c["col"] // step == zc]
            z = merge_cells(group)
            where = compass(zr, zc, SECTORS)
            zones.append({
                "id": f"z-{where.lower()}",
                "name": f"{where} {character(z)}",
                "location": f"{where} · {ctx['short_name']}",
                "coordinates": z["coordinates"],
                "surfaceTemp": z["surfaceTemp"],
                "vegetationCoverage": z["vegetationCoverage"],
                "ndvi": z["ndvi"],
                "severity": severity_of(z["priorityScore"]),
                "priorityScore": z["priorityScore"],
                "lastUpdated": ctx["updated"],
                "dataSource": ctx["data_source"],
                "bounds": z["bounds"],
                "builtPct": z["builtPct"], "treePct": z["treePct"], "people": z["people"],
            })
    return zones


def hotspot_factors(h, stats):
    """'Contributing factors' worded from the measurements (hypotheses, not proof)."""
    out = []
    if h["builtPct"] >= 30:
        out.append(f"{h['builtPct']}% of the ground is roofs and roads (heat-absorbing hard surfaces)")
    if h["barePct"] >= 15:
        out.append(f"{h['barePct']}% bare or cleared ground with no shade")
    if h["treePct"] < 30:
        out.append(f"Only {h['treePct']}% tree canopy (3-30-300 target: 30%)")
    if h["surfaceTemp"] is not None and stats["median"] is not None:
        out.append(f"Surface {h['surfaceTemp'] - stats['median']:+.1f}°C compared with the area's median")
    if h["people"]:
        out.append(f"About {h['people']:,} residents live in this patch")
    if h["waterPct"] < 2:
        out.append("Little open water nearby to cool the air")
    return out[:5]


def hotspot_actions(h, area_km2):
    """Mitigations suited to what the patch is made of."""
    trees = max(0, round((CANOPY_TARGET - h["treePct"] / 100) * area_km2 * 1e6 / TREE_CROWN_M2, -1))
    out = []
    if h["builtPct"] >= 40:
        out += ["Street-tree planting along main roads and walkways", "Cool-roof programme (light, reflective roofs)",
                "Shaded pedestrian walkways and covered bus stops"]
    if h["barePct"] >= 15:
        out.append("Turn bare or cleared ground into shaded pocket parks")
    if trees:
        out.append(f"Plant about {int(trees):,} trees to reach 30% canopy")
    if h["builtPct"] + h["barePct"] >= 60:
        out.append("Permeable paving and rain gardens for evaporative cooling")
    return out[:4] or ["Protect existing shade and vegetation"]


def build_hotspots(cells, stats, ctx):
    """Clusters of hot cells with little vegetation and mostly hard surfaces (Hotspot)."""
    if stats["median"] is None:
        return []
    threshold = max(stats["p75"], stats["median"] + 1.0)  # top quarter of the area and at least 1°C above median
    hot = np.zeros((CELLS, CELLS), dtype=bool)
    for c in cells:
        if (c["surfaceTemp"] is not None and c["surfaceTemp"] >= threshold and c["vegetationCoverage"] < 30
                and c["builtPct"] + c["barePct"] >= 25):
            hot[c["row"], c["col"]] = True
    labels, count = label(hot)  # touching hot cells form one hotspot
    by_pos = {(c["row"], c["col"]): c for c in cells}
    cell_km2 = (ctx["width_km"] / CELLS) ** 2
    raw = []
    for n in range(1, count + 1):
        group = [by_pos[(r, c)] for r, c in zip(*np.nonzero(labels == n))]
        h = merge_cells(group)
        h["cells"] = [{"row": c["row"], "col": c["col"], "bounds": c["bounds"]} for c in group]
        h["area"] = round(len(group) * cell_km2, 2)
        raw.append(h)
    raw.sort(key=lambda h: (-h["priorityScore"], -(h["surfaceTemp"] or 0)))
    hotspots, names = [], {}
    for i, h in enumerate(raw[:MAX_HOTSPOTS]):
        kind = ("Dense Urban Core" if h["builtPct"] >= 55 else "Cleared Land" if h["barePct"] >= 25
                else "Built-up District" if h["builtPct"] >= 30 else "Heat Patch")
        name = f"{compass(h['row'], h['col'], CELLS)} {kind}"
        names[name] = names.get(name, 0) + 1  # second "North-West Dense Urban Core" becomes "... Core 2"
        name = name if names[name] == 1 else f"{name} {names[name]}"
        high = h["surfaceTemp"] is not None and h["surfaceTemp"] >= ctx["critical"]
        hotspots.append({
            "id": f"h{i + 1}",
            "name": name,
            "location": f"{compass(h['row'], h['col'], CELLS)} · {ctx['short_name']}",
            "coordinates": h["coordinates"],
            "surfaceTemp": h["surfaceTemp"],
            "vegetationCoverage": h["vegetationCoverage"],
            "severity": "high" if high else severity_of(h["priorityScore"]),
            "priorityScore": h["priorityScore"],
            "lastUpdated": ctx["updated"],
            "dataSource": ctx["data_source"],
            "area": h["area"],
            "contributing_factors": hotspot_factors(h, ctx["stats"]),
            "mitigation_suggestions": hotspot_actions(h, h["area"]),
            "imageDate": ctx["temp_date"],
            "bounds": h["bounds"], "cells": h["cells"], "people": h["people"],
            "builtPct": h["builtPct"], "treePct": h["treePct"], "barePct": h["barePct"],
        })
    return hotspots


def greening_type(place):
    """Which greening intervention fits a place, and how many hectares it could use."""
    area_ha = place["area_km2"] * 100
    if place["barePct"] + place["openPct"] / 2 >= 20:
        ha = min(area_ha * (place["barePct"] + place["openPct"]) / 100 * 0.25, 20)  # a quarter of the open ground, at most 20 ha
        return "Pocket Park Site", ha, f"Convert about {ha:.1f} ha of bare or grassy ground into shaded pocket parks with native trees."
    if place["builtPct"] >= 70 and place["openPct"] < 10:
        ha = area_ha * place["builtPct"] / 100 * 0.05
        return "Rooftop Greening Network", ha, f"Green or cool-coat about {ha:.1f} ha of large flat roofs; there is little open ground left."
    ha = area_ha * place["builtPct"] / 100 * 0.08
    trees = max(0, round((CANOPY_TARGET - place["treePct"] / 100) * place["area_km2"] * 1e6 / TREE_CROWN_M2, -1))
    return ("Street-Tree Corridor", ha,
            f"Plant about {int(trees):,} shade trees along streets and walkways (~{ha:.1f} ha of verges) to lift canopy towards 30%.")


def build_greening(cells, hotspots, stats, ctx):
    """Greening sites: one per hotspot, then other hot, bare-of-green cells (GreeningCandidate)."""
    cell_km2 = (ctx["width_km"] / CELLS) ** 2
    places = []
    by_pos = {(c["row"], c["col"]): c for c in cells}
    for h in hotspots:  # every hotspot gets a greening plan
        own = [by_pos[(hc["row"], hc["col"])] for hc in h["cells"]]
        places.append({**h, "area_km2": h["area"], "hotspot": h,
                       "openPct": round(sum(c["openPct"] for c in own) / len(own)),
                       "row": sum(c["row"] for c in own) / len(own), "col": sum(c["col"] for c in own) / len(own)})
    taken = {(hc["row"], hc["col"]) for h in hotspots for hc in h["cells"]}
    extra = [c for c in cells if (c["row"], c["col"]) not in taken and c["priorityScore"] >= 50
             and c["vegetationCoverage"] < 35 and c["waterPct"] < 50]
    extra.sort(key=lambda c: -c["priorityScore"])
    for c in extra:
        if len(places) >= MAX_CANDIDATES:
            break
        if any(abs(c["row"] - p["row"]) + abs(c["col"] - p["col"]) < 2 for p in places):  # keep sites spread out
            continue
        places.append({**c, "coordinates": c["center"], "area_km2": cell_km2, "hotspot": None})
    out = []
    for i, p in enumerate(places[:MAX_CANDIDATES]):
        kind, ha, action = greening_type(p)
        nearest = p["hotspot"] or (min(hotspots, key=lambda h: (h["coordinates"]["lat"] - p["coordinates"]["lat"]) ** 2
                                       + (h["coordinates"]["lng"] - p["coordinates"]["lng"]) ** 2) if hotspots else None)
        temp = p["surfaceTemp"]
        anomaly = f" ({temp - stats['median']:+.1f}°C vs area median)" if temp is not None and stats["median"] is not None else ""
        people = f" About {p['people']:,} residents live here." if p.get("people") else ""
        out.append({
            "id": f"g{i + 1}",
            "name": f"{compass(p['row'], p['col'], CELLS)} {kind}",
            "location": f"{compass(p['row'], p['col'], CELLS)} · {ctx['short_name']}",
            "coordinates": p["coordinates"],
            "currentVegetation": p["vegetationCoverage"],
            "surfaceTemp": temp,
            "priorityScore": p["priorityScore"],
            "severity": severity_of(p["priorityScore"]),
            "candidateArea": round(max(ha, 0.1), 1),
            "reasoning": (f"Surface temperature {temp}°C{anomaly} with only {p['vegetationCoverage']}% vegetation and "
                          f"{p['builtPct'] + p['barePct']}% hard or bare ground.{people}") if temp is not None else
                         f"Only {p['vegetationCoverage']}% vegetation and {p['builtPct'] + p['barePct']}% hard or bare ground.{people}",
            "recommendedAction": action,
            "status": "identified",
            "nearestHotspotId": nearest["id"] if nearest else None,
            "dataSource": ctx["data_source"],
            "lastUpdated": ctx["updated"],
            "interventionType": kind,
            "bounds": p["bounds"],
        })
    return out


def build_metrics(cells, hotspots, candidates, ctx):
    """The four headline cards (ClimateMetric)."""
    temps = [c["surfaceTemp"] for c in cells if c["surfaceTemp"] is not None]
    avg = round(sum(temps) / len(temps), 1) if temps else None
    veg = round(sum(c["vegetationCoverage"] for c in cells) / len(cells))
    temp_source = ctx["prov"]["surfaceTemp"]
    return [
        {"id": "m1", "label": "Average Surface Temperature",
         "value": avg if avg is not None else "–", "unit": "°C" if temps else "",
         "description": ("Mean daytime land surface temperature across the area from "
                         f"{temp_source['sensor']}, clouds removed." if not temp_source["isEstimate"] else
                         "Estimated midday surface temperature (NASA hottest-month air temperature plus land-cover offsets); "
                         "Landsat thermal data was unavailable."),
         "dataSource": temp_source["label"], "isDemo": False,
         "severity": None if avg is None else "high" if avg >= 35 else "medium" if avg >= 30 else "low"},
        {"id": "m2", "label": "Average Vegetation Coverage", "value": veg, "unit": "%",
         "description": "Share of the area covered by vegetation (trees, grass, crops and other green cover) "
                        f"from {ctx['prov']['vegetation']['sensor']}.",
         "dataSource": ctx["prov"]["vegetation"]["label"], "isDemo": False},
        {"id": "m3", "label": "Potential Heat Hotspots", "value": len(hotspots), "unit": "",
         "description": (f"Clusters at or above {ctx['hot_threshold']:.1f}°C (the area's hottest quarter) with under 30% "
                         "vegetation and mostly hard or bare ground." if ctx["hot_threshold"] is not None else
                         "Hotspots need a surface temperature source."),
         "dataSource": temp_source["label"], "isDemo": False},
        {"id": "m4", "label": "Zones in Pilot", "value": len(candidates), "unit": "",
         "description": "Candidate sites identified for greening pilots by the rule-based screening.",
         "dataSource": "ClimateSmart AI screening", "isDemo": False},
    ]


def build_notifications(hotspots, candidates, ctx):
    """Platform notifications describing this analysis."""
    now = datetime.now(timezone.utc).isoformat()
    out = [{"id": "n-ready", "title": "Analysis ready", "type": "success", "read": False, "route": "/overview",
            "timestamp": now, "message": f"Satellite analysis for {ctx['short_name']} is ready."}]
    top = next((h for h in hotspots if h["severity"] == "high"), None)
    if top:
        out.insert(0, {"id": f"n-{top['id']}", "title": "New hotspot detected", "type": "warning", "read": False,
                       "route": "/hotspots", "timestamp": now,
                       "message": f"{top['name']} reached {top['surfaceTemp']}°C, above the {ctx['critical']:.1f}°C critical threshold."})
    if candidates:
        out.append({"id": "n-greening", "title": "Greening sites identified", "type": "info", "read": False,
                    "route": "/greening", "timestamp": now,
                    "message": f"{len(candidates)} candidate sites totalling {sum(c['candidateArea'] for c in candidates):.1f} ha."})
    if ctx["prov"]["surfaceTemp"]["isEstimate"]:
        out.append({"id": "n-estimate", "title": "Temperature is estimated", "type": "info", "read": False,
                    "route": "/settings", "timestamp": now, "message": ctx["prov"]["surfaceTemp"]["note"]})
    return out


def correlation(cells):
    """Pearson r between vegetation and temperature across cells (None if it can't be computed)."""
    pairs = [(c["vegetationCoverage"], c["surfaceTemp"]) for c in cells if c["surfaceTemp"] is not None]
    if len(pairs) < 5:
        return None
    v, t = np.array(pairs, dtype=float).T
    if v.std() == 0 or t.std() == 0:
        return None
    return round(float(np.corrcoef(v, t)[0, 1]), 2)


# ---------- Main entry point ----------

def analyse_area(lat, lon, width_km=10, name=None, location=None, start=None, end=None):
    """Everything the dashboard shows for one area. start/end (dates) limit the satellite search window."""
    grid = ds.Grid(lat, lon, width_km, LC_PX)
    rs_grid = grid.resized(RS_PX)
    warnings_out = []
    with ThreadPoolExecutor(max_workers=5) as pool:
        jobs = {
            "landcover": pool.submit(ds.read_landcover, grid),
            "people": pool.submit(ds.read_population, grid.resized(CELLS)),
            "climate": pool.submit(ds.read_climate, lat, lon),
            "ndvi": pool.submit(sentinel2.read_ndvi, grid.resized(NDVI_PX), start, end),
            "lst": pool.submit(landsat.read_lst, rs_grid, start, end),
        }
    got = {}
    for key, job in jobs.items():
        try:
            got[key] = job.result()
        except ds.DataUnavailable as err:
            got[key] = None
            log.warning("%s unavailable: %s", key, err)
            warnings_out.append({"landcover": "Land cover (ESA WorldCover)", "people": "Population (Meta HRSL)",
                                 "climate": "Climate (NASA POWER)", "ndvi": "Vegetation imagery (Sentinel-2)",
                                 "lst": "Thermal imagery (Landsat 8/9)"}[key] + " could not be downloaded")
    if got["landcover"] is None:
        raise ds.DataUnavailable("ESA WorldCover land cover could not be downloaded")
    codes = got["landcover"]
    people = got["people"][0] if got["people"] and got["people"][1] else None

    temp, temp_prov = surface_temperature(got["lst"], codes, got["climate"])
    veg, ndvi, veg_prov = vegetation(got["ndvi"], codes)
    cells, stats = build_cells(grid, codes, temp, veg, ndvi, people)

    dates = sorted(temp_prov["dates"] + [d for d in veg_prov["dates"] if veg_prov["kind"] == "sentinel2"], reverse=True)
    updated = dates[0] if dates else datetime.now(timezone.utc).date().isoformat()
    short_name = name.split(",")[0].strip() if name else f"{lat:.3f}°, {lon:.3f}°"  # "Shah Alam, Selangor" -> "Shah Alam"
    sensors = [s for s, ok in (("Sentinel-2", veg_prov["kind"] == "sentinel2"),
                               (temp_prov["label"].split(" thermal")[0], temp_prov["kind"] == "landsat")) if ok]
    prov = {"surfaceTemp": temp_prov, "vegetation": veg_prov,
            "landcover": "ESA WorldCover 2021 (10 m)", "population": "Meta High Resolution Settlement Layer (30 m)",
            "climate": "NASA POWER climatology" if got["climate"] else None,
            "updated": updated, "sensorsLabel": " & ".join(sensors) or "ESA WorldCover"}
    critical = round(max(stats["p90"], stats["median"] + 2), 1) if stats["median"] is not None else None
    ctx = {
        "short_name": short_name, "width_km": width_km, "updated": updated, "stats": stats, "prov": prov,
        "critical": critical, "hot_threshold": max(stats["p75"], stats["median"] + 1.0) if stats["median"] is not None else None,
        "temp_date": temp_prov["dates"][0] if temp_prov["dates"] else updated,
        "data_source": " · ".join(x for x in (temp_prov["label"], veg_prov["label"]) if x),
    }

    zones = build_zones(cells, ctx)
    hotspots = build_hotspots(cells, stats, ctx)
    candidates = build_greening(cells, hotspots, stats, ctx)
    overlays = {}
    if temp is not None:
        lo, hi = float(np.nanpercentile(temp, 2)), float(np.nanpercentile(temp, 98))
        overlays["temperature"] = {"url": colour_png(temp, lo, hi, HEAT_COLOURS), "bounds": grid.bounds,
                                   "min": round(lo, 1), "max": round(hi, 1), "unit": "°C", "label": temp_prov["label"]}
    veg_layer = ndvi if ndvi is not None else veg
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-cloud blocks stay NaN (transparent)
        k = veg_layer.shape[0] // RS_PX  # shrink to the thermal grid size; keeps the PNG small
        veg_layer = np.nanmean(veg_layer.reshape(RS_PX, k, RS_PX, k), axis=(1, 3))
    overlays["vegetation"] = {"url": colour_png(veg_layer, 0.0, 0.8 if ndvi is not None else 1.0, VEG_COLOURS),
                              "bounds": grid.bounds, "min": 0, "max": 0.8 if ndvi is not None else 100,
                              "unit": "NDVI" if ndvi is not None else "%", "label": veg_prov["label"]}
    return {
        "area": {"name": short_name, "location": location or name or short_name,
                 "coordinates": {"lat": lat, "lng": lon}, "widthKm": width_km, "cellKm": width_km / CELLS,
                 "bounds": {"north": grid.north, "south": grid.south, "east": grid.east, "west": grid.west}},
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "metrics": build_metrics(cells, hotspots, candidates, ctx),
        "zones": zones,
        "hotspots": hotspots,
        "greeningCandidates": candidates,
        "cells": cells,
        "correlation": correlation(cells),
        "thresholds": {"hotspot": None if ctx["hot_threshold"] is None else round(ctx["hot_threshold"], 1),
                       "critical": critical, "tempMin": None if stats["min"] is None else round(stats["min"], 1),
                       "tempMax": None if stats["max"] is None else round(stats["max"], 1)},
        "overlays": overlays,
        "notifications": build_notifications(hotspots, candidates, ctx),
        "provenance": prov,
        "climate": got["climate"],
        "warnings": warnings_out,
    }
