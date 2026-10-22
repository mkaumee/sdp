# ai.py — the two Claude features of ClimateSmart AI.
#   1. Vision check: Claude Opus looks at satellite photos of the best spots and checks what the data can't see
#      (plantation rows vs natural forest, roads, power lines, landfills...).
#   2. Chat guide: Claude Haiku answers questions about the analysis in plain language and picks grid cells
#      to highlight on the map.
# The scores themselves never come from AI — they come from analysis.py. Claude explains and double-checks.

import base64  # images travel to Claude and to the browser as base64 text
import json  # Claude's structured answers are JSON
from concurrent.futures import ThreadPoolExecutor  # build the site photos in parallel

import anthropic  # the official Claude SDK

import imagery  # satellite photos of the candidate sites
from analysis import CELLS  # grid size (10 x 10)

VISION_MODEL = "claude-opus-5-5"  # strongest visual reasoning for the site check
CHAT_MODEL = "claude-haiku-5-5"  # fast and cheap for back-and-forth chat
MAX_HIGHLIGHTS = 4  # highlight groups per chat answer
MAX_HISTORY = 24  # chat messages kept per request
MAX_MESSAGE_CHARS = 4000  # longest single chat message accepted


class AIError(Exception):
    """A problem worth showing to the user, with the HTTP status to send."""

    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


def _ask(beta=False, **request):
    """Send one request to Claude and return (parsed JSON answer, model that answered)."""
    try:
        client = anthropic.Anthropic(timeout=120)  # reads ANTHROPIC_API_KEY (or an `ant auth login` profile)
        api = client.beta.messages if beta else client.messages  # the beta endpoint is needed for server-side fallbacks
        message = api.create(**request)
    except TypeError as err:
        if "authentication" not in str(err).lower():  # a real programming error: don't hide it
            raise
        raise AIError("Claude features are off: set the ANTHROPIC_API_KEY environment variable and restart app.py.", 503)
    except anthropic.AuthenticationError:
        raise AIError("The ANTHROPIC_API_KEY was rejected. Check the key and restart app.py.", 503)
    except anthropic.RateLimitError:
        raise AIError("Claude is busy (rate limited). Try again in a minute.", 503)
    except anthropic.APIStatusError as err:
        raise AIError(f"Claude API error ({err.status_code}): {err.message}", 502)
    except anthropic.APIConnectionError:
        raise AIError("Could not reach the Claude API. Check your internet connection.", 502)
    if message.stop_reason == "refusal":  # declined (after any fallback model declined too)
        raise AIError("Claude declined this request.", 502)
    if message.stop_reason == "max_tokens":  # ran out of room before finishing the JSON
        raise AIError("Claude's answer was cut off. Try a shorter question.", 502)
    text = next((block.text for block in message.content if block.type == "text"), None)  # skip thinking blocks
    try:
        return json.loads(text), message.model  # structured outputs guarantee valid JSON
    except (TypeError, ValueError):
        raise AIError("Claude returned an unreadable answer. Try again.", 502)


# ---------- 1. Vision check of the best spots ----------

VISION_SYSTEM = (
    "You are a remote-sensing analyst checking candidate building sites from satellite photos. "
    "In each photo the yellow box marks the candidate grid cell; everything outside it is context. "
    "Judge only what you can see and answer 'unclear' when you can't tell. "
    "Oil-palm and rubber plantations show regular rows or grids of similar-sized tree crowns, usually with straight "
    "access tracks; natural forest has irregular crowns of mixed sizes and textures. "
    "Look for roads, power lines, substations, buildings, water bodies, wetlands, landfills, quarries, and "
    "construction. Grey squares are missing imagery."
)

