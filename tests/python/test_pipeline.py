"""Unit tests for the data pipeline and integrity tests for the published dataset."""
import glob
import json
import os
import sys

import numpy as np
import pandas as pd
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
import firms  # noqa: E402
import harmonise_counts as hc  # noqa: E402
from build_validation import lower_band  # noqa: E402

DATA = os.path.join(ROOT, "site", "data")


# ---------------- gridding ----------------
def test_cell_index_and_id_are_lower_left_anchored():
    r, c = firms.cell_index([26.51, 26.49, -0.1], [77.26, 77.24, 0.1])
    assert list(r) == [106, 105, -1] and list(c) == [309, 308, 0]
    assert firms.cell_id([106], [309]) == ["N2650E07725"]
    lat, lon = firms.cell_centre([106], [309])
    assert lat[0] == pytest.approx(26.625) and lon[0] == pytest.approx(77.375)


def test_tile_and_month_index():
    assert firms.tile_id([26.6], [77.4]) == ["t25_075"]
    assert list(firms.month_index(pd.to_datetime(["2000-01-15", "2025-12-31"]))) == [0, 311]


# ---------------- filtering ----------------
def test_filter_detections_rules():
    d = pd.DataFrame({"latitude": [20, 20, 20, 20, 95], "longitude": [80] * 5,
                      "confidence": ["80", "29", "30", "90", "90"], "type": [0, 0, 0, 2, 0],
                      "frp": [1] * 5, "satellite": ["Terra"] * 5, "acq_date": pd.to_datetime(["2020-01-01"] * 5)})
    kept = firms.filter_detections(d, "MODIS")
    assert list(kept.index) == [0, 2]   # low confidence, static source and bad latitude dropped
    v = d.assign(confidence=["n", "l", "h", "n", "n"])
    assert list(firms.filter_detections(v, "VIIRS").index) == [0, 2]


# ---------------- outage detection ----------------
def test_missing_days_flags_zero_days_in_active_periods_only():
    days = pd.date_range("2020-01-01", "2020-03-31")
    daily = pd.DataFrame({"V": 100.0}, index=days)
    daily.loc["2020-02-10":"2020-02-12", "V"] = 0      # outage during busy season
    quiet = pd.DataFrame({"V": 0.0}, index=days)
    quiet.iloc[::5] = 3                                 # genuinely quiet period with sporadic fires
    m = firms.missing_days(daily, days[0], days[-1])
    assert m["V"].sum() == 3 and m.loc["2020-02-11", "V"]
    assert firms.missing_days(quiet, days[0], days[-1])["V"].sum() == 0


# ---------------- harmonisation ----------------
def _cm():
    return pd.DataFrame({
        "band": [20.0] * 40 + [30.0] * 40,
        "M": [10] * 40 + [5] * 40,
        "V": [50] * 40 + [10] * 39 + [0],
    })


def test_ratio_of_sums_and_evidence_threshold():
    t = hc.ratio_of_sums_by_band(_cm(), "M", "V", min_pairs=30, min_modis=100)
    assert t.loc[20.0, "ratio"] == pytest.approx(5.0)
    assert t.loc[30.0, "ratio"] == pytest.approx(390 / 200)
    assert t.loc[30.0, "n_pairs"] == 39
    strict = hc.ratio_of_sums_by_band(_cm(), "M", "V", min_pairs=40, min_modis=100)
    assert np.isnan(strict.loc[30.0, "ratio"]) and strict.loc[20.0, "ratio"] == pytest.approx(5.0)


def test_ratio_of_sums_keeps_single_sensor_months_unlike_median_of_pairs():
    cm = pd.DataFrame({"band": [0.0] * 4, "M": [10, 10, 0, 0], "V": [10, 10, 20, 20]})
    t = hc.ratio_of_sums_by_band(cm, "M", "V", min_pairs=1, min_modis=1)
    assert t.loc[0.0, "median_pair_ratio"] == pytest.approx(1.0)
    assert t.loc[0.0, "ratio"] == pytest.approx(3.0)  # totals: 60 / 20


