# conftest.py — shared test setup: lets the tests import the project modules, plus fake satellite data.
import os  # builds the path to the project folder
import sys  # Python's list of folders to import from

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # the folder above tests/

import numpy as np  # noqa: E402  (imported after the path is set up)
import pytest  # noqa: E402

import datasources as ds  # noqa: E402
import landsat  # noqa: E402
import sentinel2  # noqa: E402

POWER_SAMPLE = {  # shape of a NASA POWER climatology reply (values trimmed to what we read)
    "properties": {
        "parameter": {
            "T2M": {**{m: 27.0 for m in ds.MONTHS}, "ANN": 27.3},
            "T2M_MAX": {**{m: 31.0 for m in ds.MONTHS}, "APR": 33.4, "ANN": 31.5},
            "PRECTOTCORR": {**{m: 8.0 for m in ds.MONTHS}, "JUN": 4.0, "ANN": 7.7},
            "RH2M": {**{m: 80.0 for m in ds.MONTHS}, "ANN": 80.4},
        }
    }
}


@pytest.fixture
def fake_data(monkeypatch):
    """Replace every download with a synthetic landscape: forest in the west, town in the east, a river."""
    def landcover(grid):
        codes = np.full((grid.size, grid.size), 40, np.uint8)  # cropland
        codes[:, : grid.size // 4] = 10  # forest strip in the west
        codes[:, grid.size * 3 // 4:] = 50  # town in the east
        codes[:, grid.size // 2: grid.size // 2 + 4] = 80  # a river down the middle
        return codes

    def elevation(grid):
        return np.tile(np.linspace(20, 80, grid.size), (grid.size, 1)).astype(np.float32)

    def population(grid):
        people = np.zeros((grid.size, grid.size))
        people[:, grid.size * 3 // 4:] = 2000.0  # people live in the town
        return people, True

    monkeypatch.setattr(ds, "read_landcover", landcover)
    monkeypatch.setattr(ds, "read_elevation", elevation)
    monkeypatch.setattr(ds, "read_population", population)
    monkeypatch.setattr(ds, "read_climate", lambda lat, lon: ds.parse_power(POWER_SAMPLE))


def landscape_lst(grid):
    """Fake Landsat: town (east quarter) 41 °C, crops 34 °C, forest (west quarter) 30 °C, river 27 °C."""
    n = grid.size
    lst = np.full((n, n), 34.0, "float32")
    lst[:, : n // 4] = 30.0
    lst[:, n * 3 // 4:] = 41.0
    lst[:, n // 2: n // 2 + 2] = 27.0
    return {"lst": lst, "coverage": 1.0,
            "scenes": [{"id": "LC09_x", "date": "2026-08-14", "platform": "Landsat 9", "cloud": 3}]}


def landscape_ndvi(grid):
    """Fake Sentinel-2 NDVI matching the same landscape."""
    n = grid.size
    ndvi = np.full((n, n), 0.6, "float32")
    ndvi[:, : n // 4] = 0.85
    ndvi[:, n * 3 // 4:] = 0.15
    return {"ndvi": ndvi, "coverage": 1.0,
            "scenes": [{"id": "S2C_x", "date": "2026-08-15", "platform": "Sentinel-2C", "cloud": 5}]}


def unavailable(*args, **kwargs):
    raise ds.DataUnavailable("blocked")


@pytest.fixture
def satellites(fake_data, monkeypatch):
    monkeypatch.setattr(landsat, "read_lst", lambda grid, start=None, end=None: landscape_lst(grid))
    monkeypatch.setattr(sentinel2, "read_ndvi", lambda grid, start=None, end=None: landscape_ndvi(grid))
