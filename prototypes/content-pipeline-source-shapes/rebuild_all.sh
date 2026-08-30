#!/bin/sh
# PROTOTYPE (spike #44) — one command, because rebuilding the pool without
# regenerating BOTH pages leaves stale HTML that looks like a filter bug.
set -e
cd "$(dirname "$0")"
./venv/bin/python build_nominations.py
./venv/bin/python build_pool.py
./venv/bin/python fetch_labels.py
./venv/bin/python build_browser.py
./venv/bin/python build_nom_browser.py
./venv/bin/python build_elo_poc.py endorsed
./venv/bin/python build_elo_poc.py unendorsed
REPO=/Users/cwebley/src/word-well/prototypes
cp band_browser.html        "$REPO/band-browser-prototype.html"
cp nominations_browser.html "$REPO/nominations-prototype.html"
cp elo_poc.html            "$REPO/rating-dynamics-prototype.html"
cp elo_poc_unendorsed.html "$REPO/rating-dynamics-unendorsed-prototype.html"
cp build_pool.py build_browser.py build_nominations.py build_nom_browser.py build_elo_poc.py \
   fetch_labels.py rebuild_all.sh out/pool.sqlite out/nominations.json \
   collegetransitions-act-175.txt "$REPO/content-pipeline-source-shapes/"
echo "rebuilt both pages at $(date '+%Y-%m-%d %H:%M')"
