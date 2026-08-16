#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

import json
import urllib.request
from pathlib import Path

OUTPUT_PATH = (
    Path(__file__).resolve().parent.parent / "public" / "data" / "citibike_stations.geojson"
)


def main():
    discovery_url = "https://gbfs.citibikenyc.com/gbfs/2.3/gbfs.json"
    print(f"Fetching {discovery_url}", flush=True)
    with urllib.request.urlopen(discovery_url, timeout=120) as response:
        feeds = json.load(response)["data"]["en"]["feeds"]

    station_information_url = next(
        feed["url"] for feed in feeds if feed["name"] == "station_information"
    )
    print(f"Fetching {station_information_url}", flush=True)
    with urllib.request.urlopen(station_information_url, timeout=120) as response:
        stations = json.load(response)["data"]["stations"]

    features = [
        {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [station["lon"], station["lat"]],
            },
            "properties": {
                "station_id": station["station_id"],
                "name": station["name"],
                "capacity": station["capacity"],
            },
        }
        for station in sorted(stations, key=lambda station: station["station_id"])
    ]

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps({"type": "FeatureCollection", "features": features}))


if __name__ == "__main__":
    main()