def test_fusion_switches_sensor_and_never_sums():
    cm = pd.DataFrame({"m": [0, 1, 2, 3], "band": [20.0] * 4, "T": [2, 2, 2, 2], "A": [0, 3, 3, 3], "V": [0, 0, 40, 0]})
    ratios = {"TA": pd.DataFrame({"ratio": [4.0]}, index=[20.0]), "T": pd.DataFrame({"ratio": [10.0]}, index=[20.0])}
    out = hc.fuse(cm, {0: "T", 1: "TA", 2: "V", 3: "V"}, ratios, {"TA": 5.0, "T": 15.0})
    assert list(out) == [20.0, 20.0, 40.0, 0.0]   # VIIRS months ignore MODIS entirely (no double counting)
    out2 = hc.fuse(cm.assign(band=99.0), {0: "T", 1: "TA", 2: "V", 3: "V"}, ratios, {"TA": 5.0, "T": 15.0})
    assert list(out2[:2]) == [30.0, 25.0]          # fallback ratios for unknown band


def test_agreement_metrics():
    m = hc.agreement_metrics([10, 20, 30], [10, 20, 40])
    assert m["n"] == 3 and m["mean_bias"] == pytest.approx(-10 / 3)
    assert m["percent_bias"] == pytest.approx(-100 * 10 / 70) and m["mae"] == pytest.approx(10 / 3)
    assert hc.agreement_metrics([1], [1]) == {"n": 1}


def test_lower_band_is_symmetric_in_log_space():
    base, sd, z = 20.0, 0.5, 3
    upper = np.expm1(np.log1p(base) + z * sd)
    assert lower_band(np.array([base]), np.array([upper]))[0] == pytest.approx(max(0, np.expm1(np.log1p(base) - z * sd)))


# ---------------- published dataset integrity ----------------
needs_data = pytest.mark.skipif(not os.path.exists(os.path.join(DATA, "manifest.json")), reason="dataset not built")


@needs_data
def test_manifest_and_tiles_are_consistent():
    man = json.load(open(os.path.join(DATA, "manifest.json")))
    n = len(man["months"]["m"])
    src = man["months"]["source"]
    total = 0.0
    seen = set()
    for t in man["tiles"]:
        tile = json.load(open(os.path.join(DATA, "tiles", f"{t['id']}.json")))
        r, cells = tile["rec"], tile["cells"]
        w, s, e, nn = t["bbox"]
        assert all(s <= la < nn for la in cells["lat"]) and all(w <= lo < e for lo in cells["lon"])
        assert not seen & set(cells["id"]); seen |= set(cells["id"])
        assert len(set(zip(r["c"], r["m"]))) == len(r["c"]), "duplicate cell-month record"
        for i in range(len(r["c"])):
            m = r["m"][i]
            assert 0 <= m < n and src[m] is not None and r["h"][i] >= 0
            if src[m] == "V":
                assert r["h"][i] == r["vi"][i]        # VIIRS months are VIIRS counts
        total += sum(r["h"])
        assert os.path.getsize(os.path.join(DATA, "tiles", f"{t['id']}.json")) == t["bytes"]
    assert len(seen) == man["coverage"]["n_cells"]
    assert total == pytest.approx(man["coverage"]["total_h"], rel=1e-9)


@needs_data
def test_months_before_coverage_have_no_source():
    man = json.load(open(os.path.join(DATA, "manifest.json")))
    start = firms.month_index(pd.to_datetime([man["coverage"]["start"] + "-01"]))[0]
    assert all(s is None for s in man["months"]["source"][:start])
    assert all(s is not None for s in man["months"]["source"][start:])


@needs_data
def test_validation_files_have_expected_shape():
    for name in ["real_harmonisation", "real_weekly_frp", "synthetic_weekly_frp"]:
        v = json.load(open(os.path.join(DATA, "validation", f"{name}.json")))
        assert v["kind"] in ("real", "synthetic")
    syn = json.load(open(os.path.join(DATA, "validation", "synthetic_weekly_frp.json")))
    assert syn["kind"] == "synthetic" and "C009" in syn["cells"]


def test_upstream_pipeline_is_unchanged():
    a = open(os.path.join(ROOT, "pipeline", "fire_harmonise.py"), "rb").read()
    b = open(os.path.join(ROOT, "project-inputs", "fire_harmonise.py"), "rb").read()
    assert a == b, "pipeline/fire_harmonise.py must stay identical to the supplied upstream file"
