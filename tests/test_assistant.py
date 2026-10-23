# test_assistant.py — checks the dashboard chat assistant with a fake Claude and fake photos (no internet).
# Run with:  python -m pytest

import json
from types import SimpleNamespace

import anthropic
import pytest

import assistant
import datasources as ds
import urban

JPEG = b"\xff\xd8\xff\xe0fake-jpeg"


class FakeMessages:
    def __init__(self):
        self.answer, self.error, self.calls = None, None, []

    def create(self, **request):
        self.calls.append(request)
        if self.error:
            raise self.error
        return SimpleNamespace(stop_reason="end_turn", model="claude-haiku-5-5",
                               content=[SimpleNamespace(type="text", text=json.dumps(self.answer))])


@pytest.fixture
def claude(monkeypatch):
    fake = FakeMessages()
    monkeypatch.setattr(anthropic, "Anthropic", lambda **kw: SimpleNamespace(messages=fake, beta=SimpleNamespace(messages=fake)))
    return fake


@pytest.fixture
def data(satellites, monkeypatch):
    shots = []

    def fake_true_colour(bounds, max_px=768, start=None, end=None, outline=None):
        shots.append({"bounds": bounds, "outline": outline})
        return {"jpeg": JPEG, "date": "2026-08-15", "platform": "Sentinel-2C", "scene": "x", "clear_pct": 97, "width_m": 1500}

    monkeypatch.setattr(assistant.sentinel2, "true_colour", fake_true_colour)
    out = urban.analyse_area(3.0, 101.5, 10, "Testville, Selangor, Malaysia")
    out["_shots"] = shots
    return out


def test_claude_answer_with_a_hotspot_photo(claude, data):
    hotspot = data["hotspots"][0]
    claude.answer = {"reply": " The **east** is hottest. ", "image": {"target": "hotspot", "id": hotspot["id"]}}
    history = [{"role": "assistant", "content": "Welcome!"}, {"role": "user", "content": "Show me the hottest spot"}]
    out = assistant.ask(data, history, {"route": "/hotspots"}, style="concise")
    assert out["reply"] == "The **east** is hottest." and out["model"] == "claude-haiku-5-5"
    assert out["media"]["caption"] == hotspot["name"] and out["media"]["metadata"] == "Sentinel-2C • 10 m • 15 Aug 2026"
    assert out["media"]["url"].startswith("data:image/jpeg;base64,")
    assert data["_shots"][0]["outline"] == hotspot["bounds"]  # the hotspot is outlined in the photo
    sent = claude.calls[0]
    assert sent["model"] == "claude-haiku-5-5" and "fallbacks" not in sent
    assert sent["messages"] == [{"role": "user", "content": "Show me the hottest spot"}]  # welcome note dropped
    assert "bullet points" in sent["system"][0]["text"]  # the concise style
    assert hotspot["name"] in sent["system"][1]["text"] and '"route": "/hotspots"' in sent["system"][1]["text"]


def test_no_photo_when_not_asked(claude, data):
    claude.answer = {"reply": "Hi", "image": {"target": "none", "id": ""}}
    assert assistant.ask(data, [{"role": "user", "content": "hi"}])["media"] is None


def test_offline_answers_without_a_key(claude, data):
    claude.error = TypeError("Could not resolve authentication method")
    out = assistant.ask(data, [{"role": "user", "content": "What causes the urban heat island effect?"}])
    assert out["model"] == "offline" and "Urban heat islands" in out["reply"] and "ANTHROPIC_API_KEY" in out["reply"]
    assert data["hotspots"][0]["name"] in out["reply"]


def test_offline_satellite_image_of_the_hottest_area(claude, data):
    claude.error = TypeError("Could not resolve authentication method")
    out = assistant.ask(data, [{"role": "user", "content": "Show me the hottest satellite image"}])
    assert out["media"] and out["media"]["caption"] == data["hotspots"][0]["name"]


def test_offline_explains_the_selected_hotspot(claude, data):
    claude.error = TypeError("Could not resolve authentication method")
    hotspot = data["hotspots"][0]
    out = assistant.ask(data, [{"role": "user", "content": "Why is this a priority?"}], {"selectedHotspot": hotspot["name"]})
    assert hotspot["contributing_factors"][0] in out["reply"]


def test_rate_limits_are_not_hidden_by_the_offline_answer(claude, data):
    claude.error = anthropic.RateLimitError("busy", response=SimpleNamespace(status_code=429, headers={}, request=None), body=None)
    with pytest.raises(assistant.AIError) as err:
        assistant.ask(data, [{"role": "user", "content": "hi"}])
    assert err.value.status == 503 and not err.value.no_key


def test_history_is_cleaned():
    turns = assistant.clean_history([
        {"role": "assistant", "content": "Welcome"}, {"role": "user", "content": "a"},
        {"role": "assistant", "content": ""}, {"role": "user", "content": "b"}, {"role": "system", "content": "x"}])
    assert turns == [{"role": "user", "content": "a\n\nb"}]
    with pytest.raises(assistant.AIError):
        assistant.clean_history([{"role": "assistant", "content": "only me"}])


def test_photo_falls_back_to_esri(data, monkeypatch):
    def no_s2(*a, **k):
        raise ds.DataUnavailable("cloudy")

    monkeypatch.setattr(assistant.sentinel2, "true_colour", no_s2)
    monkeypatch.setattr(assistant.imagery, "site_photo", lambda bounds, margin=0.35, max_px=1024: {"jpeg": JPEG, "width_m": 900})
    media = assistant.photo(data, "zone", data["zones"][0]["id"])
    assert media["metadata"].startswith("Esri World Imagery") and media["caption"] == data["zones"][0]["name"]
