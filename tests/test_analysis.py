# test_analysis.py — checks the scoring maths and data parsing without touching the internet.
# Run with:  python -m pytest

import numpy as np
import pytest

import analysis
import datasources as ds
from conftest import POWER_SAMPLE


# ---------- datasources ----------

def test_worldcover_tile_names_cover_both_hemispheres():
    grid = ds.Grid(0, 0, 50, 10)  # straddles the equator and Greenwich
    assert sorted(ds.worldcover_tile_names(grid)) == ["N00E000", "N00W003", "S03E000", "S03W003"]


def test_worldcover_tile_name_for_kuala_lumpur():
    assert ds.worldcover_tile_names(ds.Grid(3.19, 101.49, 10, 10)) == ["N03E099"]


def test_dem_tile_names():
    assert ds.dem_tile_names(ds.Grid(3.19, 101.49, 5, 10)) == ["Copernicus_DSM_COG_10_N03_00_E101_00_DEM"]
    assert ds.dem_tile_names(ds.Grid(-1.29, 36.82, 5, 10)) == ["Copernicus_DSM_COG_10_S02_00_E036_00_DEM"]


def test_grid_is_square_on_the_ground():
    grid = ds.Grid(60.0, 10.0, 10, 100)  # far north, where longitude degrees are short
    height_deg = grid.north - grid.south
    width_deg = grid.east - grid.west
    assert width_deg == pytest.approx(height_deg / np.cos(np.radians(60)), rel=1e-6)
    assert grid.pixel_m == 100


def test_parse_power():
    climate = ds.parse_power(POWER_SAMPLE)
    assert climate["mean_temp_c"] == 27.3
    assert climate["hottest_month_max_c"] == 33.4  # the hottest month, not the yearly average
    assert climate["driest_month_mm"] == 120  # 4 mm/day x 30 days in June
    assert climate["rain_mm_year"] == pytest.approx(8.0 * 365.25 - 4.0 * 30, abs=2)
    assert climate["humidity_pct"] == 80


def test_parse_power_handles_missing_values():
    sample = {"properties": {"parameter": {k: dict(v) for k, v in POWER_SAMPLE["properties"]["parameter"].items()}}}
    sample["properties"]["parameter"]["PRECTOTCORR"]["JAN"] = -999.0  # NASA's "no data" marker
    climate = ds.parse_power(sample)
    assert climate["rain_mm_year"] is None  # a year with a missing month can't be totalled
    assert climate["monthly_rain_mm"][0] is None


# ---------- scoring curves ----------

def test_scores_stay_between_0_and_100_and_move_the_right_way():
    assert analysis.score_water(0.05) == 100 and analysis.score_water(2.0) == 0
    assert analysis.score_water(0.3) > analysis.score_water(0.6)  # more stress, lower score
    assert analysis.score_nature(0.0) == 100 and analysis.score_nature(0.9) == 0
    assert analysis.score_people(100) == 100 and analysis.score_people(20000) == 0
    assert analysis.score_cooling(15) == 100 and analysis.score_cooling(30) == 20
    assert analysis.score_terrain(0, 0) == 100 and analysis.score_terrain(1, 1) == 0
    assert analysis.score_green(0.3, 0.5) == 100 and analysis.score_green(0, 0) == 0
    assert analysis.score_heat(-0.5, 28) == 100 and analysis.score_heat(0.6, 36) == 0
    assert analysis.score_heat(0.0, None) == pytest.approx(analysis.score_heat(0.0, None))  # works without climate


def test_water_budget_for_a_data_centre():
    climate = {"rain_mm_year": 2500}
    budget = analysis.water_budget(climate, 20, 100_000, "datacentre", 30)
    supply = 2.5 * 400e6 * analysis.USABLE_RAIN_SHARE  # metres of rain x m² x usable share
    residents = 100_000 * analysis.LITRES_PER_PERSON_DAY * 365 / 1000
    dc = 30 * 1000 * 24 * 365 * analysis.DC_WATER_L_PER_KWH / 1000
    assert budget["supply_m3"] == round(supply)
    assert budget["new_m3"] == round(dc)
    assert budget["stress"] == pytest.approx((residents + dc) / supply, abs=1e-3)


def test_water_budget_needs_rainfall():
    assert analysis.water_budget(None, 20, 0, "township", 1000) is None
    assert analysis.water_budget({"rain_mm_year": None}, 20, 0, "township", 1000) is None


def test_desert_is_more_stressed_than_rainforest():
    desert = analysis.water_budget({"rain_mm_year": 150}, 20, 300_000, "datacentre", 30)
    rainforest = analysis.water_budget({"rain_mm_year": 2500}, 20, 300_000, "datacentre", 30)
    assert desert["stress"] > 1 > 0.2 > rainforest["stress"]


# ---------- terrain ----------

def test_terrain_flags_low_land_beside_a_river_but_not_the_hilltop():
    size, pixel_m = 100, 30
    x = np.arange(size) * pixel_m
    height = np.tile(x * 0.05, (size, 1)).astype(np.float32)  # gentle slope rising 5 m per 100 m eastwards
    water = np.zeros((size, size), bool)
    water[:, :3] = True  # a river along the western edge
    low, steep, land = analysis.terrain_masks(height, water, pixel_m)
    assert low[:, 5].all()  # just beside the river, barely above it
    assert not low[:, 60].any()  # 1.8 km away and 90 m higher
    assert not steep.any()  # 5% slope is not steep
    assert not (low & water).any()  # water itself is never "land"


