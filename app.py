# app.py — Backend server for ClimateSmart AI (grew out of Satellite Finder).
# It does five jobs:
#   1. /api/search       -> turns a place name into coordinates (geocoding).
#   2. /api/analyze      -> scores an area for a data centre or township using satellite data (see analysis.py).
#   3. /api/vision-check -> Claude Opus looks at satellite photos of the best spots (optional, needs an API key).
#   4. /api/chat         -> Claude Haiku answers questions and highlights areas on the map (optional, same key).
#   5. /api/image        -> downloads a NASA GIBS satellite picture of an area.
# It also serves the front-end files (Design.Html, Design.Css, Design.Js and the Leaflet map library).
#
# Run it with:   pip install -r requirements.txt   then   python app.py
# Then open:     http://127.0.0.1:5000

import os  # os lets us build file paths that work on any operating system
from datetime import date, timedelta  # date/timedelta are used to validate and default the image date
from functools import lru_cache  # remembers recent analyses so the AI features don't redo the work

import requests  # requests is the library we use to call other web APIs (NASA, OpenStreetMap)
from flask import Flask, Response, abort, jsonify, request, send_from_directory  # Flask pieces for building the web server

import ai  # Claude vision check and chat
import analysis  # scoring and recommendations
import datasources  # satellite data readers
from datasources import bounding_box  # square area around a point, in degrees

BASE_DIR = os.path.dirname(os.path.abspath(__file__))  # the folder this file lives in

# NASA GIBS (Global Imagery Browse Services) WMS endpoint — NASA's satellite imagery API, no key needed.
NASA_GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"  # main place-name search service (OpenStreetMap)
OPEN_METEO_URL = "https://geocoding-api.open-meteo.com/v1/search"  # backup place-name search service

# OpenStreetMap asks every app to identify itself with a User-Agent header.
HEADERS = {"User-Agent": "ClimateSmartAI/1.0 (hackathon project)"}

# Every NASA imagery layer we allow, mapped to its detail level in metres per pixel.
LAYERS = {
    "HLS_S30_Nadir_BRDF_Adjusted_Reflectance": 30,  # Sentinel-2 via NASA HLS, sharp but not every day
    "HLS_L30_Nadir_BRDF_Adjusted_Reflectance": 30,  # Landsat via NASA HLS, sharp but not every day
    "MODIS_Terra_CorrectedReflectance_TrueColor": 250,  # MODIS on the Terra satellite, new image daily
    "VIIRS_SNPP_CorrectedReflectance_TrueColor": 250,  # VIIRS on the Suomi NPP satellite, new image daily
    "BlueMarble_ShadedRelief_Bathymetry": 500,  # Blue Marble, one cloud-free picture of Earth
}
STATIC_LAYERS = {"BlueMarble_ShadedRelief_Bathymetry"}  # layers that have no date (TIME must not be sent)

MAX_PX = 1600  # biggest image size (in pixels) we will ask NASA for
MIN_PX = 512  # smallest image size so small areas still look decent
TIMEOUT = 30  # seconds to wait for an outside API before giving up

AREA_KM = (1, 30)  # smallest and largest area width the analysis accepts
SIZE_LIMITS = {"datacentre": (1, 500), "township": (100, 1_000_000)}  # MW, or new residents

# Only these files may be downloaded by the browser, with the correct content type for each.
FRONTEND_FILES = {
    "Design.Html": "text/html",  # the page itself
    "Design.Css": "text/css",  # the styles
    "Design.Js": "application/javascript",  # the browser-side code
    "vendor/leaflet/leaflet.js": "application/javascript",  # the interactive map library
    "vendor/leaflet/leaflet.css": "text/css",  # its styles
    "vendor/leaflet/images/layers.png": "image/png",  # icons used by the map's layer switcher
    "vendor/leaflet/images/layers-2x.png": "image/png",
    "vendor/leaflet/images/marker-icon.png": "image/png",
    "vendor/leaflet/images/marker-icon-2x.png": "image/png",
    "vendor/leaflet/images/marker-shadow.png": "image/png",
}

app = Flask(__name__)  # create the web server application


@app.route("/")  # when someone visits the home page...
def index():
    return serve_frontend("Design.Html")  # ...send them the HTML page


@app.route("/<path:filename>")  # any other file request, e.g. /Design.Css
def serve_frontend(filename):
    if filename not in FRONTEND_FILES:  # refuse anything not on the allow-list (e.g. app.py itself)
        abort(404)  # reply "not found"
    return send_from_directory(BASE_DIR, filename, mimetype=FRONTEND_FILES[filename])  # send the file


