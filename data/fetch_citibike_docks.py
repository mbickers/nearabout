#!/usr/bin/env -S uv run

import json
import urllib.request
from pathlib import Path


def main():
    output_path = (
        Path(__file__).resolve().parent.parent / "public" / "data" / "citibike_docks.geojson"
    )
    discovery_url = "https://gbfs.citibikenyc.com/gbfs/2.3/gbfs.json"
    print(f"Fetching {discovery_url}", flush=True)
    with urllib.request.urlopen(discovery_url, timeout=120) as response:
        feeds = json.load(response)["data"]["en"]["feeds"]

    dock_information_url = next(
        feed["url"] for feed in feeds if feed["name"] == "station_information"
    )
    print(f"Fetching {dock_information_url}", flush=True)
    with urllib.request.urlopen(dock_information_url, timeout=120) as response:
        docks = json.load(response)["data"]["stations"]

    features = [
        {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [dock["lon"], dock["lat"]],
            },
            "properties": {
                "station_id": dock["station_id"],
                "name": dock["name"],
                "capacity": dock["capacity"],
            },
        }
        for dock in sorted(docks, key=lambda dock: dock["station_id"])
    ]

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))


if __name__ == "__main__":
    main()
