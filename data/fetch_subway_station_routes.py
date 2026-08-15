#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

import collections
import csv
import io
import itertools
import json
import urllib.request
import zipfile
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "public" / "data"

# icon-offset units, which maplibre scales by icon-size, so bullets stay adjacent at every zoom
BULLET_SPACING = 24

BULLET_ROW_LIMIT = 5

# a route earns a bullet by normally stopping, not by ever stopping: the 2 makes three weekday
# daytime stops at Christopher St as overnight local service winds down, which is not a 2 stop
MINIMUM_TRIP_SHARE = 0.2

SERVICE_PERIODS = ("regular", "late_night", "weekend")


def symbol_key(symbol):
    """letters before numbers, so the A C E group sorts ahead of the 1 2 3 group"""
    return (0 if symbol[0].isalpha() else 1, symbol)


def read_csv(archive, name):
    with archive.open(f"{name}.txt") as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig"))


def periods_for(*, weekday_service, hour):
    # GTFS hours run past 24 for trips after midnight, which is exactly the late night window
    late_night = hour < 6 or hour >= 24
    if not weekday_service:
        return ("weekend",)
    return ("late_night",) if late_night else ("regular",)


def main():
    url = "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip"
    print(f"Fetching {url}", flush=True)
    with urllib.request.urlopen(url, timeout=300) as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))

    routes = {
        r["route_id"]: {
            "route": r["route_short_name"] or r["route_id"],
            "color": f"#{r['route_color']}" if r["route_color"] else "#808080",
            "text_color": f"#{r['route_text_color']}" if r["route_text_color"] else "#ffffff",
        }
        for r in read_csv(archive, "routes")
    }

    # bullets group by trunk colour, and the groups themselves run alphabetically
    def ordered_bullets(route_ids):
        by_color = {}
        for route_id in route_ids:
            by_color.setdefault(routes[route_id]["color"], []).append(route_id)
        groups = sorted(
            (
                sorted(group, key=lambda r: symbol_key(routes[r]["route"]))
                for group in by_color.values()
            ),
            key=lambda group: symbol_key(routes[group[0]]["route"]),
        )
        return [route_id for group in groups for route_id in group]

    # an express bullet implies its local, so a stop served by both shows only the diamond
    def express_only(route_ids):
        symbols = {routes[route_id]["route"] for route_id in route_ids}
        return {
            route_id for route_id in route_ids if f"{routes[route_id]['route']}X" not in symbols
        }

    weekday_services = {
        c["service_id"]: c["monday"] == "1" or c["tuesday"] == "1" or c["wednesday"] == "1"
        for c in read_csv(archive, "calendar")
    }

    trips = {
        t["trip_id"]: (t["route_id"], weekday_services.get(t["service_id"], True))
        for t in read_csv(archive, "trips")
    }

    stations = {}
    station_of = {}
    for s in read_csv(archive, "stops"):
        if s["location_type"] == "1":
            stations[s["stop_id"]] = {
                "name": s["stop_name"],
                "lon": float(s["stop_lon"]),
                "lat": float(s["stop_lat"]),
            }
        station_of[s["stop_id"]] = s["parent_station"] or s["stop_id"]

    served = {period: {} for period in SERVICE_PERIODS}
    route_trips = {period: collections.defaultdict(set) for period in SERVICE_PERIODS}
    for stop_time in read_csv(archive, "stop_times"):
        route_id, weekday_service = trips[stop_time["trip_id"]]
        station_id = station_of[stop_time["stop_id"]]
        hour = int(stop_time["arrival_time"].split(":")[0])
        for period in periods_for(weekday_service=weekday_service, hour=hour):
            served[period].setdefault(station_id, collections.Counter())[route_id] += 1
            route_trips[period][route_id].add(stop_time["trip_id"])

    # the MTA renames constituents to a shared name when they are really one station, so a name
    # within a complex is the right grain: both halves of Delancey St-Essex St merge, while
    # 42 St-Port Authority stays out of Times Sq despite sharing complex 611 with it
    complexes_url = "https://data.ny.gov/resource/39hk-dx4f.json?$limit=5000"
    print(f"Fetching {complexes_url}", flush=True)
    with urllib.request.urlopen(complexes_url, timeout=120) as response:
        station_key_of = {
            row["gtfs_stop_id"]: (row["complex_id"], row["stop_name"])
            for row in json.load(response)
        }

    complexes = {}
    for station_id, station in stations.items():
        complexes.setdefault(station_key_of[station_id], []).append((station_id, station))

    def bullet_offsets(route_ids):
        """route_id -> icon offset, wrapping wide complexes onto rows that never split a colour"""
        rows = [[]]
        if len(route_ids) > BULLET_ROW_LIMIT:
            for _, group in itertools.groupby(route_ids, key=lambda r: routes[r]["color"]):
                group = list(group)
                if rows[-1] and len(rows[-1]) + len(group) > BULLET_ROW_LIMIT:
                    rows.append([])
                rows[-1].extend(group)
        else:
            rows = [list(route_ids)]
        return {
            route_id: [
                (column + 0.5) * BULLET_SPACING,
                (index - (len(rows) - 1) / 2) * BULLET_SPACING,
            ]
            for index, row in enumerate(rows)
            for column, route_id in enumerate(row)
        }

    features = []
    for (_, name), members in complexes.items():
        lon = sum(station["lon"] for _, station in members) / len(members)
        lat = sum(station["lat"] for _, station in members) / len(members)
        here = {}
        for period in SERVICE_PERIODS:
            stops = collections.Counter()
            for station_id, _ in members:
                stops.update(served[period].get(station_id, {}))
            here[period] = express_only(
                {
                    route_id
                    for route_id, count in stops.items()
                    if count >= MINIMUM_TRIP_SHARE * len(route_trips[period][route_id])
                }
            )
        offsets = {
            period: bullet_offsets(ordered_bullets(here[period])) for period in SERVICE_PERIODS
        }
        for position, route_id in enumerate(ordered_bullets(set().union(*here.values()))):
            properties = {
                "station_name": name,
                **routes[route_id],
            }
            for period in SERVICE_PERIODS:
                if route_id in offsets[period]:
                    properties[f"offset_{period}"] = offsets[period][route_id]
            # one bullet per station carries the label, clearing however many rows it wraps onto
            if position == 0:
                properties["label"] = name
                for period in SERVICE_PERIODS:
                    if offsets[period]:
                        rows = len({y for _, y in offsets[period].values()})
                        properties[f"label_offset_{period}"] = [0, -((rows - 1) * 0.53 + 0.41)]
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": properties,
                }
            )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    geojson_path = OUTPUT_DIR / "subway_station_routes.geojson"
    geojson_path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    print(f"Wrote {geojson_path} ({len(features)} bullets across {len(complexes)} complexes)")

    # the frontend draws one bullet image per route, so it needs the routes without parsing the geojson
    bullets_path = OUTPUT_DIR / "subway_bullets.json"
    bullets_path.write_text(json.dumps(sorted(routes.values(), key=lambda bullet: bullet["route"])))
    print(f"Wrote {bullets_path} ({len(routes)} routes)")


if __name__ == "__main__":
    main()
