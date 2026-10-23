# reports.py — builds the Reports page's documents from a real area analysis (urban.py).
# Each template gets its own "Executive Findings" paragraph; every metric the report wizard offers
# is computed from the measurements, or honestly marked as not available.

from datetime import date, datetime, timezone  # report dates
from statistics import pstdev  # spread of zone temperatures

TEMPLATE_TITLES = {  # the six templates in the dashboard's Reports page
    "urban-heat": "Urban Heat Island Assessment",
    "vegetation-coverage": "Vegetation & Canopy Coverage Report",
    "hotspot-prioritization": "Hotspot Prioritization Dossier",
    "greening-opportunity": "Urban Greening Opportunity Assessment",
    "zone-comparison": "Multi-Zone Comparative Analysis",
    "climate-overview": "Executive Climate Resilience Summary",
}


def _avg(values):
    values = [v for v in values if v is not None]
    return sum(values) / len(values) if values else None


def _t(value):
    return "n/a" if value is None else f"{value:.1f}°C"


def _people_in_hotspots(data):
    return sum(h.get("people") or 0 for h in data["hotspots"])


def _tree_pct(data):
    return _avg([c["treePct"] for c in data["cells"]])


def _impervious(data):
    return _avg([c["builtPct"] + c["barePct"] for c in data["cells"]])


def _ndvi(data):
    return _avg([c["ndvi"] for c in data["cells"]])


def _temps(data):
    return [c["surfaceTemp"] for c in data["cells"] if c["surfaceTemp"] is not None]


def _plantable_ha(data):
    return sum(g["candidateArea"] for g in data["greeningCandidates"])


def _ranking(data):
    return "; ".join(f"{i + 1}. {h['name']} ({h['priorityScore']}/100)" for i, h in enumerate(data["hotspots"][:3])) or "No hotspots"


def _exceedance(data):
    critical, temps = data["thresholds"]["critical"], _temps(data)
    if critical is None or not temps:
        return "n/a"
    return f"{sum(t >= critical for t in temps) / len(temps) * 100:.0f}% of the area is at or above {critical:.1f}°C"


def _ease(data):
    open_ground = _avg([c["openPct"] for c in data["cells"]]) or 0
    level = "High" if open_ground >= 25 else "Medium" if open_ground >= 10 else "Low"
    return f"{level} — {open_ground:.0f}% of the ground is open (bare, grass or shrub) and free to plant"


