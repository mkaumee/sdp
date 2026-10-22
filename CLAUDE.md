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
people, and highlights township heat hotspots that need trees and shade.

| File | Role |
|---|---|
| `app.py` | Flask server: `/api/search`, `/api/analyze`, `/api/vision-check`, `/api/chat`, `/api/image`, static files |
| `datasources.py` | Reads ESA WorldCover, Meta HRSL population and Copernicus DEM from AWS Open Data, plus NASA POWER climate |
| `analysis.py` | Rule-based scores on a 10x10 grid, best spots, heat hotspots, water budget, recommendations |
| `imagery.py` | Builds outlined Esri satellite photos of candidate cells |
| `ai.py` | Claude Opus 5.5 vision check and Claude Haiku 5.5 chat guide (structured outputs, map highlights) |
| `Design.Html`, `Design.Css`, `Design.Js` | Leaflet map dashboard. Keep these file names; app.py serves them by name. |
| `vendor/leaflet/` | Vendored Leaflet 1.9.4; don't edit |
| `tests/` | Offline pytest suite; fakes replace every download and the Claude client |

## Conventions

- **Scores come only from the rules in `analysis.py`.** Claude explains and double-checks results; it
  never produces scores.
- **Match the existing comment style:** plain-English comments on most lines, written for a learning
  project.
- **Python is the only backend language.** The front end is plain JavaScript with no build step.
- Front-end files may only be served if they're in the `FRONTEND_FILES` allow-list in `app.py`.

## Run and test

    pip install -r requirements.txt
    python app.py                     # http://127.0.0.1:5000
    pip install pytest && python -m pytest

- The Claude features need `ANTHROPIC_API_KEY`; everything else works without it.
- Cloud sessions may block some hosts: NASA POWER, OpenStreetMap, Esri tiles and map CDNs. The AWS
  Open Data buckets usually work. When a test can't reach a service, say so rather than faking results.
