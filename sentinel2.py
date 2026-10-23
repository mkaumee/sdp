# sentinel2.py — reads recent Sentinel-2 satellite scenes from the free AWS archive.
# It gives two things the dashboard needs:
#   1. NDVI (a 0-1 "greenness" index from the red and near-infrared bands), with clouds removed,
#      stitched together from the clearest recent scenes.
#   2. True-colour photos (the satellite's own RGB image) with the real date they were taken.
#
# The archive is organised by 100 km "MGRS" tiles: sentinel-s2-l2a-cogs/47/N/QD/2026/9/<scene>/B04.tif

import io  # in-memory files for JPEG photos
import math  # tile-name maths
import re  # reads dates out of scene folder names
from concurrent.futures import ThreadPoolExecutor  # many small downloads at once
from datetime import date, timedelta  # the time window to search

import numpy as np  # maths on whole grids
import rasterio  # reads the satellite bands (Cloud-Optimised GeoTIFFs)
import requests  # lists the archive and reads scene metadata
from PIL import Image, ImageDraw  # turns the true-colour pixels into a JPEG and draws the outline
from rasterio.enums import Resampling  # how pixels are combined when shrinking
from rasterio.errors import RasterioIOError  # error when a file can't be opened
from rasterio.vrt import WarpedVRT  # re-projects a scene onto our lat/lon grid
from rasterio.warp import transform as warp_transform  # lat/lon -> UTM metres (for tile names)

from datasources import HEADERS, DataUnavailable, Grid  # shared settings, error type and grid

BUCKET_URL = "https://sentinel-cogs.s3.us-west-2.amazonaws.com"  # public AWS bucket, no key needed
PREFIX = "sentinel-s2-l2a-cogs"  # Level-2A = surface reflectance (atmosphere already corrected)
TIMEOUT = 20  # seconds per web request
SEARCH_DAYS = 120  # look this far back for clear scenes...
FALLBACK_DAYS = 365  # ...and this far if the area is too cloudy
MAX_SCENES = 6  # stitch at most this many scenes together
TARGET_COVERAGE = 0.95  # stop once 95% of the area has a cloud-free value

# Scene Classification (SCL) codes that are clear ground: vegetation, bare soil, water, unclassified, snow.
CLEAR_CLASSES = [4, 5, 6, 7, 11]
SCENE_NAME = re.compile(r"^S2[A-D]_\d{2}[A-Z]{3}_(\d{8})_\d+_L2A$")  # e.g. S2C_47NQD_20260924_0_L2A

LAT_BANDS = "CDEFGHJKLMNPQRSTUVWX"  # 8° latitude bands from 80°S
COLUMN_SETS = ["ABCDEFGH", "JKLMNPQR", "STUVWXYZ"]  # 100 km column letters repeat every 3 UTM zones
ROW_LETTERS = "ABCDEFGHJKLMNPQRSTUV"  # 100 km row letters (no I or O)


# ---------- Finding the right tile ----------