def test_terrain_without_water_has_no_flood_land():
    height = np.random.default_rng(0).normal(50, 1, (40, 40)).astype(np.float32)
    low, _, _ = analysis.terrain_masks(height, np.zeros((40, 40), bool), 30)
    assert not low.any()


def test_ground_level_removes_a_tree_but_keeps_a_hill():
    height = np.zeros((50, 50), np.float32)
    height[25, 25] = 25  # one 25 m tree on flat ground
    height[:, 40:] += 60  # a wide 60 m plateau
    ground = analysis.ground_level(height, 30)
    assert ground[25, 25] < 5
    assert ground[25, 47] > 50


# ---------- cells, candidates and verdicts ----------

def make_cell(row, col, score, buildable=80, water=0, sensitive=0):
    return {"row": row, "col": col, "score": score, "buildable_pct": buildable, "water_pct": water,
            "sensitive_pct": sensitive, "main_cover": "cropland", "people": 10}


def test_candidates_skip_forest_water_and_neighbours():
    cells = [
        make_cell(0, 0, 95, sensitive=60),  # forest: never suggested
        make_cell(0, 1, 90, water=80),  # a lake
        make_cell(5, 5, 88),
        make_cell(5, 6, 87),  # touches the 88 cell
        make_cell(9, 9, 70),
        make_cell(2, 8, 60, buildable=10),  # no open land
    ]
    picked = analysis.pick_candidates(cells)
    assert [(c["row"], c["col"]) for c in picked] == [(5, 5), (9, 9)]
    assert picked[0]["rank"] == 1 and "cropland" in picked[0]["reason"]


def test_verdict_is_held_back_by_a_red_flag():
    assert analysis.make_verdict(85, [])["label"] == "Good fit"
    assert analysis.make_verdict(85, [{"level": "high", "text": "x"}])["level"] == "caution"
    assert analysis.make_verdict(55, [])["level"] == "caution"
    assert analysis.make_verdict(30, [])["level"] == "poor"


def test_verdict_is_provisional_when_data_is_missing():
    verdict = analysis.make_verdict(85, [], missing_weight=45)  # e.g. no climate data for a data centre
    assert verdict["level"] == "caution" and verdict["label"].endswith("(provisional)")
    assert analysis.make_verdict(85, [], missing_weight=15)["level"] == "good"


def test_landcover_png_is_a_data_url():
    codes = np.full((20, 20), 10, np.uint8)
    codes[:10] = 50
    assert analysis.landcover_png(codes).startswith("data:image/png;base64,")


# ---------- the whole analysis, with fake downloads ----------

def test_full_analysis_for_both_purposes(fake_data):
    for purpose, size in (("datacentre", 30), ("township", 20000)):
        r = analysis.analyse(3.0, 101.5, 10, purpose, size)
        assert 0 <= r["overall"] <= 100
        assert len(r["cells"]) == analysis.CELLS ** 2
        assert sum(f["weight"] for f in r["factors"]) == 100
        assert all(f["score"] is not None for f in r["factors"])
        assert r["warnings"] == []
        assert r["metrics"]["tree_pct"] == pytest.approx(25, abs=0.5)
        assert r["candidates"], "cropland cells should be suggested"
        assert all(c["sensitive_pct"] < analysis.MAX_CANDIDATE_SENSITIVE_PCT for c in r["candidates"])
        assert r["recommendations"]
    town = analysis.analyse(3.0, 101.5, 10, "township", 20000)
    assert town["hotspots"] and all(h["built_pct"] >= 15 for h in town["hotspots"])


def test_analysis_carries_on_when_climate_is_down(fake_data, monkeypatch):
    def broken(lat, lon):
        raise ds.DataUnavailable("timeout")

    monkeypatch.setattr(ds, "read_climate", broken)
    r = analysis.analyse(3.0, 101.5, 10, "datacentre", 30)
    assert r["water"] is None and r["climate"] is None
    assert {f["key"] for f in r["factors"] if f["score"] is None} == {"water", "cooling"}
    assert r["warnings"] == ["Climate data (NASA POWER) could not be downloaded"]


def test_analysis_fails_cleanly_without_land_cover(fake_data, monkeypatch):
    def broken(grid):
        raise ds.DataUnavailable("S3 down")

    monkeypatch.setattr(ds, "read_landcover", broken)
    with pytest.raises(ds.DataUnavailable):
        analysis.analyse(3.0, 101.5, 10, "datacentre", 30)


def test_open_sea_scores_zero(fake_data, monkeypatch):
    monkeypatch.setattr(ds, "read_landcover", lambda grid: np.full((grid.size, grid.size), 80, np.uint8))
    monkeypatch.setattr(ds, "read_population", lambda grid: (np.zeros((grid.size, grid.size)), False))
    r = analysis.analyse(0.0, -150.0, 5, "datacentre", 30)
    assert r["overall"] == 0 and r["verdict"]["level"] == "poor"
    assert r["candidates"] == [] and any("sea" in f["text"] for f in r["flags"])
