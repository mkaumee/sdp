# test_app.py — checks the web server's routes without touching the internet.
# Run with:  python -m pytest

import pytest

import app as server

FAKE_RESULT = {  # a stand-in analysis (the AI functions are replaced in these tests)
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


AI_BODY = {"lat": 3.1, "lon": 101.6, "area": 10, "purpose": "datacentre", "scale": 30}


def test_vision_check_result_is_remembered_for_the_chat(client, monkeypatch):
    monkeypatch.setattr(server.ai, "vision_check", lambda result: {"spots": [{"rank": 1}], "model": "m"})
    seen = {}

    def fake_chat(result, messages, vision):
        seen["vision"], seen["messages"] = vision, messages
        return {"reply": "Hi", "highlights": [], "model": "h"}

    monkeypatch.setattr(server.ai, "chat", fake_chat)
    assert client.post("/api/vision-check", json=AI_BODY).get_json()["spots"] == [{"rank": 1}]
    history = [{"role": "user", "content": "What did Claude see?"}]
    res = client.post("/api/chat", json={**AI_BODY, "messages": history})
    assert res.status_code == 200 and res.get_json()["reply"] == "Hi"
    assert seen["vision"] == {"spots": [{"rank": 1}], "model": "m"}  # the chat gets the vision findings
    assert seen["messages"] == history


def test_ai_errors_become_http_errors(client, monkeypatch):
    def no_key(*args):
        raise server.ai.AIError("Claude features are off: set the ANTHROPIC_API_KEY", 503)

    monkeypatch.setattr(server.ai, "chat", no_key)
    monkeypatch.setattr(server.ai, "vision_check", no_key)
    for url in ("/api/chat", "/api/vision-check"):
        res = client.post(url, json={**AI_BODY, "messages": [{"role": "user", "content": "hi"}]})
        assert res.status_code == 503 and "ANTHROPIC_API_KEY" in res.get_json()["error"]


def test_missing_imagery_is_a_502(client, monkeypatch):
    def no_tiles(result):
        raise server.datasources.DataUnavailable("tiles down")

    monkeypatch.setattr(server.ai, "vision_check", no_tiles)
    assert client.post("/api/vision-check", json=AI_BODY).status_code == 502


def test_ai_endpoints_validate_settings(client):
    assert client.post("/api/chat", json={"lat": "x"}).status_code == 400
    assert client.post("/api/vision-check", json={"lat": 3, "lon": 101, "purpose": "zoo"}).status_code == 400
