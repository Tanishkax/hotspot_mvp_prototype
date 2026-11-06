"""Loading, filtering, gridding and coverage detection for NASA FIRMS archives."""
import glob
import os

import numpy as np
import pandas as pd

GRID_DEG = 0.25          # analysis grid cell size (degrees)
TILE_DEG = 5.0           # frontend partition size (degrees)
MODIS_MIN_CONF = 30      # MODIS confidence < 30 is the "low" class
VIIRS_DROP_CONF = {"l"}  # VIIRS low-confidence class
KEEP_TYPES = {0}         # 0 = presumed vegetation fire (drops static industrial sources, volcanoes, offshore)
COLS = ["latitude", "longitude", "acq_date", "satellite", "confidence", "frp", "type"]


def read_firms(paths):
    parts = [pd.read_csv(p, usecols=COLS, dtype={"confidence": str, "satellite": str}) for p in paths]
    d = pd.concat(parts, ignore_index=True)
    d["acq_date"] = pd.to_datetime(d["acq_date"])
    return d


def filter_detections(d, sensor):
    """Keep vegetation-fire detections of nominal/high confidence."""
    keep = d["type"].isin(KEEP_TYPES)
    if sensor == "MODIS":
        keep &= pd.to_numeric(d["confidence"], errors="coerce") >= MODIS_MIN_CONF
    else:
        keep &= ~d["confidence"].str.lower().isin(VIIRS_DROP_CONF)
    keep &= d["latitude"].between(-90, 90) & d["longitude"].between(-180, 180)
    return d.loc[keep].copy()


def satellite_code(d, sensor):
    if sensor == "VIIRS":
        return pd.Series("V", index=d.index)
    return d["satellite"].map({"Terra": "T", "Aqua": "A"})


def cell_index(lat, lon, grid=GRID_DEG):
    """Integer row/col of the grid cell containing each point (lower-left anchored)."""
    return np.floor(np.asarray(lat) / grid).astype(int), np.floor(np.asarray(lon) / grid).astype(int)


def cell_id(row, col, grid=GRID_DEG):
    """ID from the cell's lower-left corner, e.g. N2650E07725 = 26.50N 77.25E."""
    lat = np.asarray(row) * grid
    lon = np.asarray(col) * grid
    return [f"N{int(round(a * 100)):04d}E{int(round(o * 100)):05d}" for a, o in zip(lat, lon)]


def cell_centre(row, col, grid=GRID_DEG):
    return (np.asarray(row) + 0.5) * grid, (np.asarray(col) + 0.5) * grid


def tile_id(lat, lon, tile=TILE_DEG):
    r = np.floor(np.asarray(lat) / tile).astype(int) * int(tile)
    c = np.floor(np.asarray(lon) / tile).astype(int) * int(tile)
    return [f"t{a:02d}_{o:03d}" for a, o in zip(r, c)]


def month_index(dates, base_year=2000):
    """Months since January of base_year (Jan base_year = 0)."""
    dates = pd.DatetimeIndex(dates)
    return (dates.year - base_year) * 12 + (dates.month - 1)


def missing_days(daily, start, end, window=31, q=0.75, min_typical=10):
    """Detect satellite-days with no data (outages).

    daily: DataFrame index=date, columns = satellite codes (T, A, V), values = national detection counts.
    A day is MISSING for a satellite when it recorded zero detections in all of India although its own
    typical activity around that date (75th percentile of daily counts in a centred 31-day window) is
    >= min_typical (10). Nationwide fire activity does not stop abruptly, so such zeros are data gaps.
    Zero days during genuinely quiet periods (monsoon) are not flagged: they cannot be told apart from
    "no fire detected" and are reported as observed zeros.
    Returns DataFrame of booleans (True = missing) for days in [start, end].
    """
    days = pd.date_range(start, end, freq="D")
    daily = daily.reindex(days).fillna(0)
    typical = daily.rolling(window, center=True, min_periods=window // 2).quantile(q)
    return (daily == 0) & (typical >= min_typical)
