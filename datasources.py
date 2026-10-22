# datasources.py — reads the satellite and climate data ClimateSmart AI uses.
# Every raster reader puts its data on the same square grid (a "Grid"), so analysis.py
# can compare land cover, people and terrain pixel by pixel.
#
# Data used (all free, no API key):
#   ESA WorldCover 2021      10 m land cover from Sentinel-1/2 satellites  -> greenery, water, buildings
#   Meta HRSL population     30 m people-per-pixel from satellite imagery  -> how many people live there
#   Copernicus DEM GLO-30    30 m height map from the TanDEM-X satellites  -> slopes and low, flood-prone land
#   NASA POWER climatology   long-term climate from NASA satellites/models -> heat and rainfall

import math  # cos/floor for converting kilometres into degrees and naming tiles
import os  # environment variables that configure GDAL (the library under rasterio)

import certifi  # a trusted list of HTTPS certificates (installed together with requests)
import numpy as np  # fast maths on whole grids of pixels
import rasterio  # reads GeoTIFF satellite rasters straight from the cloud
import requests  # calls the NASA POWER web API
from rasterio.enums import Resampling  # how pixels are combined when the grid is coarser than the data
from rasterio.errors import RasterioIOError  # error raised when a raster can't be opened
from rasterio.transform import from_bounds  # builds the pixel <-> lat/lon mapping for a grid
from rasterio.vrt import WarpedVRT  # re-samples a raster onto our grid on the fly

# GDAL settings that make cloud reads fast: don't list folders, only fetch .tif/.vrt files, merge byte ranges.
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")  # don't ask S3 for a folder listing first
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif,.vrt")  # only these files are ever requested
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")  # fetch several pieces of a file in one request
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")  # join neighbouring pieces into one request
os.environ.setdefault("VSI_CACHE", "TRUE")  # keep recently downloaded pieces in memory
if not any(k in os.environ for k in ("CURL_CA_BUNDLE", "SSL_CERT_FILE", "GDAL_CURL_CA_BUNDLE")):  # no certificate list set yet?
    os.environ["CURL_CA_BUNDLE"] = certifi.where()  # let GDAL trust the same HTTPS certificates as requests

HEADERS = {"User-Agent": "ClimateSmartAI/1.0 (hackathon project)"}  # identify ourselves to web APIs
TIMEOUT = 30  # seconds to wait for a web API before giving up

# Where each dataset lives. {tile}/{name} are filled in per area.
WORLDCOVER_URL = (
    "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{tile}_Map.tif"
)
DEM_URL = "https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif"  # one 1°x1° tile per file
HRSL_URL = "https://dataforgood-fb-data.s3.amazonaws.com/hrsl-cogs/hrsl_general/hrsl_general-latest.vrt"  # whole world
POWER_URL = "https://power.larc.nasa.gov/api/temporal/climatology/point"  # NASA POWER long-term averages

# ESA WorldCover class codes -> (name, official legend colour).
LANDCOVER_CLASSES = {
    10: ("Tree cover", "#006400"),
    20: ("Shrubland", "#ffbb22"),
    30: ("Grassland", "#ffff4c"),
    40: ("Cropland", "#f096ff"),
    50: ("Built-up", "#fa0000"),
    60: ("Bare / sparse vegetation", "#b4b4b4"),
    70: ("Snow and ice", "#f0f0f0"),
    80: ("Permanent water", "#0064c8"),
    90: ("Herbaceous wetland", "#0096a0"),
    95: ("Mangroves", "#00cf75"),
    100: ("Moss and lichen", "#fae6a0"),
}
WATER_CLASS = 80  # code WorldCover uses for lakes, rivers and sea; also used for missing (all-ocean) tiles

MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]  # NASA POWER keys
DAYS_IN_MONTH = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]  # average days, used to turn mm/day into mm/month


class DataUnavailable(Exception):
    """Raised when a dataset can't be reached (network error, service down)."""


