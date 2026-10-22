Satellite Finder
================
Search any place name and see a NASA satellite image of that area.

Files
-----
app.py            Python backend (Flask). Searches place names and fetches images from NASA GIBS.
Design.Html       The web page.
Design.Css        Page styling.
Design.Js         Browser code; talks to app.py.
requirements.txt  Python libraries needed.

How to run
----------
1. Install Python 3.10 or newer.
2. Open a terminal in this folder and run:
       pip install -r requirements.txt
       python app.py
3. Open http://127.0.0.1:5000 in a browser.

Notes
-----
- Imagery: NASA EOSDIS GIBS (no API key needed). Place search: OpenStreetMap Nominatim.
- An internet connection is required.
- Sentinel-2 / Landsat layers are sharp but not captured every day; if the image is blank, try another date.
