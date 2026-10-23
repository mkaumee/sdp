# test_sentinel2.py — checks the Sentinel-2 reader's logic without touching the internet.
# Run with:  python -m pytest

from datetime import date

import numpy as np
import pytest

import datasources as ds
import sentinel2 as s2


@pytest.mark.parametrize("lat, lon, tile", [
    (3.1885, 101.493, ("47", "N", "QD")),  # Shah Alam, Malaysia
    (-1.286, 36.817, ("37", "M", "BU")),  # Nairobi
    (59.91, 10.75, ("32", "V", "NM")),  # Oslo (inside the widened zone 32)
    (33.45, -112.07, ("12", "S", "VC")),  # Phoenix
])
def test_mgrs_tile_names(lat, lon, tile):
    assert s2.mgrs_tile(lat, lon) == tile


def test_months_newest_first_across_a_new_year():
    assert s2._months(date(2025, 11, 20), date(2026, 2, 3)) == [(2026, 2), (2026, 1), (2025, 12), (2025, 11)]


def test_list_scenes_reads_dates_and_skips_other_folders(monkeypatch):
    folders = {
        "sentinel-s2-l2a-cogs/47/N/QD/2026/9/": [
            "sentinel-s2-l2a-cogs/47/N/QD/2026/9/S2C_47NQD_20260924_0_L2A/",
            "sentinel-s2-l2a-cogs/47/N/QD/2026/9/S2B_47NQD_20260901_0_L2A/",
            "sentinel-s2-l2a-cogs/47/N/QD/2026/9/notes/",
        ],
    }
    monkeypatch.setattr(s2, "_list_prefixes", lambda prefix: folders.get(prefix, []))
    scenes = s2.list_scenes(("47", "N", "QD"), date(2026, 9, 10), date(2026, 9, 30))
    assert [s["date"] for s in scenes] == ["2026-09-24"]  # 1 September is before the window, "notes" isn't a scene


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload


def test_scene_metadata_reads_cloud_and_offset(monkeypatch):
    payload = {"properties": {"eo:cloud_cover": 12.5, "platform": "sentinel-2c", "s2:processing_baseline": "05.13"}}
    monkeypatch.setattr(s2.requests, "get", lambda *a, **k: FakeResponse(payload))
    meta = s2.scene_metadata({"prefix": "p/", "id": "S2C_47NQD_20260924_0_L2A", "date": "2026-09-24"})
    assert meta["cloud"] == 12.5 and meta["platform"] == "Sentinel-2C" and meta["offset"] == 1000
    payload["properties"]["s2:processing_baseline"] = "03.01"  # before 2022: no offset
    assert s2.scene_metadata({"prefix": "p/", "id": "x", "date": "2021-01-01"})["offset"] == 0


def test_scene_ndvi_masks_clouds_and_applies_the_offset(monkeypatch):
    grid = ds.Grid(3.0, 101.0, 2, 4)
    bands = {
        "B04": np.full((4, 4), 1000 + 500, "float32"),  # red reflectance 0.05 after removing the offset
        "B08": np.full((4, 4), 1000 + 3500, "float32"),  # near-infrared 0.35
        "SCL": np.array([[4] * 4, [9] * 4, [4, 4, 0, 0], [6] * 4], "uint8"),  # row 1 cloud, two no-data pixels
    }
    monkeypatch.setattr(s2, "read_band", lambda scene, band, grid, *a: bands[band].copy())
    ndvi = s2.scene_ndvi({"offset": 1000}, grid)
    assert ndvi[0, 0] == pytest.approx((0.35 - 0.05) / (0.35 + 0.05))
    assert np.isnan(ndvi[1]).all() and np.isnan(ndvi[2, 2:]).all()
    assert not np.isnan(ndvi[3]).any()  # water is clear ground


def test_read_ndvi_fills_cloud_gaps_from_the_next_scene(monkeypatch):
    grid = ds.Grid(3.0, 101.0, 2, 4)
    scenes = [{"id": "a", "date": "2026-09-01", "platform": "Sentinel-2A", "cloud": 5},
              {"id": "b", "date": "2026-08-01", "platform": "Sentinel-2B", "cloud": 20},
              {"id": "c", "date": "2026-07-01", "platform": "Sentinel-2C", "cloud": 30}]
    first = np.full((4, 4), 0.8, "float32")
    first[:2] = np.nan  # the clearest scene is cloudy in the north
    layers = {"a": first, "b": np.full((4, 4), 0.3, "float32"), "c": np.full((4, 4), 0.1, "float32")}
    monkeypatch.setattr(s2, "find_scenes", lambda *a, **k: scenes)
    monkeypatch.setattr(s2, "scene_ndvi", lambda scene, g: layers[scene["id"]].copy())
    out = s2.read_ndvi(grid)
    assert out["coverage"] == 1.0
    assert out["ndvi"][3, 0] == pytest.approx(0.8) and out["ndvi"][0, 0] == pytest.approx(0.3)
    assert [s["id"] for s in out["scenes"]] == ["a", "b"]  # the third scene wasn't needed


def test_read_ndvi_without_scenes_is_unavailable(monkeypatch):
    monkeypatch.setattr(s2, "find_scenes", lambda *a, **k: [])
    with pytest.raises(ds.DataUnavailable):
        s2.read_ndvi(ds.Grid(3.0, 101.0, 2, 4))