def bounding_box(lat, lon, width_km):
    """Return (min_lat, min_lon, max_lat, max_lon) for a square area width_km wide centred on lat/lon."""
    km_per_deg_lat = 111.32  # one degree of latitude is always about 111.32 km
    km_per_deg_lon = 111.32 * max(math.cos(math.radians(lat)), 0.01)  # longitude degrees shrink towards the poles
    half_lat = width_km / 2 / km_per_deg_lat  # half the box height, in degrees
    half_lon = width_km / 2 / km_per_deg_lon  # half the box width, in degrees
    return (
        max(lat - half_lat, -90),  # bottom edge, never past the South Pole
        max(lon - half_lon, -180),  # left edge, never past -180°
        min(lat + half_lat, 90),  # top edge, never past the North Pole
        min(lon + half_lon, 180),  # right edge, never past +180°
    )


class Grid:
    """A square area on the map split into size x size pixels, shared by every dataset."""

    def __init__(self, lat, lon, width_km, size):
        self.lat, self.lon, self.width_km, self.size = lat, lon, width_km, size  # remember the inputs
        self.south, self.west, self.north, self.east = bounding_box(lat, lon, width_km)  # edges in degrees
        self.transform = from_bounds(self.west, self.south, self.east, self.north, size, size)  # pixel <-> degrees
        self.pixel_m = width_km * 1000 / size  # how many metres one pixel covers

    def resized(self, size):
        """The same area with a different number of pixels (e.g. a coarse grid for population)."""
        return Grid(self.lat, self.lon, self.width_km, size)  # same centre and width, new pixel count

    @property
    def bounds(self):
        """[[south, west], [north, east]] — the format Leaflet maps use."""
        return [[self.south, self.west], [self.north, self.east]]


def _tile_ranges(grid, step):
    """Yield the (lat, lon) lower-left corners of every step°-tile the grid touches."""
    lat0 = step * math.floor(grid.south / step)  # first tile row (tiles are named by their lower-left corner)
    lon0 = step * math.floor(grid.west / step)  # first tile column
    for lat in range(int(lat0), int(math.ceil(grid.north / step) * step), step):  # every tile row up to the top edge
        for lon in range(int(lon0), int(math.ceil(grid.east / step) * step), step):  # every column up to the right edge
            yield lat, lon  # one tile corner


def worldcover_tile_names(grid):
    """WorldCover is split into 3°x3° tiles named like N03E099 (lower-left corner)."""
    return [
        f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}{'E' if lon >= 0 else 'W'}{abs(lon):03d}"  # e.g. S03W060
        for lat, lon in _tile_ranges(grid, 3)
    ]


def dem_tile_names(grid):
    """Copernicus DEM is split into 1°x1° tiles named like Copernicus_DSM_COG_10_N03_00_E101_00_DEM."""
    return [
        f"Copernicus_DSM_COG_10_{'N' if lat >= 0 else 'S'}{abs(lat):02d}_00_{'E' if lon >= 0 else 'W'}{abs(lon):03d}_00_DEM"
        for lat, lon in _tile_ranges(grid, 1)
    ]


def _read_tiles(urls, grid, resampling, dtype, fill, is_valid):
    """Read every tile onto the grid. Missing tiles (HTTP 404, e.g. open ocean) keep the fill value."""
    out = np.full((grid.size, grid.size), fill, dtype=dtype)  # start with "no data" everywhere
    for url in urls:  # a grid near a tile edge needs several tiles
        try:
            with rasterio.open("/vsicurl/" + url) as src:  # open the cloud file (only the header is downloaded)
                with WarpedVRT(  # a virtual copy of the tile, re-sampled onto our grid
                    src,
                    crs="EPSG:4326",  # plain latitude/longitude
                    transform=grid.transform,  # our grid's position
                    width=grid.size,  # our grid's pixel count
                    height=grid.size,
                    resampling=resampling,  # how to combine pixels
                    nodata=fill,  # value for pixels outside this tile
                ) as vrt:
                    data = vrt.read(1)  # downloads only the pieces of the tile that cover our grid
        except RasterioIOError as err:  # the tile could not be opened
            if "404" in str(err):  # tile doesn't exist: the area is ocean or outside the dataset
                continue  # keep the fill value there
            raise DataUnavailable(str(err)) from err  # anything else is a real network/service problem
        valid = is_valid(data)  # pixels this tile actually covers
        out[valid] = data[valid]  # paste them into the result
    return out  # the whole grid, filled in from all tiles


