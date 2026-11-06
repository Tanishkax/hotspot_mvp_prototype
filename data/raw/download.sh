#!/usr/bin/env bash
# Downloads NASA FIRMS yearly country archives for India (standard-quality, archive).
set -u
cd "$(dirname "$0")"
base=https://firms.modaps.eosdis.nasa.gov/data/country
for y in $(seq 2000 2025); do f=modis_${y}_India.csv; [ -s $f ] || curl -sSf --retry 4 -o $f.part $base/modis/$y/$f && mv -f $f.part $f 2>/dev/null; done
for y in $(seq 2012 2025); do f=viirs-snpp_${y}_India.csv; [ -s $f ] || curl -sSf --retry 4 -o $f.part $base/viirs-snpp/$y/$f && mv -f $f.part $f 2>/dev/null; done
ls -la
