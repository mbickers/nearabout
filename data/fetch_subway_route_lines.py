#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

import csv
import io
import json
import urllib.request
import zipfile
from pathlib import Path


def read_csv(archive, name):
    with archive.open(f"{name}.txt") as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig"))


def main():
    output_path = (
        Path(__file__).resolve().parent.parent / "public" / "data" / "subway_routes.geojson"
    )
    # Use trip geometry for tracks (rather than MTA service lines, which go beyond terminals on some lines)
    url = "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip"
    print(f"Fetching {url}", flush=True)
    with urllib.request.urlopen(url, timeout=300) as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))

    routes = {
        r["route_id"]: {
            "route": r["route_short_name"] or r["route_id"],
            "color": f"#{r['route_color']}" if r["route_color"] else "#808080",
        }
        for r in read_csv(archive, "routes")
    }

    shapes_of_route = {}
    for trip in read_csv(archive, "trips"):
        shapes_of_route.setdefault(trip["route_id"], set()).add(trip["shape_id"])

    points = {}
    for point in read_csv(archive, "shapes"):
        points.setdefault(point["shape_id"], []).append(
            (
                int(point["shape_pt_sequence"]),
                float(point["shape_pt_lon"]),
                float(point["shape_pt_lat"]),
            )
        )

    shapes_by_color = {}
    for route_id, shape_ids in sorted(shapes_of_route.items()):
        for shape_id in sorted(shape_ids):
            shapes_by_color.setdefault(routes[route_id]["color"], []).append(
                [(lon, lat) for _, lon, lat in sorted(points[shape_id])]
            )

    # Geometric normalization belongs to precompute_subway_offsets.py.
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "MultiLineString", "coordinates": shapes},
            "properties": {"color": color},
        }
        for color, shapes in sorted(shapes_by_color.items())
    ]

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))


if __name__ == "__main__":
    main()
