# CLAUDE.md

Guidance for Claude (and other AI assistants) working in this repository.

## Commit rules — always follow these

1. **Commit bit by bit.** One small, focused change per commit (for example, one module, one endpoint or
   one UI feature), never one big commit for a whole session's work. Each commit should leave the app
   working and the tests passing.
2. **The author is the repo owner, never Claude.** Before the first commit in a session, run:

       git config user.name "mkaumee"
       git config user.email "m.kaumee@icloud.com"

   Then check with `git log -1 --format='%an <%ae> / %cn <%ce>'` that both author and committer are
   `mkaumee <m.kaumee@icloud.com>`.
3. **No `Co-Authored-By: Claude` trailer** (or any other trailer that lists Claude as an author).
4. Commit messages: a short imperative subject line (for example, "Add /api/chat endpoint"), a blank
   line, then a sentence or two on what changed and why.

## Project

**ClimateSmart AI** is a hackathon project (People / Planet challenge). It uses free satellite data to
find where to build **data centres** and **townships** without harming the environment or nearby
people, and shows existing townships where heat builds up and where trees and shade are needed.

Two front ends share one Flask server:

- **The dashboard** at `/`: the team's ClimateSearch React UI (urban heat and greening intelligence).
- **The site finder** at `/site-finder`: the original Leaflet page for siting data centres and townships.

| File | Role |
|---|---|
| `app.py` | Flask server: `/api/search`, dashboard `/api/area`, `/api/reports`, `/api/assistant`; site finder `/api/analyze`, `/api/vision-check`, `/api/chat`, `/api/image`; serves both front ends |
| `datasources.py` | Reads ESA WorldCover, Meta HRSL population and Copernicus DEM from AWS Open Data, plus NASA POWER climate |
| `sentinel2.py` | Sentinel-2 L2A NDVI and true-colour photos from AWS Open Data (Element84 COGs) |
| `landsat.py` | Landsat 8/9 Collection 2 surface temperature from Microsoft Planetary Computer |
| `urban.py` | Dashboard analysis: 12x12 cells, 3x3 zones, hotspots, greening sites, metrics, overlays, notifications |
| `reports.py` | The dashboard's six report templates and wizard metrics |
| `assistant.py` | Dashboard chat: Claude Haiku 5.5 with Sentinel-2 photos, or offline answers without a key |
| `analysis.py` | Site finder: rule-based scores on a 10x10 grid, best spots, heat hotspots, water budget, recommendations |
| `imagery.py` | Builds outlined Esri satellite photos of candidate cells |
| `ai.py` | Claude Opus 5.5 vision check and Claude Haiku 5.5 chat guide (structured outputs, map highlights) |
| `ClimateSearch/` | Dashboard source: React 18 + TypeScript + Vite + Tailwind + Zustand. Flask serves its `dist/` build |
| `Design.Html`, `Design.Css`, `Design.Js` | Site finder page. Keep these file names; app.py serves them by name. |
| `vendor/leaflet/` | Vendored Leaflet 1.9.4; don't edit |
| `tests/` | Offline pytest suite; fakes replace every download and the Claude client |

## Conventions

- **Scores come only from the rules in `analysis.py` and `urban.py`.** Claude explains and double-checks
  results; it never produces scores.
- **Every number says where it came from.** Keep the provenance labels; when a measurement falls back to an
  estimate, the UI must show it as an estimate.
- **Match the existing comment style:** plain-English comments on most lines, written for a learning
  project.
- **Python is the only backend language.** The site finder is plain JavaScript with no build step. The
  dashboard is TypeScript built with Vite; don't commit `ClimateSearch/dist` or `node_modules`.
- **Build the dashboard around the team's UI:** keep its layout, labels and file names; wire them to real
  data rather than redesigning them.
- Site-finder files may only be served if they're in the `FRONTEND_FILES` allow-list in `app.py`; the
  dashboard's files are served only from `ClimateSearch/dist`.

## Run and test

    pip install -r requirements.txt
    cd ClimateSearch && npm install && npm run build && cd ..    # build the dashboard
    python app.py                     # http://127.0.0.1:5000 (dashboard), /site-finder
    pip install pytest && python -m pytest
    cd ClimateSearch && npm run build                             # also type-checks the dashboard

- The Claude features need `ANTHROPIC_API_KEY`; everything else works without it.
- Cloud sessions may block some hosts: NASA POWER, Microsoft Planetary Computer (Landsat), OpenStreetMap,
  Esri tiles and map CDNs. The AWS Open Data buckets (WorldCover, HRSL, DEM, Sentinel-2) usually work.
  When a test can't reach a service, say so rather than faking results.
