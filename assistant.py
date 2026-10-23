# assistant.py — the dashboard's chat assistant (the "Chat" panel in ClimateSearch).
# Claude Haiku answers questions about the analysed area using only its measurements, and can attach a
# real satellite photo (Sentinel-2 true colour, or Esri imagery as a fallback) of the area, a hotspot,
# a greening site or a zone. Without an API key it still answers common questions from the data.

import base64  # photos travel to the browser as base64 text
import json  # the area summary given to Claude
import math  # degrees of longitude shrink away from the equator

import datasources as ds  # square boxes around places, and the download error type
import imagery  # Esri photos when Sentinel-2 has no clear view
import sentinel2  # real dated satellite photos
from ai import CHAT_MODEL, AIError, _ask  # the shared Claude call and error type
from urban import fmt_date  # '2026-08-14' -> '14 Aug 2026'

MAX_TURNS = 20  # chat messages sent to Claude per question
MAX_CHARS = 4000  # longest message accepted

STYLES = {  # the Settings page's "Assistant Response Style"
    "concise": "Answer in short bullet points (at most 6), under 90 words.",
    "scientific": "Explain the science briefly and give the satellite source and date for every number. Under 170 words.",
    "strategic": "Focus on policy and action: who should do what first, with the numbers that justify it. Under 150 words.",
}

SYSTEM = (
    "You are the ClimateSmart AI assistant inside an urban climate dashboard used by township planners. "
    "You get the current area's satellite analysis below. Use only those numbers; never invent measurements, "
    "places or dates. If the data doesn't cover something (zoning, prices, air temperature records), say so. "
    "Scores come from fixed screening rules — explain them, don't change them. If surface temperature is "
    "marked as an estimate, say it is estimated. Use **bold** for key numbers and '- ' for bullet points.\n"
    "When the user asks to see, show, view or zoom into a satellite image or photo, set image.target to "
    "'area', 'hotspot', 'greening' or 'zone' and image.id to that item's id (use the selected item if the user "
    "says 'this'); otherwise set image.target to 'none' and image.id to ''."
)

SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {"type": "string"},
        "image": {
            "type": "object",
            "properties": {"target": {"type": "string", "enum": ["none", "area", "hotspot", "greening", "zone"]},
                           "id": {"type": "string"}},
            "required": ["target", "id"],
            "additionalProperties": False,
        },
    },
    "required": ["reply", "image"],
    "additionalProperties": False,
}


# ---------- What Claude is told ----------

def area_summary(data, ui):
    """The analysis as compact JSON, plus what the user is looking at."""
    pick = lambda items, keys: [{k: i.get(k) for k in keys} for i in items]
    facts = {
        "area": data["area"],
        "data_sources": {k: (v if isinstance(v, str) else {x: v.get(x) for x in ("label", "sensor", "dates", "note", "isEstimate")})
                         for k, v in data["provenance"].items() if v and k in ("surfaceTemp", "vegetation", "landcover", "population")},
        "metrics": pick(data["metrics"], ["label", "value", "unit", "description"]),
        "thresholds": data["thresholds"],
        "vegetation_temperature_correlation_r": data["correlation"],
        "zones": pick(data["zones"], ["id", "name", "surfaceTemp", "vegetationCoverage", "ndvi", "priorityScore", "severity", "builtPct", "treePct", "people"]),
        "hotspots": pick(data["hotspots"], ["id", "name", "surfaceTemp", "vegetationCoverage", "area", "priorityScore", "severity",
                                            "people", "contributing_factors", "mitigation_suggestions", "imageDate"]),
        "greening_sites": pick(data["greeningCandidates"], ["id", "name", "candidateArea", "currentVegetation", "surfaceTemp",
                                                            "priorityScore", "reasoning", "recommendedAction", "nearestHotspotId"]),
        "missing_data": data["warnings"],
    }
    seen = {k: ui.get(k) for k in ("route", "selectedLocation", "selectedHotspot", "selectedCandidate") if ui.get(k)}
    return "AREA ANALYSIS (JSON):\n" + json.dumps(facts, default=str) + "\n\nUSER IS LOOKING AT: " + json.dumps(seen)


