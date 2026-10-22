ClimateSmart AI
===============
**Find where to build data centres and townships without harming the planet or the people already living there.**

Click any place on the map (or search for it), say what you're planning, and ClimateSmart AI reads free
satellite data for that area. It then:

- scores the area from 0 to 100,
- marks the **best spots to build** inside it,
- for townships, shows the **heat hotspots** that most need trees and shade,
- writes plain-language recommendations,
- lets **Claude look at satellite photos** of the best spots, and
- has a **Claude chat guide** that explains everything and **highlights areas on the map** as it talks.

Hackathon pitch
---------------
- **Problem:** new data centres and townships are often sited without checking whether there is enough
  water, whether forest or wetland will be cleared, and whether nearby communities will suffer heat,
  floods or water shortages.
- **Idea (Anwar):** use satellite data to pick suitable land for new townships **and data centres**.
  Check the greenery and the water, and whether there's enough water for a data centre without hurting
  the environment or the people nearby.
- **Climate-resilience angle (Heather):** for townships, find areas with heat exposure and too little
  green space, then recommend where to plant trees, add parks and build shaded walkways.
- **Challenge fit:** Planet (climate resilience, protecting ecosystems, water) and People (residents'
  comfort, water security, distance from noisy infrastructure).

What it does
------------
| | Data centre mode | Township mode |
|---|---|---|
| Main question | Is there enough water and open land, away from forests and homes? | Is it liveable: cool, green, safe from floods? |
| Factors (weight) | Water 30 · Nature 25 · Distance from homes 20 · Cooling climate 15 · Flood & slope 10 | Heat comfort 25 · Green space 25 · Water 20 · Flood & slope 15 · Nature 15 |
| Map grid | Suitability of every cell (10 × 10 grid) | Heat risk of every cell, with priority hotspots outlined |
| Extras | Best 3 spots to build; yearly water budget for the planned MW | Number of trees needed to reach 30% canopy (the 3-30-300 rule) |

Every result also includes:
- red flags (for example, severe water stress, a lot of forest, flood-prone land);
- a land-cover breakdown;
- the measured numbers behind each score;
- the optional Claude features below.

Claude features (optional, need an API key)
-------------------------------------------
The scores always come from the measured data and fixed rules in `analysis.py`. Claude **explains and
double-checks**; it never makes up the score.

| Feature | Model | What it does |
|---|---|---|
| 🔍 **Vision check** (button under *Best spots*) | Claude Opus 5.5 | Gets a sharp Esri satellite photo of each best spot with the spot outlined in yellow, plus the measured numbers. Reports what it sees, **plantation or natural forest**, roads, power lines, water and other concerns, whether the photo **agrees with the data**, and a verdict: looks suitable / check on site / not suitable. |
| 💬 **Chat guide** (floating window on the map) | Claude Haiku 5.5 | Gets the whole analysis, every grid cell and any vision findings. Answers questions like *"Where is the flood risk?"* or *"Where should we plant trees first?"* in plain English, and **outlines the matching areas on the map** with labels. |

Both use structured outputs, so the app always gets valid data back. The chat reuses the analysis
context between questions (prompt caching), which keeps it fast and cheap.