# Every metric name used by the templates and the wizard -> (value, note).
METRICS = {
    "Land Surface Temperature": lambda d, z: (f"mean {_t(_avg(_temps(d)))}, max {_t(max(_temps(d), default=None))}", None),
    "Land Surface Temperature (LST) Mean & Maxima": lambda d, z: (f"mean {_t(_avg(_temps(d)))}, max {_t(max(_temps(d), default=None))}", None),
    "Thermal Intensity Index": lambda d, z: (
        _t(_avg([h["surfaceTemp"] for h in d["hotspots"]]) - d["thresholds"]["tempMin"])
        if d["hotspots"] and d["thresholds"]["tempMin"] is not None else "n/a",
        "Average hotspot temperature above the coolest part of the area"),
    "Population Exposure": lambda d, z: (f"{_people_in_hotspots(d):,} residents in hotspots", "Meta HRSL population"),
    "Thermal Heat Exposure Risk Quotient": lambda d, z: (
        f"{_people_in_hotspots(d) / max(sum(c['people'] or 0 for c in d['cells']), 1) * 100:.0f}% of residents live in hotspots", None),
    "NDVI Mean Score": lambda d, z: ("n/a" if _ndvi(d) is None else f"{_ndvi(d):.2f}", "Sentinel-2 NDVI, -1 to 1"),
    "Normalized Difference Vegetation Index (NDVI)": lambda d, z: ("n/a" if _ndvi(d) is None else f"mean {_ndvi(d):.2f}", None),
    "Tree Canopy Coverage %": lambda d, z: (f"{_tree_pct(d):.0f}%", "ESA WorldCover tree class"),
    "Impervious Surface Ratio": lambda d, z: (f"{_impervious(d):.0f}%", "Built-up plus bare ground"),
    "Impervious Surface & Albedo Factor": lambda d, z: (f"{_impervious(d):.0f}% impervious", "Albedo is not measured"),
    "Canopy Cover Deficit Against WHO 3-30-300 Target": lambda d, z: (
        f"{max(0, 30 - _tree_pct(d)):.0f} percentage points below 30% canopy", None),
    "Tree Planting Feasibility Index": lambda d, z: (_ease(d), None),
    "Priority Ranking": lambda d, z: (_ranking(d), None),
    "Critical Threshold Exceedance": lambda d, z: (_exceedance(d), None),
    "Mitigation Feasibility": lambda d, z: (_ease(d), None),
    "Available Footprint (ha)": lambda d, z: (f"{_plantable_ha(d):.1f} ha across {len(d['greeningCandidates'])} sites", None),
    "Cooling Potential Estimate": lambda d, z: (
        "about 1-2°C local surface cooling per +10% canopy", "Literature range, not measured here"),
    "Implementation Ease": lambda d, z: (_ease(d), None),
    "Cross-Zone Variance": lambda d, z: (
        "n/a" if len([x for x in z if x["surfaceTemp"] is not None]) < 2 else
        f"±{pstdev([x['surfaceTemp'] for x in z if x['surfaceTemp'] is not None]):.1f}°C between zones", None),
    "Standardized Index Gap": lambda d, z: (
        f"{max(x['priorityScore'] for x in z) - min(x['priorityScore'] for x in z)} points between the highest and lowest zone priority"
        if z else "n/a", None),
    "Historical Trajectory": lambda d, z: ("Not available", "Needs repeated imagery over several years"),
    "Executive KPIs": lambda d, z: ("; ".join(f"{m['label']}: {m['value']}{m['unit']}" for m in d["metrics"]), None),
    "Risk Heatmap Summary": lambda d, z: (
        ", ".join(f"{sum(c['severity'] == s for c in d['cells'])} {s}" for s in ("high", "medium", "low")) + " cells", None),
    "Next Steps": lambda d, z: ("; ".join(h["mitigation_suggestions"][0] for h in d["hotspots"][:3]) or "Monitor", None),
}


def findings(data, template, zones):
    """The 'Executive Findings' paragraph for a template, from the real numbers."""
    area, prov = data["area"]["name"], data["provenance"]
    temps, hot = _temps(data), data["hotspots"]
    source = prov["surfaceTemp"]["label"]
    top = hot[0] if hot else None
    veg = _avg([c["vegetationCoverage"] for c in data["cells"]])
    if template == "vegetation-coverage":
        least = min(zones, key=lambda z: z["vegetationCoverage"]) if zones else None
        return (f"Vegetation covers {veg:.0f}% of {area} ({prov['vegetation']['label']}); tree canopy averages "
                f"{_tree_pct(data):.0f}% against the 30% target of the 3-30-300 rule."
                + (f" The least green zone is {least['name']} at {least['vegetationCoverage']}%." if least else ""))
    if template == "hotspot-prioritization":
        return (f"{len(hot)} heat hotspots ranked by priority (surface heat, vegetation deficit and residents exposed): "
                f"{_ranking(data)}." if hot else f"No heat hotspots were found in {area} at current thresholds.")
    if template == "greening-opportunity":
        g = data["greeningCandidates"]
        if not g:
            return f"No greening candidate sites met the screening rules in {area}."
        big = max(g, key=lambda x: x["candidateArea"])
        return (f"{len(g)} candidate sites totalling {_plantable_ha(data):.1f} ha. Largest opportunity: {big['name']} "
                f"({big['candidateArea']} ha) — {big['recommendedAction']}")
    if template == "zone-comparison":
        known = [z for z in zones if z["surfaceTemp"] is not None]
        if len(known) < 2:
            return "Not enough temperature data to compare zones."
        hottest, coolest = max(known, key=lambda z: z["surfaceTemp"]), min(known, key=lambda z: z["surfaceTemp"])
        r = data.get("correlation")
        return (f"Zone surface temperatures differ by {hottest['surfaceTemp'] - coolest['surfaceTemp']:.1f}°C, from "
                f"{hottest['name']} ({_t(hottest['surfaceTemp'])}) to {coolest['name']} ({_t(coolest['surfaceTemp'])})."
                + (f" Vegetation and temperature correlate at r = {r}." if r is not None else ""))
    heat = (f"Surface temperatures across {area} range from {_t(min(temps))} to {_t(max(temps))} ({source})."
            if temps else f"Surface temperature could not be measured for {area}.")
    hotspot_text = (f" {len(hot)} hotspots stand out; the hottest, {top['name']}, averages {_t(top['surfaceTemp'])} "
                    f"with {top['vegetationCoverage']}% vegetation. About {_people_in_hotspots(data):,} residents live in "
                    "hotspot areas." if top else " No hotspots stand out at current thresholds.")
    if template == "climate-overview":
        return (heat + hotspot_text + f" Vegetation covers {veg:.0f}% of the area, and {len(data['greeningCandidates'])} "
                f"greening sites ({_plantable_ha(data):.1f} ha) are proposed.")
    return heat + hotspot_text  # urban-heat