def geocode_nominatim(query):
    """Ask OpenStreetMap Nominatim for up to 5 places matching the query."""
    params = {"q": query, "format": "jsonv2", "limit": 5}  # search text, JSON output, max 5 results
    headers = {**HEADERS, "Accept-Language": "en"}  # identify ourselves and ask for English names
    res = requests.get(NOMINATIM_URL, params=params, headers=headers, timeout=TIMEOUT)  # call the API
    res.raise_for_status()  # turn HTTP errors (like 403/500) into a Python exception
    return [  # convert each result into our own simple format
        {
            "name": p.get("name") or p["display_name"].split(",")[0],  # short name, or first part of full name
            "detail": p["display_name"],  # full address-like name, e.g. "Paris, France"
            "lat": float(p["lat"]),  # latitude as a number
            "lon": float(p["lon"]),  # longitude as a number
        }
        for p in res.json()  # loop over every place returned
    ]


def geocode_open_meteo(query):
    """Backup search: Open-Meteo knows cities and towns (not streets or landmarks)."""
    params = {"name": query, "count": 5, "language": "en"}  # search text, max 5 results, English
    res = requests.get(OPEN_METEO_URL, params=params, headers=HEADERS, timeout=TIMEOUT)  # call the API
    res.raise_for_status()  # stop here if the request failed
    return [  # convert each result into our own simple format
        {
            "name": p["name"],  # the place name
            "detail": ", ".join(x for x in (p["name"], p.get("admin1"), p.get("country")) if x),  # "City, Region, Country"
            "lat": p["latitude"],  # latitude
            "lon": p["longitude"],  # longitude
        }
        for p in res.json().get("results", [])  # "results" is missing when nothing matched
    ]


@app.route("/api/search")  # browser calls /api/search?q=Tokyo
def search():
    query = request.args.get("q", "").strip()  # read the "q" value from the URL and trim spaces
    if not query:  # nothing typed?
        return jsonify(error="Missing search text"), 400  # reply with an error (400 = bad request)
    try:
        places = geocode_nominatim(query)  # try OpenStreetMap first
    except requests.RequestException as err:  # if it failed (network error, blocked, etc.)...
        app.logger.warning("Nominatim failed (%s), using Open-Meteo", err)  # note it in the server log
        try:
            places = geocode_open_meteo(query)  # ...try the backup service
        except requests.RequestException:  # both failed
            return jsonify(error="Place search service unavailable"), 502  # 502 = an upstream service failed
    return jsonify(places=places)  # send the list of places back to the browser as JSON


def read_analysis_args(args):
    """Check the analysis settings sent by the browser. Returns (settings, error message)."""
    try:
        lat = float(args["lat"])  # latitude of the site
        lon = float(args["lon"])  # longitude of the site
        width_km = float(args.get("area", 10))  # how wide an area to analyse, default 10 km
        size = float(args.get("scale", 30))  # MW for a data centre, new residents for a township
    except (KeyError, TypeError, ValueError):  # a value was missing or not a number
        return None, "lat, lon, area and scale must be numbers"
    purpose = args.get("purpose", "datacentre")  # what is being planned
    if purpose not in analysis.PURPOSES:  # only the purposes we know how to score
        return None, "purpose must be 'datacentre' or 'township'"
    low, high = SIZE_LIMITS[purpose]  # sensible range for this purpose
    if not (-60 <= lat <= 72 and -180 <= lon <= 180):  # population data only covers 56°S to 71°N
        return None, "Pick a place between 60°S and 72°N"
    if not (AREA_KM[0] <= width_km <= AREA_KM[1]):  # keep downloads small and fast
        return None, f"Area width must be {AREA_KM[0]}-{AREA_KM[1]} km"
    if not (low <= size <= high):
        return None, f"Size must be between {low:g} and {high:g}"
    return (round(lat, 5), round(lon, 5), width_km, purpose, size), None  # rounding makes the cache work


@lru_cache(maxsize=32)  # keep the last 32 analyses in memory
def cached_analysis(lat, lon, width_km, purpose, size):
    """Run (or reuse) an analysis. The result must not be modified by callers."""
    return analysis.analyse(lat, lon, width_km, purpose, size)


@app.route("/api/analyze")  # browser calls /api/analyze?lat=..&lon=..&area=10&purpose=datacentre&scale=30
def analyze():
    settings, error = read_analysis_args(request.args)  # validate the input
    if error:
        return jsonify(error=error), 400  # tell the browser what was wrong
    try:
        return jsonify(cached_analysis(*settings))  # run the analysis and send it back as JSON
    except datasources.DataUnavailable as err:  # the satellite data couldn't be downloaded
        app.logger.warning("Analysis failed: %s", err)
        return jsonify(error="Satellite data service unavailable. Check your internet connection and try again."), 502


VISION_RESULTS = {}  # settings -> last vision check, so the chat can use its findings
MAX_VISION_RESULTS = 32  # forget the oldest checks beyond this


