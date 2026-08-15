#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.11"
# dependencies = ["shapely"]
# ///

import json
import urllib.request
from pathlib import Path

import shapely
import shapely.geometry

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "public" / "data"

SOCRATA_DATASET_IDS = {
    "subway_entrances": "i9wp-a4ja",  # MTA Subway Entrances and Exits
    "subway_stations": "vkng-7ivg",  # MTA Subway Station Envelopes
}


def dissolve_by_agency(path):
    """envelopes overlap within a complex, and maplibre blends each one, so translucent fills
    stack darker there; unioning per agency leaves disjoint geometry with nothing to double up"""
    collection = json.loads(path.read_text())
    by_agency = {}
    for feature in collection["features"]:
        agency = feature["properties"]["agency"]
        by_agency.setdefault(agency, []).append(shapely.geometry.shape(feature["geometry"]))

    collection["features"] = [
        {
            "type": "Feature",
            "geometry": shapely.geometry.mapping(shapely.union_all(shapes)),
            "properties": {"agency": agency},
        }
        for agency, shapes in by_agency.items()
    ]
    path.write_text(json.dumps(collection))
    print(f"Dissolved {path} to {len(collection['features'])} agency outlines")


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for name, dataset_id in SOCRATA_DATASET_IDS.items():
        url = f"https://data.ny.gov/resource/{dataset_id}.geojson?$limit=50000"  # Socrata pages at 1000 rows without an explicit limit
        print(f"Fetching {url}", flush=True)
        with urllib.request.urlopen(url, timeout=120) as response:
            body = response.read()

        output_path = OUTPUT_DIR / f"{name}.geojson"
        output_path.write_bytes(body)
        print(f"Wrote {output_path}")

        if name == "subway_stations":
            dissolve_by_agency(output_path)


if __name__ == "__main__":
    main()