def methodology(data):
    """Where the numbers come from, and their limits."""
    prov = data["provenance"]
    lines = [
        f"Surface temperature: {prov['surfaceTemp']['sensor']}"
        + (f" (scenes: {', '.join(prov['surfaceTemp']['dates'])})" if prov["surfaceTemp"]["dates"] else ""),
        f"Vegetation: {prov['vegetation']['sensor']}"
        + (f" (scenes: {', '.join(prov['vegetation']['dates'])})" if prov["vegetation"]["kind"] == "sentinel2" else ""),
        f"Land cover: {prov['landcover']}; population: {prov['population']}",
        "Clouds removed with each scene's quality mask; hotspots are the hottest quarter of cells with under 30% "
        "vegetation and at least 25% hard or bare ground.",
    ]
    if prov["surfaceTemp"].get("note"):
        lines.append(f"Note: {prov['surfaceTemp']['note']}.")
    lines.append("Screening results — ground-truthing is required before investment decisions.")
    return lines


def build_report(data, template, zone_names=None, date_range=None, metric_names=None, location=None):
    """A ready report in the dashboard's Report shape, with the generated content attached."""
    zones = [z for z in data["zones"] if not zone_names or z["name"] in zone_names] or data["zones"]
    title = TEMPLATE_TITLES.get(template, "Climate Report")
    where = location or data["area"]["name"]
    today = date.today().isoformat()
    metric_rows = []
    for name in metric_names or []:
        func = METRICS.get(name)
        value, note = func(data, zones) if func else ("Not available", "Not computed by this version")
        metric_rows.append({"label": name, "value": value, "note": note})
    sources = " · ".join(x for x in (data["provenance"]["surfaceTemp"]["label"], data["provenance"]["vegetation"]["label"]) if x)
    return {
        "id": f"rep-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}",
        "title": f"{title} — {where}",
        "type": template,
        "status": "ready",
        "createdAt": today,
        "generatedAt": today,
        "location": data["area"]["location"],
        "dateRange": date_range,
        "metrics": metric_names or [],
        "description": f"{title} for {', '.join(z['name'] for z in zones)}"
                       + (f", imagery from {date_range['start']} to {date_range['end']}." if date_range else "."),
        "dataSource": sources,
        "content": {
            "summary": findings(data, template, zones),
            "zones": [{k: z[k] for k in ("name", "surfaceTemp", "vegetationCoverage", "severity", "priorityScore")} for z in zones],
            "metrics": metric_rows,
            "methodology": methodology(data),
        },
    }