@app.route("/api/vision-check", methods=["POST"])  # browser posts the same settings it used for /api/analyze
def vision_check():
    settings, error = read_analysis_args(request.get_json(silent=True) or {})  # validate the input
    if error:
        return jsonify(error=error), 400
    try:
        result = cached_analysis(*settings)  # normally already in the cache, so this is instant
        checked = ai.vision_check(result)  # satellite photos of the best spots -> Claude Opus
    except datasources.DataUnavailable:  # analysis data or imagery tiles couldn't be downloaded
        return jsonify(error="Satellite imagery unavailable. Check your internet connection and try again."), 502
    except ai.AIError as err:
        return jsonify(error=str(err)), err.status
    VISION_RESULTS[settings] = checked  # remember it for the chat
    while len(VISION_RESULTS) > MAX_VISION_RESULTS:
        VISION_RESULTS.pop(next(iter(VISION_RESULTS)))  # drop the oldest
    return jsonify(checked)


@app.route("/api/chat", methods=["POST"])  # browser posts the settings plus the conversation so far
def chat():
    body = request.get_json(silent=True) or {}  # {"lat":..,"lon":..,"area":..,"purpose":..,"scale":..,"messages":[..]}
    settings, error = read_analysis_args(body)  # validate the analysis settings
    if error:
        return jsonify(error=error), 400
    try:
        result = cached_analysis(*settings)  # the analysis the user is looking at
        return jsonify(ai.chat(result, body.get("messages"), VISION_RESULTS.get(settings)))  # Claude Haiku answers
    except datasources.DataUnavailable:
        return jsonify(error="Satellite data service unavailable"), 502
    except ai.AIError as err:
        return jsonify(error=str(err)), err.status


@app.route("/api/image")  # browser calls /api/image?lat=..&lon=..&layer=..&date=..&size=..
def image():
    try:
        lat = float(request.args["lat"])  # latitude of the place
        lon = float(request.args["lon"])  # longitude of the place
        width_km = float(request.args.get("size", 150))  # how wide an area to show, default 150 km
    except (KeyError, ValueError):  # a value was missing or not a number
        return jsonify(error="lat, lon and size must be numbers"), 400  # tell the browser it sent bad input
    if not (-90 <= lat <= 90 and -180 <= lon <= 180 and 1 <= width_km <= 5000):  # sanity-check the ranges
        return jsonify(error="Coordinates or size out of range"), 400  # reject impossible values

    layer = request.args.get("layer", "MODIS_Terra_CorrectedReflectance_TrueColor")  # chosen imagery, MODIS by default
    if layer not in LAYERS:  # only allow the layers we know about
        return jsonify(error="Unknown imagery layer"), 400  # reject anything else

    day = request.args.get("date") or (date.today() - timedelta(days=3)).isoformat()  # chosen date, default 3 days ago
    try:
        date.fromisoformat(day)  # make sure the date looks like YYYY-MM-DD
    except ValueError:  # it didn't
        return jsonify(error="Date must be YYYY-MM-DD"), 400  # reject it

    min_lat, min_lon, max_lat, max_lon = bounding_box(lat, lon, width_km)  # work out the area to fetch
    px = round(min(MAX_PX, max(MIN_PX, width_km * 1000 / LAYERS[layer])))  # pixels: no more than the sensor can show

    params = {  # the settings NASA's WMS service expects
        "SERVICE": "WMS",  # we are using the Web Map Service standard
        "REQUEST": "GetMap",  # we want a map image
        "VERSION": "1.3.0",  # WMS version
        "LAYERS": layer,  # which NASA imagery to draw
        "STYLES": "",  # default styling
        "CRS": "EPSG:4326",  # coordinates are plain latitude/longitude
        "BBOX": f"{min_lat},{min_lon},{max_lat},{max_lon}",  # the area; WMS 1.3.0 wants lat before lon here
        "WIDTH": px,  # image width in pixels
        "HEIGHT": px,  # image height in pixels
        "FORMAT": "image/jpeg",  # we want a JPEG picture back
    }
    if layer not in STATIC_LAYERS:  # dated layers need a day...
        params["TIME"] = day  # ...so tell NASA which day's pass we want

    try:
        res = requests.get(NASA_GIBS_WMS, params=params, headers=HEADERS, timeout=TIMEOUT)  # download from NASA
        res.raise_for_status()  # stop if NASA returned an HTTP error
    except requests.RequestException:  # network problem or NASA error
        return jsonify(error="NASA imagery service unavailable"), 502  # tell the browser NASA failed

    content_type = res.headers.get("Content-Type", "")  # what NASA sent back
    if not content_type.startswith("image/"):  # WMS reports some errors as XML instead of an image
        app.logger.warning("NASA returned non-image: %s", res.text[:300])  # log the start of the error message
        return jsonify(error="NASA could not make an image for this request"), 502  # pass the failure on

    return Response(  # send the picture straight to the browser
        res.content,  # the raw image bytes
        mimetype=content_type,  # e.g. image/jpeg
        headers={"Cache-Control": "public, max-age=86400"},  # let the browser reuse it for a day
    )


if __name__ == "__main__":  # only true when you run "python app.py" directly
    app.run(host="127.0.0.1", port=5000, debug=True)  # start the server on http://127.0.0.1:5000
