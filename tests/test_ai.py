# test_ai.py — checks the Claude features with a fake Claude client and fake photos (no internet, no API key).
# Run with:  python -m pytest

import io
import json
from types import SimpleNamespace

import anthropic
import pytest
from PIL import Image

import ai
import analysis


class FakeMessages:
    """Stands in for client.messages / client.beta.messages and records every request."""

    def __init__(self, answer=None, error=None, stop_reason="end_turn"):
        self.answer, self.error, self.stop_reason, self.calls = answer, error, stop_reason, []

    def create(self, **request):
        self.calls.append(request)
        if self.error:
            raise self.error
        content = [SimpleNamespace(type="thinking", thinking=""),  # Claude may think first
                   SimpleNamespace(type="text", text=json.dumps(self.answer))]
        return SimpleNamespace(stop_reason=self.stop_reason, model="test-model", content=content)


@pytest.fixture
def fake_claude(monkeypatch):
    """Install a fake Anthropic client; returns its FakeMessages so tests can set answers and read requests."""
    messages = FakeMessages()
    monkeypatch.setattr(anthropic, "Anthropic", lambda **kw: SimpleNamespace(
        messages=messages, beta=SimpleNamespace(messages=messages)))
    return messages


@pytest.fixture
def result(fake_data):
    return analysis.analyse(3.0, 101.5, 10, "datacentre", 30)  # built from the synthetic landscape


def fake_photo(bounds):
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (30, 120, 30)).save(buf, format="JPEG")
    return {"jpeg": buf.getvalue(), "width_m": 1700}


# ---------- chat ----------

def test_chat_sends_the_analysis_and_cleans_highlights(fake_claude, result):
    fake_claude.answer = {"reply": " The **east** is crowded. ", "highlights": [
        {"label": "Town", "tone": "bad", "cells": [{"row": 0, "col": 9}, {"row": 0, "col": 9}, {"row": 42, "col": 1}]},
        {"label": "Nothing valid", "tone": "info", "cells": [{"row": -1, "col": 3}]},
    ]}
    history = [{"role": "user", "content": "Where do people live?"}]
    out = ai.chat(result, history)
    assert out["reply"] == "The **east** is crowded."
    assert len(out["highlights"]) == 1  # the group with no real cells is dropped
    town = out["highlights"][0]
    assert [(c["row"], c["col"]) for c in town["cells"]] == [(0, 9)]  # duplicate and out-of-grid cells removed
    assert town["cells"][0]["bounds"] == next(c["bounds"] for c in result["cells"] if (c["row"], c["col"]) == (0, 9))

    sent = fake_claude.calls[0]
    assert sent["model"] == "claude-haiku-5-5"
    assert "fallbacks" not in sent  # Haiku has no server-side fallback
    assert sent["cache_control"] == {"type": "ephemeral"}
    assert sent["output_config"]["format"]["type"] == "json_schema"
    context = sent["system"][1]["text"]
    assert "CELLS" in context and "row,col,score" in context and "data:image" not in context  # no picture in the prompt
    assert sent["messages"] == history


def test_chat_includes_vision_findings(fake_claude, result):
    fake_claude.answer = {"reply": "ok", "highlights": []}
    vision = {"spots": [{"rank": 1, "plantation": "yes", "photo": "data:image/jpeg;base64,xx", "bounds": [], "center": []}]}
    ai.chat(result, [{"role": "user", "content": "hi"}], vision)
    context = fake_claude.calls[0]["system"][1]["text"]
    assert '"plantation": "yes"' in context and "base64" not in context


@pytest.mark.parametrize("messages", [
    [],
    [{"role": "assistant", "content": "hi"}],
    [{"role": "user", "content": "a"}, {"role": "user", "content": "b"}],
    [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}],
    [{"role": "user", "content": "x" * (ai.MAX_MESSAGE_CHARS + 1)}],
    "not a list",
])
def test_bad_chat_history_is_rejected(messages):
    with pytest.raises(ai.AIError) as err:
        ai.check_history(messages)
    assert err.value.status == 400


def test_long_history_is_trimmed_to_whole_turns():
    turns = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"m{i}"} for i in range(31)]
    kept = ai.check_history(turns)
    assert len(kept) <= ai.MAX_HISTORY and kept[0]["role"] == "user" and kept[-1]["content"] == "m30"


# ---------- vision check ----------

def test_vision_check_sends_one_photo_per_spot(fake_claude, result):
    spots = result["candidates"]
    assert spots, "the synthetic landscape should have best spots"
    fake_claude.answer = {"spots": [{
        "rank": s["rank"], "what_i_see": "Rows of oil palm", "plantation": "yes", "natural_forest": "no",
        "infrastructure": ["paved road"], "concerns": [], "agrees_with_data": True, "verdict": "looks suitable",
        "explanation": "Flat plantation next to a road."} for s in spots]}
    out = ai.vision_check(result, photo=fake_photo)

    sent = fake_claude.calls[0]
    assert sent["model"] == "claude-opus-5-5" and sent["fallbacks"] == "default"
    assert sent["betas"] == ["server-side-fallback-2026-07-01"]
    images = [b for b in sent["messages"][0]["content"] if b["type"] == "image"]
    assert len(images) == len(spots) and images[0]["source"]["media_type"] == "image/jpeg"
    assert [s["rank"] for s in out["spots"]] == [s["rank"] for s in spots]
    assert out["spots"][0]["photo"].startswith("data:image/jpeg;base64,")
    assert out["spots"][0]["bounds"] == spots[0]["bounds"]


def test_vision_check_needs_spots(result):
    with pytest.raises(ai.AIError):
        ai.vision_check({**result, "candidates": []}, photo=fake_photo)


# ---------- error handling ----------

def test_missing_api_key_gives_a_helpful_503(fake_claude, result):
    fake_claude.error = TypeError("Could not resolve authentication method. Expected one of api_key...")
    with pytest.raises(ai.AIError) as err:
        ai.chat(result, [{"role": "user", "content": "hi"}])
    assert err.value.status == 503 and "ANTHROPIC_API_KEY" in str(err.value)


def test_programming_errors_are_not_hidden(fake_claude, result):
    fake_claude.error = TypeError("create() got an unexpected keyword argument")
    with pytest.raises(TypeError):
        ai.chat(result, [{"role": "user", "content": "hi"}])


@pytest.mark.parametrize("stop_reason", ["refusal", "max_tokens"])
def test_unfinished_answers_are_errors(fake_claude, result, stop_reason):
    fake_claude.answer, fake_claude.stop_reason = {"reply": "x", "highlights": []}, stop_reason
    with pytest.raises(ai.AIError):
        ai.chat(result, [{"role": "user", "content": "hi"}])