def utm_zone(lat, lon):
    """UTM zone number, including the Norway and Svalbard exceptions."""
    zone = int((lon + 180) // 6) + 1  # 6°-wide zones from 180°W
    if 56 <= lat < 64 and 3 <= lon < 12:  # south-west Norway is widened
        zone = 32
    if 72 <= lat < 84 and lon >= 0:  # Svalbard uses odd zones only
        zone = 31 if lon < 9 else 33 if lon < 21 else 35 if lon < 33 else 37 if lon < 42 else zone
    return min(zone, 60)


def mgrs_tile(lat, lon):
    """The Sentinel-2 tile name for a point, e.g. (3.19, 101.49) -> ('47', 'N', 'QD')."""
    zone = utm_zone(lat, lon)
    band = LAT_BANDS[min(max(int((lat + 80) // 8), 0), len(LAT_BANDS) - 1)]  # latitude band letter
    epsg = (32600 if lat >= 0 else 32700) + zone  # UTM north or south
    (easting,), (northing,) = warp_transform("EPSG:4326", f"EPSG:{epsg}", [lon], [lat])  # metres in that zone
    column = COLUMN_SETS[(zone - 1) % 3][int(easting // 100000) - 1]  # 100 km column letter
    row = ROW_LETTERS[(int(northing // 100000) + (5 if zone % 2 == 0 else 0)) % 20]  # even zones start at F
    return str(zone), band, column + row


def tiles_for_grid(grid):
    """Every tile touching the grid (its centre and four corners), so areas near a tile edge are covered."""
    points = [(grid.lat, grid.lon), (grid.south, grid.west), (grid.south, grid.east),
              (grid.north, grid.west), (grid.north, grid.east)]
    return list(dict.fromkeys(mgrs_tile(lat, lon) for lat, lon in points))  # unique, centre first


# ---------- Listing scenes ----------

def _list_prefixes(prefix):
    """Folder names directly under an S3 prefix (the bucket allows public listing)."""
    params = {"list-type": "2", "delimiter": "/", "prefix": prefix}
    res = requests.get(BUCKET_URL + "/", params=params, headers=HEADERS, timeout=TIMEOUT)
    res.raise_for_status()
    return re.findall(r"<Prefix>([^<]+)</Prefix>", res.text)[1:]  # the first <Prefix> is the request itself


def _months(start, end):
    """(year, month) pairs from start to end, newest first."""
    out, y, m = [], end.year, end.month
    while (y, m) >= (start.year, start.month):
        out.append((y, m))
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    return out


def list_scenes(tile, start, end):
    """Scene folders for one tile between two dates: [{"prefix", "id", "date"}]."""
    zone, band, square = tile
    scenes = []
    for year, month in _months(start, end):
        folder = f"{PREFIX}/{zone}/{band}/{square}/{year}/{month}/"  # months are not zero-padded in this bucket
        for prefix in _list_prefixes(folder):
            scene_id = prefix.rstrip("/").split("/")[-1]
            match = SCENE_NAME.match(scene_id)
            if not match:
                continue
            day = date(int(match[1][:4]), int(match[1][4:6]), int(match[1][6:]))
            if start <= day <= end:
                scenes.append({"prefix": prefix, "id": scene_id, "date": day.isoformat()})
    return scenes


def scene_metadata(scene):
    """Add cloud cover, satellite and processing version from the scene's STAC record."""
    url = f"{BUCKET_URL}/{scene['prefix']}{scene['id']}.json"
    props = requests.get(url, headers=HEADERS, timeout=TIMEOUT).json()["properties"]
    baseline = float(props.get("s2:processing_baseline", "0") or 0)  # e.g. "05.13"
    return {
        **scene,
        "cloud": float(props.get("eo:cloud_cover", 100)),  # % of the whole tile under cloud
        "platform": "Sentinel-" + str(props.get("platform", "sentinel-2")).split("-")[-1].upper(),  # e.g. Sentinel-2C
        "offset": 1000 if baseline >= 4 else 0,  # since 2022 the stored numbers carry +1000
    }


def find_scenes(grid, start=None, end=None, max_cloud=90):
    """Recent scenes covering the grid, clearest first."""
    end = end or date.today()
    start = start or end - timedelta(days=SEARCH_DAYS)
    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            listed = [s for found in pool.map(lambda t: list_scenes(t, start, end), tiles_for_grid(grid)) for s in found]
        with ThreadPoolExecutor(max_workers=16) as pool:
            scenes = list(pool.map(scene_metadata, listed))  # metadata in parallel (one small JSON each)
    except (requests.RequestException, ValueError, KeyError) as err:
        raise DataUnavailable(f"Sentinel-2 archive: {err}") from err
    scenes = [s for s in scenes if s["cloud"] <= max_cloud]
    return sorted(scenes, key=lambda s: (round(s["cloud"]), -int(s["date"].replace("-", ""))))  # clearest, then newest


# ---------- Reading bands ----------

def _band_url(scene, band):
    return f"/vsicurl/{BUCKET_URL}/{scene['prefix']}{band}.tif"


def read_band(scene, band, grid, resampling=Resampling.average, dtype="float32"):
    """One band of one scene on our grid; 0 where the scene has no data."""
    with rasterio.open(_band_url(scene, band)) as src:  # only the header is downloaded here
        with WarpedVRT(src, crs="EPSG:4326", transform=grid.transform, width=grid.size, height=grid.size,
                       resampling=resampling, nodata=0) as vrt:
            return vrt.read(1).astype(dtype)  # downloads only the parts that cover the grid


def scene_ndvi(scene, grid):
    """NDVI for one scene on the grid; NaN where cloudy or outside the scene."""
    with ThreadPoolExecutor(max_workers=3) as pool:
        red, nir, scl = pool.map(lambda args: read_band(scene, args[0], grid, *args[1:]), [
            ("B04", Resampling.average), ("B08", Resampling.average), ("SCL", Resampling.nearest, "uint8")])
    clear = np.isin(scl, CLEAR_CLASSES) & (red > 0) & (nir > 0)  # cloud-free pixels with data
    red = np.clip(red - scene["offset"], 0, None) / 10000  # stored numbers -> reflectance 0-1
    nir = np.clip(nir - scene["offset"], 0, None) / 10000
    with np.errstate(divide="ignore", invalid="ignore"):
        ndvi = (nir - red) / (nir + red)  # NDVI = (NIR - Red) / (NIR + Red)
    return np.where(clear & np.isfinite(ndvi), ndvi, np.nan).astype("float32")


def read_ndvi(grid, start=None, end=None):
    """Cloud-free NDVI for the grid, stitched from the clearest recent scenes.

    Returns {"ndvi": array (NaN = no clear view), "coverage": 0-1, "scenes": [{id, date, platform, cloud}]}.
    """
    scenes = find_scenes(grid, start, end)
    if not scenes and start is None:  # nothing usable in the last few months: look back a year
        scenes = find_scenes(grid, date.today() - timedelta(days=FALLBACK_DAYS))
    if not scenes:
        raise DataUnavailable("No Sentinel-2 scenes found for this area")
    ndvi = np.full((grid.size, grid.size), np.nan, dtype="float32")
    used = []
    for scene in scenes:
        try:
            fresh = scene_ndvi(scene, grid)
        except RasterioIOError:
            continue  # a damaged or missing file: try the next scene
        gap = np.isnan(ndvi) & ~np.isnan(fresh)  # pixels this scene can fill
        if gap.mean() > 0.01:  # worth using (adds more than 1% of the area)
            ndvi[gap] = fresh[gap]
            used.append({k: scene[k] for k in ("id", "date", "platform", "cloud")})
        if (~np.isnan(ndvi)).mean() >= TARGET_COVERAGE or len(used) >= MAX_SCENES:
            break
    coverage = float((~np.isnan(ndvi)).mean())
    if not used:
        raise DataUnavailable("Every recent Sentinel-2 scene is cloudy over this area")
    return {"ndvi": ndvi, "coverage": coverage, "scenes": used}


# ---------- True-colour photos ----------

def true_colour(bounds, max_px=768, start=None, end=None, outline=None):
    """A real satellite photo of an area from the clearest recent scene.

    bounds is [[south, west], [north, east]]; outline (same format) is drawn as a yellow box.
    Returns {"jpeg": bytes, "date", "platform", "scene", "clear_pct", "width_m"}.
    """
    (south, west), (north, east) = bounds
    lat, lon = (south + north) / 2, (west + east) / 2
    width_km = (north - south) * 111.32  # the boxes we pass in are square on the ground
    grid = Grid(lat, lon, width_km, max_px)  # same square, max_px pixels across
    probe = Grid(lat, lon, width_km, 64)  # tiny grid to judge clouds cheaply
    best = None
    for scene in find_scenes(grid, start, end)[:8]:  # clearest candidates
        try:
            scl = read_band(scene, "SCL", probe, Resampling.nearest, "uint8")
        except RasterioIOError:
            continue
        clear = float(np.isin(scl, CLEAR_CLASSES).mean())  # share of the box that is cloud-free
        if best is None or clear > best[1]:
            best = (scene, clear)
        if clear >= 0.9:  # clear enough, stop looking
            break
    if best is None or best[1] < 0.2:
        raise DataUnavailable("No clear Sentinel-2 view of this area recently")
    scene, clear = best
    with rasterio.open(_band_url(scene, "TCI")) as src:  # TCI = ready-made 8-bit true colour
        with WarpedVRT(src, crs="EPSG:4326", transform=grid.transform, width=grid.size, height=grid.size,
                       resampling=Resampling.average, nodata=0) as vrt:
            rgb = vrt.read([1, 2, 3])  # red, green, blue
    img = Image.fromarray(np.moveaxis(rgb, 0, -1).astype("uint8"), "RGB")
    if outline:  # draw the area of interest
        (os_, ow), (on, oe) = outline
        px = lambda la, lo: ((lo - grid.west) / (grid.east - grid.west) * grid.size,
                             (grid.north - la) / (grid.north - grid.south) * grid.size)
        ImageDraw.Draw(img).rectangle([*px(on, ow), *px(os_, oe)], outline=(255, 221, 0), width=3)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return {"jpeg": buf.getvalue(), "date": scene["date"], "platform": scene["platform"], "scene": scene["id"],
            "clear_pct": round(clear * 100), "width_m": round(width_km * 1000)}
