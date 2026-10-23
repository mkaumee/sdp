# test_landsat.py — runs the Landsat surface-temperature reader against a fake Planetary Computer
# (a small web server on this computer), so the whole path — catalogue search, read token, signed
# file reads, cloud masking and unit conversion — is tested without the internet.
# Run with:  python -m pytest

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

import datasources as ds
import landsat

CLEAR, CLOUD = 1 << 6, (1 << 3) | (1 << 1)  # QA_PIXEL values: "clear" bit, and cloud + dilated cloud


def dn_for(celsius):
    """Stored ST_B10 number for a temperature."""
    return round((celsius + 273.15 - landsat.ST_OFFSET) / landsat.ST_SCALE)


def write_tif(path, data):
    """A small tiled GeoTIFF in UTM zone 47N covering about 3.0-3.1°N, 101.0-101.1°E."""
    with rasterio.open(path, "w", driver="GTiff", width=data.shape[1], height=data.shape[0], count=1,
                       dtype="uint16", crs="EPSG:32647", transform=from_origin(720000, 345000, 30, 30),
                       tiled=True, blockxsize=64, blockysize=64) as dst:
        dst.write(data.astype("uint16"), 1)


@pytest.fixture
def fake_pc(tmp_path, monkeypatch):
    """Start a fake Planetary Computer and point landsat.py at it."""
    size = 512  # 15 km of 30 m pixels
    hot = np.full((size, size), dn_for(36.0))
    hot[:, : size // 2] = dn_for(30.0)  # cooler western half
    qa_first = np.full((size, size), CLEAR)
    qa_first[: size // 2] = CLOUD  # first scene: northern half cloudy
    write_tif(tmp_path / "A_ST_B10.TIF", hot)
    write_tif(tmp_path / "A_QA_PIXEL.TIF", qa_first)
    write_tif(tmp_path / "B_ST_B10.TIF", np.full((size, size), dn_for(33.0)))
    write_tif(tmp_path / "B_QA_PIXEL.TIF", np.full((size, size), CLEAR))
    requests_seen = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # keep test output quiet
            pass

        def _send(self, body, ctype="application/json"):
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def do_POST(self):
            requests_seen.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            base = f"http://127.0.0.1:{self.server.server_port}/files"
            item = lambda name, day, platform: {
                "id": f"LC0{platform[-1]}_{name}", "properties": {"datetime": f"{day}T03:30:00Z", "platform": platform,
                                                                "eo:cloud_cover": 10},
                "assets": {"lwir11": {"href": f"{base}/{name}_ST_B10.TIF"},
                           "qa_pixel": {"href": f"{base}/{name}_QA_PIXEL.TIF"}}}
            self._send(json.dumps({"features": [item("A", "2026-08-14", "landsat-9"),
                                                item("B", "2026-07-29", "landsat-8")]}).encode())

        def do_GET(self):
            url = urlparse(self.path)
            if url.path == "/token":
                return self._send(json.dumps({"token": "st=2026&sig=abc%2B1"}).encode())
            assert "sig=abc" in url.query, "file read without the token"
            data = (tmp_path / url.path.split("/")[-1]).read_bytes()
            rng = self.headers.get("Range")
            if rng:  # GDAL reads byte ranges
                start, end = (int(x) for x in rng.split("=")[1].split("-"))
                chunk = data[start:end + 1]
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {start}-{start + len(chunk) - 1}/{len(data)}")
                self.send_header("Content-Length", str(len(chunk)))
                self.end_headers()
                self.wfile.write(chunk)
            else:
                self._send(data, "image/tiff")

        do_HEAD = do_GET

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_port
    monkeypatch.setattr(landsat, "STAC_SEARCH_URL", f"http://127.0.0.1:{port}/search")
    monkeypatch.setattr(landsat, "TOKEN_URL", f"http://127.0.0.1:{port}/token")
    monkeypatch.setitem(landsat._token, "value", None)
    yield requests_seen
    server.shutdown()


def test_read_lst_masks_clouds_and_fills_from_the_next_scene(fake_pc):
    grid = ds.Grid(3.05, 101.05, 4, 40)  # 4 km square inside the fake scenes
    out = landsat.read_lst(grid)
    lst = out["lst"]
    assert out["coverage"] == pytest.approx(1.0)
    assert [s["date"] for s in out["scenes"]] == ["2026-08-14", "2026-07-29"]
    assert out["scenes"][0]["platform"] == "Landsat 9"
    south = lst[-5:]  # clear in the first scene: 30 °C west, 36 °C east
    assert np.nanmin(south) == pytest.approx(30.0, abs=0.2) and np.nanmax(south) == pytest.approx(36.0, abs=0.2)
    assert np.allclose(lst[:5], 33.0, atol=0.2)  # cloudy north filled from the second scene
    search = fake_pc[0]
    assert search["collections"] == ["landsat-c2-l2"] and search["query"]["platform"]["in"] == ["landsat-8", "landsat-9"]


def test_signed_adds_the_token_once():
    assert landsat.signed("https://x/a.TIF", "sig=1") == "https://x/a.TIF?sig=1"
    assert landsat.signed("https://x/a.TIF?v=2", "sig=1") == "https://x/a.TIF?v=2&sig=1"


def test_no_scenes_is_unavailable(monkeypatch):
    monkeypatch.setattr(landsat, "search_scenes", lambda *a: [])
    with pytest.raises(ds.DataUnavailable):
        landsat.read_lst(ds.Grid(3.05, 101.05, 4, 40))


def test_catalogue_errors_are_unavailable(monkeypatch):
    def broken(*a):
        raise landsat.requests.ConnectionError("blocked")

    monkeypatch.setattr(landsat, "search_scenes", broken)
    with pytest.raises(ds.DataUnavailable):
        landsat.read_lst(ds.Grid(3.05, 101.05, 4, 40))
