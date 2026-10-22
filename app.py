# app.py — Backend server for Satellite Finder.
# It does two jobs:
#   1. /api/search  -> turns a place name into coordinates (geocoding).
#   2. /api/image   -> downloads the satellite image for those coordinates from NASA GIBS.
# It also serves the front-end files (Design.Html, Design.Css, Design.Js).
#
# Run it with:   pip install -r requirements.txt   then   python app.py
# Then open:     http://127.0.0.1:5000

import math  # math gives us cos() and pi, used to convert km into degrees of longitude
import os  # os lets us build file paths that work on any operating system
from datetime import date, timedelta  # date/timedelta are used to validate and default the image date

import requests  # requests is the library we use to call other web APIs (NASA, OpenStreetMap)
from flask import Flask, Response, abort, jsonify, request, send_from_directory  # Flask pieces for building the web server

BASE_DIR = os.path.dirname(os.path.abspath(__file__))  # the folder this file lives in (D:\Satellite)

# NASA GIBS (Global Imagery Browse Services) WMS endpoint — NASA's satellite imagery API, no key needed.
NASA_GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"  # main place-name search service (OpenStreetMap)
OPEN_METEO_URL = "https://geocoding-api.open-meteo.com/v1/search"  # backup place-name search service

# OpenStreetMap asks every app to identify itself with a User-Agent header.
HEADERS = {"User-Agent": "SatelliteFinder/1.0 (learning project)"}

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

# Only these files may be downloaded by the browser, with the correct content type for each.
FRONTEND_FILES = {
    "Design.Html": "text/html",  # the page itself
    "Design.Css": "text/css",  # the styles
    "Design.Js": "application/javascript",  # the browser-side code
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
