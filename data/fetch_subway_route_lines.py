#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.11"
# dependencies = ["shapely"]
# ///

import csv
import io
import json
import urllib.request
import zipfile
from pathlib import Path

import shapely
import shapely.geometry

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "public" / "data" / "subway_routes.geojson"


def read_csv(archive, name):
    with archive.open(f"{name}.txt") as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig"))


def dissolve_by_color(shapes_by_color):
    """Merge the shapes of each colour into one feature, so no track is drawn twice.

    - GTFS carries a shape per route and several more per route for the express, local and
      short-turn variants, so a trunk would otherwise be drawn a dozen times over
    - maplibre applies line-opacity to each fragment and has no per-layer equivalent for a line
      layer, so a translucent line drawn twice is not translucent
    - routes sharing a trunk share a colour, which is all the style reads
    """
    return [
        {
            "type": "Feature",
            "geometry": shapely.geometry.mapping(shapely.line_merge(shapely.union_all(shapes))),
            "properties": {"color": color},
        }
        for color, shapes in sorted(shapes_by_color.items())
    ]


def main():
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
                shapely.geometry.LineString(
                    [(lon, lat) for _, lon, lat in sorted(points[shape_id])]
                )
            )

    features = dissolve_by_color(shapes_by_color)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps({"type": "FeatureCollection", "features": features}))


if __name__ == "__main__":
    main()
