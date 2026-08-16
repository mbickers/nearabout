#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

import urllib.request
from pathlib import Path


def main():
    output_dir = Path(__file__).resolve().parent.parent / "public" / "data"
    output_dir.mkdir(parents=True, exist_ok=True)

    for name, dataset_id in {
        "subway_entrances": "i9wp-a4ja",  # MTA Subway Entrances and Exits
        "subway_stations": "vkng-7ivg",  # MTA Subway Station Envelopes
    }.items():
        url = f"https://data.ny.gov/resource/{dataset_id}.geojson?$limit=50000"  # Socrata pages at 1000 rows without an explicit limit
        print(f"Fetching {url}", flush=True)
        with urllib.request.urlopen(url, timeout=120) as response:
            body = response.read()

        output_path = output_dir / f"{name}.geojson"
        output_path.write_bytes(body)


if __name__ == "__main__":
    main()