def read_landcover(grid):
    """ESA WorldCover class codes on the grid (uint8). Ocean/missing tiles become water (80)."""
    urls = [WORLDCOVER_URL.format(tile=t) for t in worldcover_tile_names(grid)]  # tiles touching the area
    codes = _read_tiles(urls, grid, Resampling.nearest, np.uint8, 0, lambda a: a != 0)  # 0 = no data in WorldCover
    codes[codes == 0] = WATER_CLASS  # no tile at all means open ocean
    return codes  # 2-D array of class codes


def read_elevation(grid):
    """Height above sea level in metres (float32). Missing tiles (ocean) become 0 m."""
    urls = [DEM_URL.format(name=n) for n in dem_tile_names(grid)]  # tiles touching the area
    height = _read_tiles(urls, grid, Resampling.bilinear, np.float32, np.nan, np.isfinite)  # NaN where no tile
    return np.nan_to_num(height, nan=0.0)  # no tile means open sea, i.e. 0 m


def read_population(grid):
    """People living in each grid pixel (float64). Returns (array, covered) — covered is False if HRSL has no data here."""
    try:
        with rasterio.open("/vsicurl/" + HRSL_URL) as src:  # one virtual file for the whole world
            with WarpedVRT(
                src,
                crs="EPSG:4326",
                transform=grid.transform,
                width=grid.size,
                height=grid.size,
                resampling=Resampling.sum,  # add up the people in all small pixels inside each big pixel
                src_nodata=np.nan,  # HRSL marks empty land as NaN
                nodata=np.nan,
            ) as vrt:
                people = vrt.read(1)  # people per grid pixel, NaN where nobody lives
    except RasterioIOError as err:  # the population service couldn't be reached
        raise DataUnavailable(str(err)) from err
    covered = bool(np.isfinite(people).any())  # at least one populated pixel means HRSL covers this place
    return np.nan_to_num(people, nan=0.0), covered  # NaN (nobody lives here) becomes 0 people


def parse_power(payload):
    """Turn a NASA POWER climatology reply into the few numbers the analysis needs."""
    p = payload["properties"]["parameter"]  # {"T2M": {"JAN": .., "ANN": ..}, ...}

    def ok(v):  # NASA marks missing values as -999
        return v is not None and v > -900

    t_mean = p["T2M"]["ANN"]  # average air temperature over the year, °C
    t_max = [p["T2M_MAX"][m] for m in MONTHS if ok(p["T2M_MAX"][m])]  # average daily high for each month, °C
    rain_day = [p["PRECTOTCORR"][m] for m in MONTHS]  # average rainfall, mm per day, for each month
    rain_month = [r * d if ok(r) else None for r, d in zip(rain_day, DAYS_IN_MONTH)]  # mm in each month
    known = [r for r in rain_month if r is not None]  # months with a valid value
    return {
        "mean_temp_c": round(t_mean, 1) if ok(t_mean) else None,  # yearly average temperature
        "hottest_month_max_c": round(max(t_max), 1) if t_max else None,  # average daily high in the hottest month
        "rain_mm_year": round(sum(known)) if len(known) == 12 else None,  # total rainfall in a year
        "driest_month_mm": round(min(known)) if known else None,  # rainfall in the driest month
        "monthly_rain_mm": [round(r) if r is not None else None for r in rain_month],  # for the chart
        "humidity_pct": round(p["RH2M"]["ANN"]) if ok(p["RH2M"]["ANN"]) else None,  # average relative humidity
    }


def read_climate(lat, lon):
    """Long-term (about 20-year) climate averages from NASA POWER for one point."""
    params = {
        "parameters": "T2M,T2M_MAX,PRECTOTCORR,RH2M",  # temperature, daily high, rainfall, humidity
        "community": "RE",  # renewable-energy community (units: °C, mm/day, %)
        "latitude": round(lat, 4),  # NASA wants at most 4 decimals
        "longitude": round(lon, 4),
        "format": "JSON",
    }
    try:
        res = requests.get(POWER_URL, params=params, headers=HEADERS, timeout=TIMEOUT)  # call NASA POWER
        res.raise_for_status()  # HTTP errors become exceptions
        return parse_power(res.json())  # keep only what we need
    except (requests.RequestException, KeyError, TypeError, ValueError) as err:  # network error or unexpected reply
        raise DataUnavailable(f"NASA POWER: {err}") from err
