# imagery.py — builds sharp satellite photos of candidate sites for Claude's vision check.
# The photo is stitched together from the same Esri World Imagery map tiles the dashboard shows,
# with a yellow box drawn around the grid cell being checked.

import io  # an in-memory file for the finished JPEG
import math  # Web Mercator maths (the map projection web maps use)
from concurrent.futures import ThreadPoolExecutor  # download several tiles at once

import requests  # downloads map tiles
from PIL import Image, ImageDraw  # stitches tiles together and draws the box

from datasources import HEADERS, DataUnavailable  # same User-Agent and error type as the other downloads

ESRI_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
TILE_PX = 256  # every map tile is 256 x 256 pixels
MAX_ZOOM = 18  # about 0.6 m per pixel at the equator; deeper zooms are often missing outside cities
MAX_TILES = 49  # never download more than a 7 x 7 block of tiles for one photo
TIMEOUT = 20  # seconds to wait for one tile
BOX_COLOUR = (255, 221, 0)  # yellow outline around the candidate cell


def world_px(lat, lon, zoom):
    """Position of a lat/lon on the whole-world map at this zoom, in pixels from the top-left corner."""
    size = TILE_PX * 2 ** zoom  # the world is size x size pixels at this zoom
    lat = max(min(lat, 85.0511), -85.0511)  # Web Mercator stops at about ±85°
    s = math.sin(math.radians(lat))
    x = (lon + 180) / 360 * size  # longitude maps straight across
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * size  # latitude is stretched towards the poles
    return x, y


def fetch_tile(zoom, x, y):
    """Download one Esri imagery tile as a Pillow image."""
    res = requests.get(ESRI_TILE_URL.format(z=zoom, x=x, y=y), headers=HEADERS, timeout=TIMEOUT)
    res.raise_for_status()  # HTTP errors become exceptions
    return Image.open(io.BytesIO(res.content)).convert("RGB")  # decode the JPEG


def site_photo(cell_bounds, margin=0.35, max_px=1024, fetch=fetch_tile):
    """Photo of a grid cell plus some surroundings, with the cell outlined in yellow.

    cell_bounds is [[south, west], [north, east]]. Returns {"jpeg": bytes, "width_m": photo width in metres}.
    """
    (south, west), (north, east) = cell_bounds
    pad_lat = (north - south) * margin  # extra context around the cell
    pad_lon = (east - west) * margin
    area = (south - pad_lat, west - pad_lon, north + pad_lat, east + pad_lon)  # the whole photo

    for zoom in range(MAX_ZOOM, 0, -1):  # sharpest zoom whose photo isn't far bigger than needed
        x0, y0 = world_px(area[2], area[1], zoom)  # top-left corner (north-west)
        x1, y1 = world_px(area[0], area[3], zoom)  # bottom-right corner (south-east)
        tiles_x = math.floor(x1 / TILE_PX) - math.floor(x0 / TILE_PX) + 1  # tiles across
        tiles_y = math.floor(y1 / TILE_PX) - math.floor(y0 / TILE_PX) + 1  # tiles down
        if x1 - x0 <= max_px * 1.5 and tiles_x * tiles_y <= MAX_TILES:
            break

    tx0, ty0 = math.floor(x0 / TILE_PX), math.floor(y0 / TILE_PX)  # first tile column and row
    jobs = [(tx, ty) for ty in range(ty0, ty0 + tiles_y) for tx in range(tx0, tx0 + tiles_x)]  # every tile needed
    canvas = Image.new("RGB", (tiles_x * TILE_PX, tiles_y * TILE_PX), (40, 40, 40))  # grey where a tile is missing

    def load(job):
        try:
            return job, fetch(zoom, job[0], job[1])
        except (requests.RequestException, OSError):  # network error or not an image
            return job, None

    with ThreadPoolExecutor(max_workers=8) as pool:
        tiles = list(pool.map(load, jobs))  # download in parallel
    if all(img is None for _, img in tiles):  # nothing came back at all
        raise DataUnavailable("Esri World Imagery tiles could not be downloaded")
    for (tx, ty), img in tiles:
        if img is not None:
            canvas.paste(img, ((tx - tx0) * TILE_PX, (ty - ty0) * TILE_PX))  # put each tile in its place

    left, top = x0 - tx0 * TILE_PX, y0 - ty0 * TILE_PX  # photo corner inside the canvas
    photo = canvas.crop((round(left), round(top), round(left + x1 - x0), round(top + y1 - y0)))  # cut out the area

    cx0, cy0 = world_px(north, west, zoom)  # the cell's own corners on the same map
    cx1, cy1 = world_px(south, east, zoom)
    scale = min(1.0, max_px / max(photo.size))  # shrink if the photo is bigger than max_px
    if scale < 1:
        photo = photo.resize((round(photo.width * scale), round(photo.height * scale)), Image.LANCZOS)
    box = [(cx0 - x0) * scale, (cy0 - y0) * scale, (cx1 - x0) * scale, (cy1 - y0) * scale]  # cell inside the photo
    ImageDraw.Draw(photo).rectangle(box, outline=BOX_COLOUR, width=max(3, round(photo.width / 200)))  # yellow box

    metres_per_px = 156543.03 * math.cos(math.radians((north + south) / 2)) / 2 ** zoom / scale  # ground size of a pixel
    buf = io.BytesIO()
    photo.save(buf, format="JPEG", quality=85)  # compact enough to send to Claude
    return {"jpeg": buf.getvalue(), "width_m": round(photo.width * metres_per_px)}


def thumbnail(jpeg, max_px=480):
    """A smaller copy of a photo for showing in the dashboard."""
    img = Image.open(io.BytesIO(jpeg))
    img.thumbnail((max_px, max_px))  # keeps the shape, only ever shrinks
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return buf.getvalue()
