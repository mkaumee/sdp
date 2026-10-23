# test_urban.py — checks the heat and greening intelligence with a synthetic landscape (no internet).
# Run with:  python -m pytest

import json

import numpy as np
import pytest

import datasources as ds
import landsat
import sentinel2
import urban
from conftest import landscape_lst, landscape_ndvi, unavailable


def test_full_analysis_with_real_satellite_layers(satellites):
    r = urban.analyse_area(3.0, 101.5, 10, "Testville, Selangor, Malaysia")
    json.dumps(r)  # everything must be JSON-safe
    assert r["area"]["name"] == "Testville" and r["area"]["location"] == "Testville, Selangor, Malaysia"
    assert r["provenance"]["surfaceTemp"]["kind"] == "landsat" and not r["provenance"]["surfaceTemp"]["isEstimate"]
    assert r["provenance"]["surfaceTemp"]["label"] == "Landsat 9 thermal · 14 Aug 2026"
    assert r["provenance"]["vegetation"]["kind"] == "sentinel2" and r["provenance"]["updated"] == "2026-08-15"
    assert [m["id"] for m in r["metrics"]] == ["m1", "m2", "m3", "m4"]
    assert r["metrics"][0]["label"] == "Average Surface Temperature" and r["metrics"][0]["unit"] == "°C"
    assert len(r["zones"]) == 9 and {z["id"] for z in r["zones"]} >= {"z-north-west", "z-central", "z-south-east"}
    assert len(r["cells"]) == urban.CELLS ** 2
    assert r["correlation"] < -0.5  # hotter where there is less vegetation
    assert r["hotspots"], "the hot, built-up town should be a hotspot"
    top = r["hotspots"][0]
    assert top["surfaceTemp"] == pytest.approx(41.0, abs=0.5) and "East" in top["name"]
    assert top["contributing_factors"] and top["mitigation_suggestions"] and top["area"] > 0
    assert top["imageDate"] == "2026-08-14"
    assert r["greeningCandidates"] and r["greeningCandidates"][0]["nearestHotspotId"] == top["id"]
    assert all(g["status"] == "identified" and g["candidateArea"] > 0 for g in r["greeningCandidates"])
    assert r["overlays"]["temperature"]["url"].startswith("data:image/png;base64,")
    assert r["overlays"]["vegetation"]["unit"] == "NDVI"
    assert any(n["title"] == "Analysis ready" for n in r["notifications"])


def test_east_town_is_hotter_and_less_green_than_west_forest(satellites):
    r = urban.analyse_area(3.0, 101.5, 10)
    zones = {z["id"]: z for z in r["zones"]}
    assert zones["z-east"]["surfaceTemp"] > zones["z-west"]["surfaceTemp"]
    assert zones["z-east"]["vegetationCoverage"] < zones["z-west"]["vegetationCoverage"]
    assert zones["z-east"]["priorityScore"] > zones["z-west"]["priorityScore"]


def test_estimate_when_landsat_is_unavailable(fake_data, monkeypatch):
    monkeypatch.setattr(landsat, "read_lst", unavailable)
    monkeypatch.setattr(sentinel2, "read_ndvi", unavailable)
    r = urban.analyse_area(3.0, 101.5, 10)
    prov = r["provenance"]
    assert prov["surfaceTemp"]["isEstimate"] and prov["surfaceTemp"]["kind"] == "estimate"
    assert prov["vegetation"]["kind"] == "worldcover"
    assert r["metrics"][0]["value"] != "–"
    assert any(n["title"] == "Temperature is estimated" for n in r["notifications"])
    assert "Thermal imagery (Landsat 8/9) could not be downloaded" in r["warnings"]


def test_no_temperature_at_all(fake_data, monkeypatch):
    monkeypatch.setattr(landsat, "read_lst", unavailable)
    monkeypatch.setattr(sentinel2, "read_ndvi", unavailable)
    monkeypatch.setattr(ds, "read_climate", unavailable)
    r = urban.analyse_area(3.0, 101.5, 10)
    assert r["metrics"][0]["value"] == "–" and r["hotspots"] == []
    assert r["thresholds"]["critical"] is None and r["overlays"].get("temperature") is None
    assert all(z["surfaceTemp"] is None for z in r["zones"])


def test_cloud_gaps_are_filled_and_flagged(fake_data, monkeypatch):
    def cloudy(grid, start=None, end=None):
        out = landscape_lst(grid)
        out["lst"][: grid.size // 3] = np.nan  # northern third under cloud
        out["coverage"] = 2 / 3
        return out

    monkeypatch.setattr(landsat, "read_lst", cloudy)
    monkeypatch.setattr(sentinel2, "read_ndvi", lambda grid, start=None, end=None: landscape_ndvi(grid))
    r = urban.analyse_area(3.0, 101.5, 10)
    assert r["provenance"]["surfaceTemp"]["kind"] == "landsat"
    assert "gaps filled" in r["provenance"]["surfaceTemp"]["note"]
    assert all(c["surfaceTemp"] is not None for c in r["cells"])


def test_compass_names():
    assert urban.compass(0, 0, 12) == "North-West" and urban.compass(5, 6, 12) == "Central"
    assert urban.compass(11, 11, 12) == "South-East" and urban.compass(0, 6, 12) == "North"


def test_estimated_surface_temperature_ranks_surfaces():
    codes = np.full((urban.LC_PX, urban.LC_PX), 50, np.uint8)  # all built-up
    codes[:, : urban.LC_PX // 2] = 10  # west half trees
    est = urban.estimated_surface_temp(codes, 33.0)
    assert est[0, -1] == pytest.approx(33.0 + urban.SURFACE_OFFSET_C[50])
    assert est[0, 0] == pytest.approx(33.0 + urban.SURFACE_OFFSET_C[10])
