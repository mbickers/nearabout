#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.11"
# dependencies = ["shapely"]
# ///

import json
import math
import statistics
from itertools import pairwise
from pathlib import Path

import shapely
import shapely.geometry


def projected_delta(first, second):
    latitude = math.radians((first[1] + second[1]) / 2)
    return (
        (second[0] - first[0]) * 111_320 * math.cos(latitude),
        (second[1] - first[1]) * 110_540,
    )


def line_features(collection):
    return [
        {**feature, "geometry": {"type": "LineString", "coordinates": coordinates}}
        for feature in collection["features"]
        for coordinates in (
            feature["geometry"]["coordinates"]
            if feature["geometry"]["type"] == "MultiLineString"
            else [feature["geometry"]["coordinates"]]
        )
    ]


def derive_subway_offsets(
    subway,
    protected_bike,
    *,
    sample_meters=5,
    overlap_distance_meters=20,
    smoothing_meters=100,
    minimum_run_meters=750,
    same_owner_snap_meters=2,
):
    # Offset derivation pipeline:
    # - Split out-and-back paths, remove legs covered by longer same-color paths, and dissolve.
    # - Orient every resulting path along its dominant axis and rank route colors by trunk priority.
    # - Resample subway and protected-bike paths into 5m segments and index them spatially.
    # - Count earlier-priority subway colors and protected bike lanes that run nearby and parallel.
    # - Average each path over 100m, round to whole slots, and bridge short downward gaps.
    # - Average again over 200m and taper offsets to zero where dissolved paths share a junction.
    # - Emit connected segments with identical offsets as one LineString for MapLibre line-offset.
    subway_parts = []
    properties_by_owner = {}
    coordinates_by_owner = {}
    geometries_by_owner = {}
    for feature in subway["features"]:
        owner = str(
            feature["properties"]["id"]
            if "id" in feature["properties"]
            else feature["properties"]["color"]
        )
        properties_by_owner[owner] = feature["properties"]
        for route_geometry in shapely.get_parts(shapely.geometry.shape(feature["geometry"])):
            coordinates = list(route_geometry.coords)
            if len(coordinates) > 2 and coordinates[0] == coordinates[-1]:
                split_index = max(
                    range(1, len(coordinates) - 1),
                    key=lambda index: shapely.Point(coordinates[0]).distance(
                        shapely.Point(coordinates[index])
                    ),
                )
                geometries_by_owner.setdefault(owner, []).extend(
                    [
                        shapely.LineString(coordinates[: split_index + 1]),
                        shapely.LineString(coordinates[split_index:]),
                    ]
                )
            else:
                geometries_by_owner.setdefault(owner, []).append(route_geometry)

    for owner, geometries in geometries_by_owner.items():
        normalized_geometries = []
        geometry = None
        for route_geometry in sorted(
            geometries, key=lambda route_geometry: (-route_geometry.length, route_geometry.wkb)
        ):
            if geometry is not None:
                if shapely.covered_by(
                    route_geometry,
                    shapely.buffer(geometry, same_owner_snap_meters / 110_540),
                ):
                    continue
                route_geometry = shapely.snap(
                    route_geometry, geometry, same_owner_snap_meters / 110_540
                )
            normalized_geometries.append(route_geometry)
            geometry = shapely.union_all(normalized_geometries)
        geometry = shapely.line_merge(geometry)
        for line in shapely.get_parts(geometry):
            coordinates = [list(coordinate) for coordinate in line.coords]
            delta_x, delta_y = projected_delta(coordinates[0], coordinates[-1])
            if (abs(delta_y) >= abs(delta_x) and delta_y < 0) or (
                abs(delta_x) > abs(delta_y) and delta_x < 0
            ):
                coordinates.reverse()
            coordinates_by_owner.setdefault(owner, []).extend(coordinates)
            subway_parts.append({"owner": owner, "coordinates": coordinates})

    endpoint_counts = {}
    for part in subway_parts:
        for endpoint in (part["coordinates"][0], part["coordinates"][-1]):
            key = part["owner"], tuple(endpoint)
            endpoint_counts[key] = endpoint_counts.get(key, 0) + 1

    def manhattan_longitude(owner):
        coordinates = [
            position
            for position in coordinates_by_owner[owner]
            if -74.03 <= position[0] <= -73.92 and 40.68 <= position[1] <= 40.88
        ]
        if not coordinates:
            coordinates = coordinates_by_owner[owner]
        return statistics.median(position[0] for position in coordinates)

    ordered_owners = [
        owner
        for owner in [
            "#0062CF",
            "#D82233",
            "#EB6800",
            "#F6BC26",
            "#009952",
            "#8E5C33",
            "#9A38A1",
            "#7C858C",
            "#799534",
            "#08179C",
        ]
        if owner in coordinates_by_owner
    ]
    ordered_owners.extend(
        owner
        for owner in sorted(
            coordinates_by_owner, key=lambda owner: (manhattan_longitude(owner), owner)
        )
        if owner not in ordered_owners
    )
    owner_priority = {owner: priority for priority, owner in enumerate(ordered_owners)}

    def sampled_segments(coordinates, *, owner, part):
        segments = []
        for start, end in pairwise(coordinates):
            delta_x, delta_y = projected_delta(start, end)
            length = math.hypot(delta_x, delta_y)
            divisions = max(1, math.ceil(length / sample_meters))
            for division in range(divisions):
                first_fraction = division / divisions
                second_fraction = (division + 1) / divisions
                divided_start = [
                    start[0] + (end[0] - start[0]) * first_fraction,
                    start[1] + (end[1] - start[1]) * first_fraction,
                ]
                divided_end = [
                    start[0] + (end[0] - start[0]) * second_fraction,
                    start[1] + (end[1] - start[1]) * second_fraction,
                ]
                segments.append(
                    {
                        "owner": owner,
                        "part": part,
                        "start": divided_start,
                        "end": divided_end,
                        "midpoint": [
                            (divided_start[0] + divided_end[0]) / 2,
                            (divided_start[1] + divided_end[1]) / 2,
                        ],
                        "length": length / divisions,
                        "angle": math.atan2(delta_y, delta_x),
                    }
                )
        return segments

    subway_segments = []
    segments_by_part = []
    for part, subway_part in enumerate(subway_parts):
        segments = sampled_segments(
            subway_part["coordinates"], owner=subway_part["owner"], part=part
        )
        subway_segments.extend(segments)
        segments_by_part.append(segments)

    bike_segments = [
        segment
        for part, feature in enumerate(line_features(protected_bike))
        for segment in sampled_segments(feature["geometry"]["coordinates"], owner="bike", part=part)
    ]

    grid_size = overlap_distance_meters * 2

    def grid_point(position):
        x, y = projected_delta([-74.3, 40.45], position)
        return math.floor(x / grid_size), math.floor(y / grid_size)

    grid = {}
    for segment in subway_segments + bike_segments:
        grid.setdefault(grid_point(segment["midpoint"]), []).append(segment)

    for segment in subway_segments:
        grid_x, grid_y = grid_point(segment["midpoint"])
        nearby_owners = set()
        for x_offset in (-1, 0, 1):
            for y_offset in (-1, 0, 1):
                for candidate in grid.get((grid_x + x_offset, grid_y + y_offset), []):
                    if candidate["owner"] == segment["owner"] or (
                        candidate["owner"] != "bike"
                        and owner_priority[candidate["owner"]] >= owner_priority[segment["owner"]]
                    ):
                        continue
                    if abs(math.sin(segment["angle"] - candidate["angle"])) > math.sin(
                        math.radians(12)
                    ):
                        continue
                    candidate_x, candidate_y = projected_delta(candidate["start"], candidate["end"])
                    midpoint_x, midpoint_y = projected_delta(
                        candidate["start"], segment["midpoint"]
                    )
                    length_squared = candidate_x**2 + candidate_y**2
                    fraction = max(
                        0,
                        min(
                            1,
                            0
                            if length_squared == 0
                            else (midpoint_x * candidate_x + midpoint_y * candidate_y)
                            / length_squared,
                        ),
                    )
                    if (
                        math.hypot(
                            midpoint_x - fraction * candidate_x,
                            midpoint_y - fraction * candidate_y,
                        )
                        <= overlap_distance_meters
                    ):
                        nearby_owners.add(candidate["owner"])
        segment["offset"] = len(nearby_owners)

    def rolling_average(segments, values, *, window_meters):
        centers = []
        distance = 0
        for segment in segments:
            centers.append(distance + segment["length"] / 2)
            distance += segment["length"]
        prefix_sums = [0]
        for value in values:
            prefix_sums.append(prefix_sums[-1] + value)

        averages = []
        first = 0
        last = 0
        radius = window_meters / 2
        for center in centers:
            while centers[first] < center - radius:
                first += 1
            while last + 1 < len(centers) and centers[last + 1] <= center + radius:
                last += 1
            averages.append((prefix_sums[last + 1] - prefix_sums[first]) / (last - first + 1))
        return averages

    def suppress_short_runs(segments, values):
        values = list(values)
        while True:
            runs = []
            start = 0
            for index in range(1, len(values) + 1):
                if index == len(values) or values[index] != values[start]:
                    runs.append((start, index, sum(s["length"] for s in segments[start:index])))
                    start = index
            changed = False
            for index, (start, end, length) in enumerate(runs[1:-1], start=1):
                if length >= minimum_run_meters:
                    continue
                previous = values[runs[index - 1][0]]
                following = values[runs[index + 1][0]]
                if previous != following or values[start] >= previous:
                    continue
                values[start:end] = [previous] * (end - start)
                changed = True
            if not changed:
                return values

    for segments in segments_by_part:
        averaged_offsets = rolling_average(
            segments,
            [segment["offset"] for segment in segments],
            window_meters=smoothing_meters,
        )
        rounded_offsets = [math.floor(offset + 0.5) for offset in averaged_offsets]
        rounded_offsets = suppress_short_runs(segments, rounded_offsets)
        smoothed_offsets = rolling_average(
            segments, rounded_offsets, window_meters=smoothing_meters * 2
        )
        part = subway_parts[segments[0]["part"]]
        taper_start = endpoint_counts[(part["owner"], tuple(part["coordinates"][0]))] > 1
        taper_end = endpoint_counts[(part["owner"], tuple(part["coordinates"][-1]))] > 1
        total_length = sum(segment["length"] for segment in segments)
        distance = 0
        for segment, offset in zip(segments, smoothed_offsets):
            center = distance + segment["length"] / 2
            if taper_start:
                offset *= min(1, max(0, (center - segment["length"] / 2) / smoothing_meters))
            if taper_end:
                offset *= min(
                    1,
                    max(0, (total_length - center - segment["length"] / 2) / smoothing_meters),
                )
            segment["offset"] = round(offset, 6)
            distance += segment["length"]

    features = []
    for segment in subway_segments:
        if (
            features
            and features[-1]["properties"]["owner"] == segment["owner"]
            and features[-1]["properties"]["part"] == segment["part"]
            and features[-1]["properties"]["offset"] == segment["offset"]
            and features[-1]["geometry"]["coordinates"][-1] == segment["start"]
        ):
            features[-1]["geometry"]["coordinates"].append(segment["end"])
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    **properties_by_owner[segment["owner"]],
                    "owner": segment["owner"],
                    "part": segment["part"],
                    "offset": segment["offset"],
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [segment["start"], segment["end"]],
                },
            }
        )

    return {"type": "FeatureCollection", "features": features}


def main():
    data_dir = Path(__file__).resolve().parent.parent / "public" / "data"
    subway = json.loads((data_dir / "subway_routes.geojson").read_text())
    bike = json.loads((data_dir / "bike_routes.geojson").read_text())
    protected_bike = {
        "type": "FeatureCollection",
        "features": [
            feature for feature in bike["features"] if feature["properties"]["facilitycl"] == "I"
        ],
    }
    output_path = data_dir / "subway_routes_offset.geojson"
    output_path.write_text(json.dumps(derive_subway_offsets(subway, protected_bike)))
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