VISION_SCHEMA = {
    "type": "object",
    "properties": {
        "spots": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "rank": {"type": "integer"},
                    "what_i_see": {"type": "string"},
                    "plantation": {"type": "string", "enum": ["yes", "no", "unclear"]},
                    "natural_forest": {"type": "string", "enum": ["yes", "no", "unclear"]},
                    "infrastructure": {"type": "array", "items": {"type": "string"}},
                    "concerns": {"type": "array", "items": {"type": "string"}},
                    "agrees_with_data": {"type": "boolean"},
                    "verdict": {"type": "string", "enum": ["looks suitable", "check on site", "not suitable"]},
                    "explanation": {"type": "string"},
                },
                "required": ["rank", "what_i_see", "plantation", "natural_forest", "infrastructure", "concerns",
                             "agrees_with_data", "verdict", "explanation"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["spots"],
    "additionalProperties": False,
}


def _spot_facts(spot):
    """The measured numbers for one spot, as a short line for the prompt."""
    return (f"measured from satellite data: {spot['tree_pct']}% tree cover, {spot['built_pct']}% built-up, "
            f"{spot['water_pct']}% water, {spot['buildable_pct']}% open land, "
            f"{spot['low_lying_pct'] if spot['low_lying_pct'] is not None else 'unknown'}% flood-prone, "
            f"~{spot['people'] if spot['people'] is not None else 'unknown'} residents, mostly {spot['main_cover']}")


def vision_check(result, photo=imagery.site_photo):
    """Ask Claude Opus to inspect satellite photos of the top spots. Returns {"spots": [...], "model": ...}."""
    spots = result["candidates"]  # best spots chosen by analysis.py
    if not spots:
        raise AIError("There are no best spots to check in this area.", 400)
    with ThreadPoolExecutor(max_workers=3) as pool:
        photos = list(pool.map(lambda s: photo(s["bounds"]), spots))  # one photo per spot, in parallel

    purpose = (f"a {result['size']:g} MW data centre" if result["purpose"] == "datacentre"
               else f"a township for {result['size']:g} new residents")
    content = []  # text and photos, alternating
    for spot, pic in zip(spots, photos):
        content.append({"type": "text", "text": f"Spot {spot['rank']} (photo about {pic['width_m']:,} m wide; "
                                                f"yellow box = candidate cell, {_spot_facts(spot)}):"})
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                    "data": base64.b64encode(pic["jpeg"]).decode()}})
    content.append({"type": "text", "text": (
        f"These spots were picked as the best places in the area for {purpose}. For each spot, describe what is "
        "inside the yellow box, say whether it looks like plantation or natural forest, list visible infrastructure "
        "and concerns, say whether the photo agrees with the measured data, give a verdict, and explain it in at "
        "most 50 words.")})

    answer, model = _ask(
        beta=True,
        model=VISION_MODEL,
        max_tokens=16000,
        system=VISION_SYSTEM,
        messages=[{"role": "user", "content": content}],
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": VISION_SCHEMA}},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",  # if Opus declines, Anthropic retries on its recommended fallback model
    )
    by_rank = {s["rank"]: s for s in answer["spots"]}  # Claude's findings, keyed by spot number
    checked = []
    for spot, pic in zip(spots, photos):
        finding = by_rank.get(spot["rank"])
        if finding is None:  # Claude skipped a spot
            continue
        thumb = base64.b64encode(imagery.thumbnail(pic["jpeg"])).decode()  # smaller copy for the dashboard
        checked.append({**finding, "rank": spot["rank"], "row": spot["row"], "col": spot["col"],
                        "bounds": spot["bounds"], "center": spot["center"],
                        "photo": "data:image/jpeg;base64," + thumb})
    return {"spots": checked, "model": model}


# ---------- 2. Chat guide with map highlights ----------

CHAT_SYSTEM = (
    "You are the ClimateSmart AI guide inside a map dashboard used by property developers and hackathon judges. "
    "The user sees a satellite map of the analysed area and a panel with scores. You get the full analysis below.\n"
    "- Answer conversationally in plain English, usually in under 120 words. Use **bold** for key numbers sparingly.\n"
    "- Use only the analysis data. If something isn't in it (zoning, grid power, soil, prices), say the data "
    "doesn't cover it and suggest how to find out.\n"
    "- Scores come from the analysis rules; explain them, don't invent new scores.\n"
    "- Describe places with compass directions (\"the north-east corner\", \"along the eastern edge\"); the user "
    "can't see row/column numbers. Row 0 is the northern edge, column 0 the western edge.\n"
    "- When pointing at places helps, add highlights: each is a short label, a tone (good = recommended, "
    "warning = caution, bad = risk, info = neutral) and the grid cells to outline. Use at most 3 highlights and "
    "pick cells from the CELLS table that actually match what you say. Leave highlights empty when the map "
    "doesn't help.\n"
    "- If the vision check has been run, use its findings (e.g. plantation vs natural forest)."
)

