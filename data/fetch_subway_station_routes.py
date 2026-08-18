#!/usr/bin/env -S uv run

import collections
import csv
import io
import itertools
import json
import urllib.request
import zipfile
from pathlib import Path


def symbol_key(symbol):
    """Sort key ordering letters before numbers, so the A C E group precedes the 1 2 3 group."""
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
    output_dir = Path(__file__).resolve().parent.parent / "public" / "data"
    service_periods = ("regular", "late_night", "weekend")
    url = "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip"
    print(f"Fetching {url}", flush=True)
    with urllib.request.urlopen(url, timeout=300) as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))

    route_rows = list(read_csv(archive, "routes"))
    routes = {
        r["route_id"]: {
            "route": r["route_short_name"] or r["route_id"],
            "color": f"#{r['route_color']}" if r["route_color"] else "#808080",
            "text_color": f"#{r['route_text_color']}" if r["route_text_color"] else "#ffffff",
        }
        for r in route_rows
    }
    express_route_ids = {r["route_id"] for r in route_rows if "Express" in r["route_long_name"]}

    # bullets are grouped by trunk colour, and the groups ordered alphabetically
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

    served = {period: {} for period in service_periods}
    route_trips = {period: collections.defaultdict(set) for period in service_periods}
    for stop_time in read_csv(archive, "stop_times"):
        route_id, weekday_service = trips[stop_time["trip_id"]]
        station_id = station_of[stop_time["stop_id"]]
        hour = int(stop_time["arrival_time"].split(":")[0])
        for period in periods_for(weekday_service=weekday_service, hour=hour):
            served[period].setdefault(station_id, collections.Counter())[route_id] += 1
            route_trips[period][route_id].add(stop_time["trip_id"])

    # The MTA gives constituent stations a shared name where they are really one station, so a
    # name within a complex is the unit to group on: both halves of Delancey St-Essex St merge,
    # while 42 St-Port Authority stays separate from Times Sq despite sharing complex 611.
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
        """Map each route_id to its icon offset.

        A complex wider than five bullets wraps onto further rows, which are broken between
        colour groups so that no group is split across two rows.
        """
        # icon-offset units, which maplibre scales by icon-size
        bullet_spacing = 24
        bullet_row_limit = 5
        rows = [[]]
        if len(route_ids) > bullet_row_limit:
            for _, group in itertools.groupby(route_ids, key=lambda r: routes[r]["color"]):
                group = list(group)
                if rows[-1] and len(rows[-1]) + len(group) > bullet_row_limit:
                    rows.append([])
                rows[-1].extend(group)
        else:
            rows = [list(route_ids)]
        return {
            route_id: [
                (column + 0.5) * bullet_spacing,
                (index - (len(rows) - 1) / 2) * bullet_spacing,
            ]
            for index, row in enumerate(rows)
            for column, route_id in enumerate(row)
        }

    features = []
    for (_, name), members in complexes.items():
        lon = sum(station["lon"] for _, station in members) / len(members)
        lat = sum(station["lat"] for _, station in members) / len(members)
        here = {}
        for period in service_periods:
            stops = collections.Counter()
            for station_id, _ in members:
                stops.update(served[period].get(station_id, {}))
            here[period] = express_only(
                {
                    route_id
                    for route_id, count in stops.items()
                    # Stopping at all is too weak a test: the 2 makes three weekday daytime stops
                    # at Christopher St during the transition out of overnight local service.
                    if count >= 0.2 * len(route_trips[period][route_id])
                }
            )
        offsets = {
            period: bullet_offsets(ordered_bullets(here[period])) for period in service_periods
        }
        for position, route_id in enumerate(ordered_bullets(set().union(*here.values()))):
            properties = {
                "station_name": name,
                **routes[route_id],
            }
            for period in service_periods:
                if route_id in offsets[period]:
                    properties[f"offset_{period}"] = offsets[period][route_id]
            # the label goes on one bullet per station, offset clear of every row it wraps onto
            if position == 0:
                properties["label"] = name
                for period in service_periods:
                    if offsets[period]:
                        rows = len({y for _, y in offsets[period].values()})
                        properties[f"label_offset_{period}"] = [0, -((rows - 1) * 0.53 + 0.41)]
                        properties[f"express_{period}"] = bool(here[period] & express_route_ids)
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": properties,
                }
            )

    output_dir.mkdir(parents=True, exist_ok=True)

    geojson_path = output_dir / "subway_station_routes.geojson"
    geojson_path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))

    # The frontend needs routes separately because it draws one bullet image per route.
    bullets_path = output_dir / "subway_bullets.json"
    bullets_path.write_text(json.dumps(sorted(routes.values(), key=lambda bullet: bullet["route"])))


if __name__ == "__main__":
    main()