def clean_history(messages):
    """Keep user/assistant text turns, merge repeats, start with the user and end with the user's question."""
    if not isinstance(messages, list):
        raise AIError("Send the conversation as a list of messages.", 400)
    turns = []
    for m in messages[-MAX_TURNS * 2:]:
        role, text = (m or {}).get("role"), (m or {}).get("content")
        if role not in ("user", "assistant") or not isinstance(text, str) or not text.strip():
            continue  # skip welcome notes, errors and empty bubbles
        if len(text) > MAX_CHARS:
            raise AIError(f"Messages must be under {MAX_CHARS} characters.", 400)
        if turns and turns[-1]["role"] == role:
            turns[-1]["content"] += "\n\n" + text.strip()  # two in a row (e.g. after an error): merge them
        else:
            turns.append({"role": role, "content": text.strip()})
    turns = turns[-MAX_TURNS:]  # the most recent turns only
    while turns and turns[0]["role"] != "user":  # Claude needs the conversation to start with the user
        turns.pop(0)
    if not turns or turns[-1]["role"] != "user":
        raise AIError("The last message must be the user's question.", 400)
    return turns


# ---------- Satellite photos ----------

def find_target(data, kind, item_id):
    """(name, bounds) of what to photograph."""
    if kind == "area":
        b = data["area"]["bounds"]
        return data["area"]["name"], [[b["south"], b["west"]], [b["north"], b["east"]]]
    pools = {"hotspot": data["hotspots"], "greening": data["greeningCandidates"], "zone": data["zones"]}
    item = next((i for i in pools.get(kind, []) if i["id"] == item_id), None)
    return (item["name"], item["bounds"]) if item else None


def square_view(bounds, margin=0.6, min_km=1.2):
    """A square photo frame around a box, with some surroundings."""
    (south, west), (north, east) = bounds
    lat, lon = (south + north) / 2, (west + east) / 2
    height_km = (north - south) * 111.32
    width_km = (east - west) * 111.32 * max(0.01, math.cos(math.radians(lat)))
    size = max(min_km, max(height_km, width_km) * (1 + margin))
    s, w, n, e = ds.bounding_box(lat, lon, size)
    return [[s, w], [n, e]]


def photo(data, kind, item_id):
    """A media attachment {url, caption, metadata} for the chat, or None."""
    target = find_target(data, kind, item_id)
    if not target:
        return None
    name, bounds = target
    view = bounds if kind == "area" else square_view(bounds)
    outline = None if kind == "area" else bounds
    try:
        pic = sentinel2.true_colour(view, max_px=640, outline=outline)
        meta = f"{pic['platform']} • 10 m • {fmt_date(pic['date'])}"
    except ds.DataUnavailable:
        try:
            pic = imagery.site_photo(bounds if outline else view, margin=0.3 if outline else 0.0, max_px=640)
            meta = "Esri World Imagery (date varies)"
        except ds.DataUnavailable:
            return None
    return {"url": "data:image/jpeg;base64," + base64.b64encode(pic["jpeg"]).decode(), "caption": name, "metadata": meta}


# ---------- Answering ----------

def ask(data, messages, ui=None, style="scientific"):
    """Answer the latest question. Returns {"reply", "media", "model"}."""
    ui = ui or {}
    history = clean_history(messages)
    try:
        answer, model = _ask(
            model=CHAT_MODEL,
            max_tokens=16000,
            system=[{"type": "text", "text": SYSTEM + "\n" + STYLES.get(style, STYLES["scientific"])},
                    {"type": "text", "text": area_summary(data, ui)}],
            messages=history,
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
            cache_control={"type": "ephemeral"},  # reuse the area summary across questions
        )
    except AIError as err:
        if not err.no_key:
            raise
        return offline(data, history[-1]["content"], ui)  # no key: answer from the data without Claude
    image = answer.get("image") or {}
    media = photo(data, image.get("target"), image.get("id")) if image.get("target") not in (None, "none") else None
    return {"reply": answer["reply"].strip(), "media": media, "model": model}


# ---------- Offline answers (no API key) ----------