CHAT_SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {"type": "string"},
        "highlights": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "tone": {"type": "string", "enum": ["good", "warning", "bad", "info"]},
                    "cells": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"row": {"type": "integer"}, "col": {"type": "integer"}},
                            "required": ["row", "col"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["label", "tone", "cells"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["reply", "highlights"],
    "additionalProperties": False,
}

CELL_COLUMNS = ["row", "col", "score", "heat_risk", "tree_pct", "built_pct", "water_pct", "bare_pct",
                "buildable_pct", "sensitive_pct", "low_lying_pct", "people", "main_cover"]


def chat_context(result, vision=None):
    """Everything the chat model needs to know, as text (the land-cover picture is left out)."""
    loc = result["location"]
    facts = {
        "area": {"centre_lat": loc["lat"], "centre_lon": loc["lon"], "width_km": loc["width_km"],
                 "grid": f"{CELLS} x {CELLS} cells, each {loc['width_km'] / CELLS:g} km wide"},
        "purpose": result["purpose_label"],
        "planned_size": (f"{result['size']:g} MW IT load" if result["purpose"] == "datacentre"
                         else f"{result['size']:g} new residents"),
        "overall_score": result["overall"],
        "verdict": result["verdict"]["label"],
        "factors": [{k: f[k] for k in ("label", "score", "weight", "detail")} for f in result["factors"]],
        "red_flags": [f["text"] for f in result["flags"]],
        "metrics": result["metrics"],
        "climate": result["climate"],
        "water_budget_m3_per_year": result["water"],
        "land_cover_pct": {c["name"]: c["pct"] for c in result["landcover"]},
        "best_spots": [{k: c[k] for k in ("rank", "row", "col", "score", "reason")} for c in result["candidates"]],
        "heat_hotspots": [{k: h[k] for k in ("rank", "row", "col", "tree_pct", "built_pct", "trees_needed", "action")}
                          for h in result["hotspots"]],
        "recommendations": [f"{r['title']}: {r['text']}" for r in result["recommendations"]],
        "assumptions": result["assumptions"],
        "missing_data": result["warnings"],
        "data_sources": result["sources"],
    }
    if vision:  # findings from the photo check, without the photos
        facts["vision_check"] = [{k: v for k, v in s.items() if k not in ("photo", "bounds", "center")}
                                 for s in vision["spots"]]
    rows = [",".join(CELL_COLUMNS)]  # cells as a compact table
    for cell in result["cells"]:
        rows.append(",".join("" if cell[k] is None else str(cell[k]) for k in CELL_COLUMNS))
    return ("ANALYSIS (JSON):\n" + json.dumps(facts, indent=1) +
            "\n\nCELLS (one row per grid cell; *_pct are percentages; heat_risk runs from -1 leafy to +1 all "
            "concrete; low_lying_pct is flood-prone land):\n" + "\n".join(rows))


def check_history(messages):
    """Make sure the chat history from the browser is a sensible, size-limited conversation."""
    if not isinstance(messages, list) or not messages:
        raise AIError("Send at least one message.", 400)
    messages = messages[-MAX_HISTORY:]  # keep the most recent turns
    if messages[0].get("role") != "user":  # trimming may start on a reply; drop it
        messages = messages[1:]
    clean = []
    for i, m in enumerate(messages):
        role, text = m.get("role"), m.get("content")
        if role != ("user" if i % 2 == 0 else "assistant") or not isinstance(text, str) or not text.strip():
            raise AIError("Chat history must alternate user and assistant messages.", 400)
        if len(text) > MAX_MESSAGE_CHARS:
            raise AIError(f"Messages must be under {MAX_MESSAGE_CHARS} characters.", 400)
        clean.append({"role": role, "content": text.strip()})
    if not clean or clean[-1]["role"] != "user":
        raise AIError("The last message must be from the user.", 400)
    return clean


def clean_highlights(raw, result):
    """Keep only valid grid cells and attach their map bounds."""
    bounds = {(c["row"], c["col"]): c["bounds"] for c in result["cells"]}  # cell -> [[s, w], [n, e]]
    out = []
    for h in raw[:MAX_HIGHLIGHTS]:
        cells, seen = [], set()
        for cell in h.get("cells", []):
            key = (cell.get("row"), cell.get("col"))
            if key in bounds and key not in seen:  # real cell, not repeated
                seen.add(key)
                cells.append({"row": key[0], "col": key[1], "bounds": bounds[key]})
        if cells:
            out.append({"label": str(h.get("label", ""))[:60], "tone": h.get("tone", "info"), "cells": cells})
    return out


def chat(result, messages, vision=None):
    """Answer the latest chat message. Returns {"reply": text, "highlights": [...], "model": ...}."""
    history = check_history(messages)
    answer, model = _ask(
        model=CHAT_MODEL,
        max_tokens=16000,
        system=[{"type": "text", "text": CHAT_SYSTEM}, {"type": "text", "text": chat_context(result, vision)}],
        messages=history,
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": CHAT_SCHEMA}},
        cache_control={"type": "ephemeral"},  # reuse the analysis context across chat turns (cheaper, faster)
    )
    return {"reply": answer["reply"].strip(), "highlights": clean_highlights(answer["highlights"], result),
            "model": model}
