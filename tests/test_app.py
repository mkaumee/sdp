# test_app.py — checks the web server's routes without touching the internet.
# Run with:  python -m pytest

import pytest

import app as server

FAKE_RESULT = {  # a stand-in analysis (the analysis function is replaced in these tests)
    "purpose": "datacentre", "purpose_label": "Data centre", "size": 30.0,
    "location": {"width_km": 10}, "overall": 72, "verdict": {"label": "Good fit"},
    "factors": [{"label": "Water availability", "score": 90, "weight": 30, "detail": "Plenty of rain."}],
    "flags": [], "metrics": {"tree_pct": 5.0}, "climate": None, "water": None,
    "candidates": [{"rank": 1, "score": 88, "reason": "Mostly cropland"}], "hotspots": [],
    "recommendations": [{"title": "Use water-free cooling", "text": "Because."}], "warnings": [],
}


@pytest.fixture
def client(monkeypatch):
    server.cached_analysis.cache_clear()
    monkeypatch.setattr(server.analysis, "analyse", lambda *args: FAKE_RESULT)  # no downloads
    return server.app.test_client()


def test_frontend_files_are_served_and_source_is_not(client):
    assert client.get("/").status_code == 200
    assert client.get("/vendor/leaflet/leaflet.js").status_code == 200
    assert client.get("/app.py").status_code == 404
    assert client.get("/analysis.py").status_code == 404


@pytest.mark.parametrize("query, message", [
    ("lat=x&lon=1", "numbers"),
    ("lat=3&lon=101&area=50", "Area width"),
    ("lat=3&lon=101&purpose=airport", "purpose"),
    ("lat=3&lon=101&purpose=datacentre&scale=5000", "Size"),
    ("lat=80&lon=101", "72°N"),
])
def test_analyze_rejects_bad_input(client, query, message):
    res = client.get(f"/api/analyze?{query}")
    assert res.status_code == 400
    assert message in res.get_json()["error"]


def test_analyze_returns_the_analysis(client):
    res = client.get("/api/analyze?lat=3.1&lon=101.6&area=10&purpose=datacentre&scale=30")
    assert res.status_code == 200
    assert res.get_json()["overall"] == 72


def test_analyze_reports_download_failures(client, monkeypatch):
    def broken(*args):
        raise server.datasources.DataUnavailable("down")

    monkeypatch.setattr(server.analysis, "analyse", broken)
    res = client.get("/api/analyze?lat=3.1&lon=101.6")
    assert res.status_code == 502
