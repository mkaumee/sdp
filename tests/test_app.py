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


# ---------- The ClimateSearch dashboard's endpoints ----------

@pytest.fixture
def dash(satellites, monkeypatch):
    """A test client whose area analysis runs on the synthetic landscape, with a fake place-name lookup."""
    server.cached_area.cache_clear()
    calls = []
    real = server.urban.analyse_area

    def counting(*args):
        calls.append(args)
        return real(*args)

    monkeypatch.setattr(server.urban, "analyse_area", counting)
    monkeypatch.setattr(server, "reverse_geocode", lambda lat, lon: ("Testville", "Testville, Selangor, Malaysia"))
    client = server.app.test_client()
    client.calls = calls
    return client


@pytest.mark.parametrize("query, message", [
    ("lat=x&lon=1", "numbers"),
    ("lat=3&lon=101&width=50", "Area width"),
    ("lat=80&lon=101", "72°N"),
    ("lat=3&lon=101&start=2026-09-01&end=2026-01-01", "start date"),
    ("lat=3&lon=101&start=yesterday", "YYYY-MM-DD"),
])
def test_area_rejects_bad_input(dash, query, message):
    res = dash.get(f"/api/area?{query}")
    assert res.status_code == 400 and message in res.get_json()["error"]


def test_area_names_the_place_and_is_cached(dash):
    res = dash.get("/api/area?lat=3.0&lon=101.5&width=10")
    data = res.get_json()
    assert res.status_code == 200 and data["area"]["name"] == "Testville"
    assert data["area"]["location"] == "Testville, Selangor, Malaysia" and len(data["zones"]) == 9
    dash.get("/api/area?lat=3.0&lon=101.5&width=10")
    assert len(dash.calls) == 1  # the second request came from the cache


def test_area_download_failure_is_a_502(dash, monkeypatch):
    def broken(*args):
        raise server.datasources.DataUnavailable("down")

    monkeypatch.setattr(server.urban, "analyse_area", broken)
    assert dash.get("/api/area?lat=3.0&lon=101.5&name=X").status_code == 502


def test_report_endpoint(dash):
    zone = dash.get("/api/area?lat=3.0&lon=101.5&name=Testville").get_json()["zones"][0]["name"]
    body = {"lat": 3.0, "lon": 101.5, "name": "Testville", "template": "urban-heat", "zones": [zone],
            "metrics": ["Land Surface Temperature"], "dateRange": {"start": "2026-01-01", "end": "2026-09-30"},
            "reportLocation": "Testville Township"}
    report = dash.post("/api/reports", json=body).get_json()
    assert report["status"] == "ready" and report["title"].endswith("Testville Township")
    assert [z["name"] for z in report["content"]["zones"]] == [zone]
    assert dash.calls[-1][-2:] == (server.date(2026, 1, 1), server.date(2026, 9, 30))  # imagery limited to the range
    assert dash.post("/api/reports", json={**body, "template": "horoscope"}).status_code == 400


def test_assistant_endpoint_works_offline(dash, monkeypatch):
    def no_key(**kw):
        raise TypeError("Could not resolve authentication method")

    monkeypatch.setattr(server.ai.anthropic, "Anthropic", no_key)  # no API key configured
    body = {"lat": 3.0, "lon": 101.5, "name": "Testville", "style": "concise",
            "messages": [{"role": "user", "content": "What is NDVI?"}], "context": {"route": "/overview"}}
    res = dash.post("/api/assistant", json=body)
    assert res.status_code == 200 and res.get_json()["model"] == "offline" and "NDVI" in res.get_json()["reply"]
    assert dash.post("/api/assistant", json={**body, "messages": []}).status_code == 400


def test_dashboard_pages_and_files_are_served(tmp_path, monkeypatch):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<div id=root></div>")
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")
    monkeypatch.setattr(server, "UI_DIST", str(tmp_path))
    client = server.app.test_client()
    assert b"root" in client.get("/").data
    assert b"root" in client.get("/hotspots").data and b"root" in client.get("/map-explorer").data
    assert client.get("/assets/app.js").data == b"console.log(1)"
    assert client.get("/api/nothing").status_code == 404
    assert client.get("/../app.py").status_code == 404
    assert b"Data centre" in client.get("/site-finder").data  # the classic site finder page


def test_not_built_page(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "UI_DIST", str(tmp_path / "missing"))
    page = server.app.test_client().get("/").data
    assert b"npm run build" in page and b"/site-finder" in page