Satellite data used (all free, no keys)
---------------------------------------
| Dataset | What it gives us | Detail |
|---|---|---|
| [ESA WorldCover 2021](https://esa-worldcover.org) (Sentinel-1/2) | Trees, grass, crops, buildings, water, wetland, mangroves | 10 m |
| [Meta High Resolution Settlement Layer](https://dataforgood.facebook.com/dfg/tools/high-resolution-population-density-maps) | How many people live in each spot | 30 m |
| [Copernicus DEM GLO-30](https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model) | Height, slopes, low flood-prone land near rivers and the sea | 30 m |
| [NASA POWER](https://power.larc.nasa.gov) climatology | Average temperature, hottest-month highs, rainfall, humidity | ~50 km |
| Esri World Imagery, OpenStreetMap, NASA GIBS MODIS | Background maps; Esri photos for the vision check | – |

The land-cover, population and height maps are read straight from public cloud storage (AWS Open Data).
Only the small piece covering your area is downloaded, so an analysis takes about 2–3 seconds.

How to run
----------
1. Install Python 3.10 or newer.
2. Open a terminal in this folder and run:

       python -m venv .venv
       .venv\Scripts\activate          (Windows)   or   source .venv/bin/activate   (macOS/Linux)
       pip install -r requirements.txt
       python app.py

3. Open http://127.0.0.1:5000 in a browser.
4. Optional Claude features: create an API key at https://console.anthropic.com. Set it before
   `python app.py`:

       set ANTHROPIC_API_KEY=sk-ant-...          (Windows cmd)
       $env:ANTHROPIC_API_KEY="sk-ant-..."       (Windows PowerShell)
       export ANTHROPIC_API_KEY=sk-ant-...       (macOS/Linux)

   Everything else works without a key.

An internet connection is required.

4-minute demo script
--------------------
1. Click **Cyberjaya** (one of Malaysia's data-centre hubs) with **Data centre** selected, 30 MW.
   - Read out the score, the red flags and the water budget.
   - Click best spot **1** on the map.
2. Switch to **Township** for the same place. The map switches to the heat grid.
   - Click the first heat hotspot in the list. Show how many trees it needs and the
     "shaded walkways and cool roofs" advice.
3. Open the layer menu (top right) and switch on **Land cover**. This is what the satellites see.
4. Click **🔍 Check these spots with Claude vision**. Show the photo cards, especially one where Claude
   spots plantation rows that the land-cover data called "trees".
5. In the chat, ask *"Where is the flood risk?"* and watch Claude outline the areas on the map.
   Then ask *"Which spot is best and why?"*

How the scores work (short version)
-----------------------------------
- **Water:** usable rain-fed water within a 20 km area is compared with what residents and the new
  project would use. Using 10% of the supply is fine; 40% or more is high stress; 100% or more is
  unsustainable.
  - Assumptions: 30% of rain becomes usable water, a data centre uses 1.8 L per kWh, a resident uses
    200 L a day.
- **Nature:** the share of tree cover, mangroves and wetland that building could destroy.
- **Distance from homes:** people per km². Rural areas are best for a data centre.
- **Cooling climate:** cooler places need less energy and water to cool servers.
- **Flood & slope:** the share of land less than 5 m above nearby water (within 1 km), plus the share
  steeper than 15%.
- **Heat comfort:** roofs, roads and bare soil compared with shade and water, plus how hot the hottest
  month gets.
- **Green space:** tree canopy within walking distance, against the 30% target.
- **Best spots:** grid cells with at least 35% open land, little water and less than 30% trees or
  wetland, ranked by their own score and spread apart.

Limitations (worth saying to judges)
------------------------------------
- WorldCover counts **plantations (oil palm, rubber) as tree cover**, so "forest" can include
  plantations. Check on the ground.
- The height map measures the tops of trees and buildings. We filter them out, but flood-prone land is
  an estimate, not a flood model.
- The water budget is a rough, rain-only estimate. It ignores rivers flowing in from elsewhere and
  water already promised to other users.
- If a dataset can't be downloaded, its factors are skipped and the result is marked **(provisional)**.
- Claude's vision check and chat can be wrong, so treat them as a second opinion.
- The vision-check photos are Esri World Imagery; check Esri's terms before any commercial use.
- This is a screening tool for picking where to look first. It does not replace an environmental
  impact assessment.

Files
-----
| File | What it is |
|---|---|
| `app.py` | Flask web server: place search, `/api/analyze`, `/api/vision-check`, `/api/chat`, `/api/image` |
| `ai.py` | Claude vision check (Opus) and chat guide with map highlights (Haiku) |
| `imagery.py` | Builds the outlined satellite photo of each spot from Esri map tiles |
| `analysis.py` | Scores, best spots, heat hotspots, water budget, recommendations |
| `datasources.py` | Reads WorldCover, population, height and NASA POWER data |
| `Design.Html`, `Design.Css`, `Design.Js` | The map dashboard |
| `vendor/leaflet/` | Leaflet 1.9.4 map library (BSD-2 licence), so the map works without a CDN |
| `tests/` | Automated tests: `pip install pytest` then `python -m pytest` (no internet needed) |
| `requirements.txt` | Python libraries needed |
