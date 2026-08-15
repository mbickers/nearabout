#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

import urllib.request
from pathlib import Path

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "public" / "data" / "bike_routes.geojson"


def main():
    url = (
        "https://data.cityofnewyork.us/resource/mzxg-pwib.geojson"
        "?$limit=50000"  # Socrata pages at 1000 rows without an explicit limit
        "&$where=status='Current'"  # the dataset is current *and* historic; retired segments are no longer on the street
    )
    print(f"Fetching {url}", flush=True)
    with urllib.request.urlopen(url, timeout=120) as response:
        body = response.read()

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_bytes(body)
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
