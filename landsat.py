# landsat.py — real land surface temperature (LST) from Landsat 8 and 9.
# Uses the Collection 2 Level-2 "surface temperature" band (ST_B10, from the thermal infrared sensor),
# which Microsoft Planetary Computer serves free of charge (no account or key; it hands out a
# short-lived read token). Clouds are removed with the scene's own quality mask.

import time  # remembers when the read token expires
from datetime import date, timedelta  # the time window to search

import numpy as np  # maths on whole grids
import rasterio  # reads the Cloud-Optimised GeoTIFFs
import requests  # talks to the catalogue (STAC) API
from rasterio.enums import Resampling  # how pixels are combined when shrinking
from rasterio.errors import RasterioIOError  # error when a file can't be opened
from rasterio.vrt import WarpedVRT  # re-projects a scene onto our lat/lon grid

from datasources import HEADERS, DataUnavailable  # shared settings and error type

STAC_SEARCH_URL = "https://planetarycomputer.microsoft.com/api/stac/v1/search"  # catalogue search
TOKEN_URL = "https://planetarycomputer.microsoft.com/api/sas/v1/token/landsat-c2-l2"  # free read token
COLLECTION = "landsat-c2-l2"  # Landsat Collection 2, Level-2 (surface reflectance + surface temperature)
TIMEOUT = 30  # seconds per web request
SEARCH_DAYS = 365  # look back up to a year for clear scenes
MAX_CLOUD = 50  # skip scenes more than half cloudy
MAX_SCENES = 4  # stitch at most this many scenes together
TARGET_COVERAGE = 0.9  # stop once 90% of the area has a clear reading

ST_SCALE, ST_OFFSET = 0.00341802, 149.0  # stored number -> kelvin (USGS Collection 2 constants)
# QA_PIXEL bit flags that mean "don't trust this pixel": no data, dilated cloud, cirrus, cloud, cloud shadow.
BAD_QA_BITS = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4)

_token = {"value": None, "expires": 0.0}  # cached read token


def read_token():
    """A short-lived token that lets us read the Landsat files (reused until it nearly expires)."""
    if _token["value"] and time.time() < _token["expires"]:
        return _token["value"]
    res = requests.get(TOKEN_URL, headers=HEADERS, timeout=TIMEOUT)
    res.raise_for_status()
    _token["value"] = res.json()["token"]  # e.g. "st=...&se=...&sig=..."
    _token["expires"] = time.time() + 30 * 60  # tokens last about an hour; refresh after 30 minutes
    return _token["value"]


def signed(href, token):
    """Add the read token to a file address."""
    return href + ("&" if "?" in href else "?") + token


def search_scenes(bounds, start, end):
    """Landsat 8/9 scenes over an area, clearest first. bounds = (west, south, east, north)."""
    body = {
        "collections": [COLLECTION],
        "bbox": list(bounds),
        "datetime": f"{start.isoformat()}T00:00:00Z/{end.isoformat()}T23:59:59Z",
        "query": {"eo:cloud_cover": {"lt": MAX_CLOUD}, "platform": {"in": ["landsat-8", "landsat-9"]}},
        "sortby": [{"field": "properties.eo:cloud_cover", "direction": "asc"}],
        "limit": 12,
    }
    res = requests.post(STAC_SEARCH_URL, json=body, headers=HEADERS, timeout=TIMEOUT)
    res.raise_for_status()
    return res.json().get("features", [])


def _asset(item, key, suffix):
    """Find an asset by its catalogue name, or by its file name ending as a fallback."""
    assets = item.get("assets", {})
    if key in assets:
        return assets[key]
    return next((a for a in assets.values() if a.get("href", "").upper().split("?")[0].endswith(suffix)), None)


def _scale_offset(asset):
    """Scale and offset from the catalogue entry if given, else the standard USGS values."""
    band = (asset.get("raster:bands") or [{}])[0]
    return float(band.get("scale", ST_SCALE)), float(band.get("offset", ST_OFFSET))


def _read(url, grid, resampling):
    """One file on our grid; 0 where it has no data."""
    with rasterio.open("/vsicurl/" + url) as src:
        with WarpedVRT(src, crs="EPSG:4326", transform=grid.transform, width=grid.size, height=grid.size,
                       resampling=resampling, nodata=0) as vrt:
            return vrt.read(1)


def scene_lst(item, grid, token):
    """Surface temperature in °C for one scene on the grid; NaN where cloudy or outside the scene."""
    st_asset, qa_asset = _asset(item, "lwir11", "_ST_B10.TIF"), _asset(item, "qa_pixel", "_QA_PIXEL.TIF")
    if not st_asset or not qa_asset:
        raise KeyError("scene has no surface temperature band")
    scale, offset = _scale_offset(st_asset)
    st = _read(signed(st_asset["href"], token), grid, Resampling.bilinear).astype("float64")
    qa = _read(signed(qa_asset["href"], token), grid, Resampling.nearest).astype("uint16")
    clear = (st > 0) & ((qa & BAD_QA_BITS) == 0)  # has data and no cloud/shadow flags
    celsius = st * scale + offset - 273.15  # stored number -> kelvin -> °C
    return np.where(clear, celsius, np.nan).astype("float32")


def read_lst(grid, start=None, end=None):
    """Clear-sky land surface temperature for the grid from the clearest recent Landsat 8/9 scenes.

    Returns {"lst": array in °C (NaN = no clear view), "coverage": 0-1, "scenes": [{id, date, platform, cloud}]}.
    """
    end = end or date.today()
    start = start or end - timedelta(days=SEARCH_DAYS)
    try:
        items = search_scenes((grid.west, grid.south, grid.east, grid.north), start, end)
        token = read_token() if items else None
    except (requests.RequestException, ValueError, KeyError) as err:
        raise DataUnavailable(f"Landsat catalogue: {err}") from err
    lst = np.full((grid.size, grid.size), np.nan, dtype="float32")
    used = []
    for item in items:
        try:
            fresh = scene_lst(item, grid, token)
        except (RasterioIOError, KeyError):
            continue  # missing or unreadable file: try the next scene
        gap = np.isnan(lst) & ~np.isnan(fresh)  # pixels this scene can fill
        if gap.mean() > 0.01:
            lst[gap] = fresh[gap]
            props = item.get("properties", {})
            used.append({"id": item.get("id"), "date": str(props.get("datetime", ""))[:10],
                         "platform": str(props.get("platform", "landsat")).replace("landsat-", "Landsat "),
                         "cloud": props.get("eo:cloud_cover")})
        if (~np.isnan(lst)).mean() >= TARGET_COVERAGE or len(used) >= MAX_SCENES:
            break
    if not used:
        raise DataUnavailable("No clear Landsat surface-temperature scene for this area in the last year")
    return {"lst": lst, "coverage": float((~np.isnan(lst)).mean()), "scenes": used}
