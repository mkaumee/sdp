# test_imagery.py — checks the site photo maths with fake map tiles (no internet).
# Run with:  python -m pytest

import io

import pytest
from PIL import Image

import imagery
from datasources import DataUnavailable


def test_world_px_centre_of_the_world():
    assert imagery.world_px(0, 0, 0) == pytest.approx((128, 128))
    x, y = imagery.world_px(85.0511, -180, 3)
    assert (x, y) == pytest.approx((0, 0), abs=0.01)


def grey_tile(zoom, x, y):
    return Image.new("RGB", (256, 256), (90, 90, 90))


def test_site_photo_outlines_the_cell():
    cell = [[3.0, 101.0], [3.009, 101.009]]  # about 1 km square
    out = imagery.site_photo(cell, margin=0.35, max_px=600, fetch=grey_tile)
    img = Image.open(io.BytesIO(out["jpeg"])).convert("RGB")
    assert max(img.size) <= 600
    assert 1500 < out["width_m"] < 1900  # 1 km cell + 35% each side ≈ 1.7 km
    w, h = img.size
    left_edge = round(w * 0.35 / 1.7)  # where the cell's west side should be drawn
    column = [img.getpixel((x, h // 2)) for x in range(left_edge - 4, left_edge + 5)]
    assert any(r > 200 and g > 180 and b < 140 for r, g, b in column)  # yellow outline (JPEG softens it) found there
    assert img.getpixel((5, 5))[0] < 120  # corners are plain imagery, not outline


def test_site_photo_fails_when_no_tiles_load():
    def broken(zoom, x, y):
        raise OSError("no tile")

    with pytest.raises(DataUnavailable):
        imagery.site_photo([[3.0, 101.0], [3.009, 101.009]], fetch=broken)


def test_thumbnail_is_small():
    buf = io.BytesIO()
    Image.new("RGB", (1024, 900), (1, 2, 3)).save(buf, format="JPEG")
    thumb = Image.open(io.BytesIO(imagery.thumbnail(buf.getvalue(), max_px=480)))
    assert max(thumb.size) == 480