EXPLAIN = {
    "uhi": ("**Urban heat islands** form when hard surfaces (asphalt, concrete, roofs) absorb sunlight and release it "
            "as heat, vegetation is scarce so there is little cooling from evapotranspiration, and traffic and buildings "
            "add waste heat. Cities can be 1–7°C warmer than their surroundings; trees, cool roofs and permeable paving help."),
    "ndvi": ("**NDVI** (Normalized Difference Vegetation Index) = (NIR − Red) / (NIR + Red) from satellite bands. "
             "About 0.6–0.9 is dense healthy vegetation, 0.2–0.4 sparse, below 0.2 bare or built-up ground, and "
             "below 0 water. It measures greenness, not tree canopy directly."),
    "lst": ("**Land surface temperature (LST)** is the skin temperature of the ground measured by thermal infrared "
            "sensors such as Landsat 8/9 TIRS. It is not air temperature: sunlit roofs and roads can be 10–20°C hotter "
            "than the air, and clouds block the measurement."),
    "veg": ("**Vegetation cools cities** by shading surfaces, by evapotranspiration (plants release water vapour) and by "
            "storing less heat than paving. Mature street trees can lower nearby surface temperatures by several degrees."),
}


def offline(data, question, ui):
    """A useful answer built from the data when Claude isn't set up."""
    q = question.lower()
    area, hot, green = data["area"]["name"], data["hotspots"], data["greeningCandidates"]
    top = hot[0] if hot else None
    selected = ui.get("selectedHotspot") or ui.get("selectedCandidate") or ui.get("selectedLocation")
    picked = next((i for i in hot + green + data["zones"] if selected and i["name"] == selected), None)
    named = next((i for i in hot + green + data["zones"] if i["name"].lower() in q), None)
    focus = named or picked
    note = "\n\n_Offline answer from the data — set ANTHROPIC_API_KEY for the full Claude assistant._"
    temp_src = data["provenance"]["surfaceTemp"]["label"]
    media = None
    if any(w in q for w in ("image", "photo", "picture", "satellite", "zoom", "show me", "view")):
        if focus:
            kind = "hotspot" if focus in hot else "greening" if focus in green else "zone"
        elif "hot" in q and top:
            focus, kind = top, "hotspot"
        else:
            kind = "area"
        media = photo(data, kind, focus["id"] if focus else "")
        name = focus["name"] if focus else area
        text = (f"Here is the clearest recent satellite image of **{name}** ({media['metadata']})."
                if media else f"Sorry, no clear satellite image of {name} could be downloaded.")
    elif "heat island" in q or "uhi" in q:
        text = EXPLAIN["uhi"] + (f"\n\nIn {area}, the hottest patch is **{top['name']}** at **{top['surfaceTemp']}°C** "
                                 f"({temp_src})." if top else "")
    elif "ndvi" in q:
        ndvis = [z["ndvi"] for z in data["zones"] if z["ndvi"] is not None]
        text = EXPLAIN["ndvi"] + (f"\n\nAverage NDVI in {area}: **{sum(ndvis) / len(ndvis):.2f}** "
                                  f"({data['provenance']['vegetation']['label']})." if ndvis else "")
    elif "surface temperature" in q or "lst" in q.split():
        text = EXPLAIN["lst"] + f"\n\nTemperatures here come from: **{temp_src}**."
    elif "vegetation" in q and any(w in q for w in ("reduce", "cool", "help")):
        text = EXPLAIN["veg"]
    elif focus and focus in hot:
        text = (f"**{focus['name']}** — {focus['surfaceTemp']}°C, {focus['vegetationCoverage']}% vegetation, "
                f"priority {focus['priorityScore']}/100.\n" + "\n".join(f"- {f}" for f in focus["contributing_factors"])
                + "\n\n**Recommended:**\n" + "\n".join(f"- {m}" for m in focus["mitigation_suggestions"]))
    elif focus and focus in green:
        text = f"**{focus['name']}** ({focus['candidateArea']} ha): {focus['reasoning']}\n\n**Action:** {focus['recommendedAction']}"
    elif any(w in q for w in ("plant", "tree", "green", "priorit")) and green:
        text = f"Top greening sites in {area}:\n" + "\n".join(
            f"- **{g['name']}** ({g['candidateArea']} ha, priority {g['priorityScore']}): {g['recommendedAction']}" for g in green[:3])
    else:
        m = {x["id"]: x for x in data["metrics"]}
        text = (f"**{area}**: average surface temperature **{m['m1']['value']}{m['m1']['unit']}** ({temp_src}), "
                f"vegetation **{m['m2']['value']}%**, **{m['m3']['value']}** heat hotspots and **{m['m4']['value']}** "
                "greening sites." + (f" The top priority is **{top['name']}** ({top['surfaceTemp']}°C)." if top else ""))
    return {"reply": text + note, "media": media, "model": "offline"}
