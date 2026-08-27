#!/usr/bin/env -S uv run

from pathlib import Path

import shapely

from data.osm import overpass_elements, write_feature_collection

# OSM cycleway values the map draws a line for, mapped to the class it draws them in. A value
# prefixed "opposite_" additionally means the facility runs against the roadway's one-way
# direction. The shared values are absent: a shared lane is only a marking on a traffic lane.
CYCLEWAY_CLASSES = {
    "track": "protected",
    "opposite_track": "protected",
    "lane": "painted",
    "opposite_lane": "painted",
}

# weakest to strongest, so that two cycleways serving one direction style as the better one
CLASS_STRENGTH = ("painted", "protected")

# the tags that place a facility alongside a roadway, rather than on a way of its own
ROADWAY_CYCLEWAY_KEYS = ("cycleway", "cycleway:both", "cycleway:left", "cycleway:right")

# OSM highway values the map draws as streets, each mapped to the Protomaps `kind` the cloned
# street layers filter on and the `min_zoom` their label layers pass to `symbol-sort-key`, which
# places a more important street's name first when two labels collide.
STREET_KINDS = {
    "motorway": ("highway", 6),
    "trunk": ("major_road", 8),
    "primary": ("major_road", 10),
    "secondary": ("major_road", 11),
    "tertiary": ("major_road", 12),
    "unclassified": ("minor_road", 14),
    "residential": ("minor_road", 14),
}

FORWARD, BACKWARD = "forward", "backward"
BOTH_WAYS = frozenset({FORWARD, BACKWARD})


def oneway_directions(value):
    """Directions a `oneway`-style tag value permits, or None when the tag is absent or unknown."""
    return {"yes": frozenset({FORWARD}), "-1": frozenset({BACKWARD}), "no": BOTH_WAYS}.get(value)


def roadway_directions(tags):
    directions = oneway_directions(tags.get("oneway"))
    return BOTH_WAYS if directions is None else directions


def cycleway_directions(*, tags, key, value):
    """Directions a roadway's cycleway serves, relative to the way's digitized geometry."""
    explicit = oneway_directions(tags.get(f"{key}:oneway"))
    if explicit is not None:
        return explicit
    roadway = roadway_directions(tags)
    if value.startswith("opposite"):
        # contraflow runs against the roadway; against a two-way roadway it means nothing
        return BOTH_WAYS - roadway or BOTH_WAYS
    if oneway_directions(tags.get("oneway:bicycle")) == BOTH_WAYS:
        return BOTH_WAYS
    return roadway


def cycleways(tags):
    """Each cycleway on a way, as its class and the directions of travel it serves."""
    if tags.get("highway") == "cycleway":
        # a cycleway mapped as its own way is physically separate from any roadway
        yield "protected", roadway_directions(tags)
    for key in ROADWAY_CYCLEWAY_KEYS:
        value = tags.get(key)
        if value in CYCLEWAY_CLASSES:
            yield CYCLEWAY_CLASSES[value], cycleway_directions(tags=tags, key=key, value=value)


def travel_options(tags):
    """The best class a cyclist has in each direction of travel, keyed by direction.

    A direction reachable by no cycleway is absent. Which side of the road the cycleway sits on
    does not appear: two lanes serving the same direction are one option, at the better class.
    """
    best: dict[str, str] = {}
    for facility_class, directions in cycleways(tags):
        for direction in directions:
            best[direction] = max(
                facility_class, best.get(direction, facility_class), key=CLASS_STRENGTH.index
            )
    return best


# Half the gap opened between the two lines drawn where a road's directions differ in class, so a
# thick protected line and a thin painted one can be read side by side. In meters, so the pair
# coincides at the zooms where the road is a hairline and separates as the road is zoomed into.
MIXED_CLASS_OFFSET_METERS = 3.0

# meters per degree at NYC's latitude, for offsetting in a frame where the two axes share a scale
METERS_PER_DEGREE_LATITUDE = 110_540
METERS_PER_DEGREE_LONGITUDE = 84_200


def offset_line(coordinates, meters):
    """Shift a line sideways by a constant distance, positive to the left of travel."""
    line = shapely.LineString(
        [(x * METERS_PER_DEGREE_LONGITUDE, y * METERS_PER_DEGREE_LATITUDE) for x, y in coordinates]
    )
    # a mitred join carries the shift around a corner without rounding it off
    return [
        [x / METERS_PER_DEGREE_LONGITUDE, y / METERS_PER_DEGREE_LATITUDE]
        for x, y in shapely.offset_curve(line, meters, join_style="mitre").coords
    ]


def merged_lines(coordinate_lists, *, directed):
    """Join lines that meet end to end, so a name or a caret runs the length of a route.

    Directed merging leaves every line pointing the way it was given, which the one-way carets and
    the bike lanes depend on; a two-way street is merged either way round to join as much of its
    length as possible. Merging joins only where exactly two ends meet, so a route stays split
    where a third line of the same kind touches it.
    """
    merged = shapely.line_merge(shapely.MultiLineString(coordinate_lists), directed=directed)
    return [[list(point) for point in part.coords] for part in shapely.get_parts(merged)]


def street_properties(tags):
    """A street's styling properties, or None where the map draws no street for the way."""
    highway = tags["highway"]
    base = highway.removesuffix("_link")
    if base not in STREET_KINDS:
        return None

    kind, min_zoom = STREET_KINDS[base]
    properties = {
        "role": "street",
        "kind": kind,
        "min_zoom": min_zoom,
        "is_link": highway != base,
    }
    if "name" in tags:
        properties["name"] = tags["name"]
    return properties


def street_features(elements):
    """One line per contiguous run of street sharing every styling property.

    A one-way street is emitted in its direction of travel, so the caret layer needs no per-feature
    rotation.
    """
    lines_by_style: dict[tuple, list] = {}
    for element in elements:
        properties = street_properties(element["tags"])
        if properties is None:
            continue

        directions = roadway_directions(element["tags"])
        properties["oneway"] = directions != BOTH_WAYS

        coordinates = [[point["lon"], point["lat"]] for point in element["geometry"]]
        if directions == frozenset({BACKWARD}):
            coordinates.reverse()
        lines_by_style.setdefault(tuple(sorted(properties.items())), []).append(coordinates)

    return [
        {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coordinates},
            "properties": dict(style),
        }
        for style, lines in sorted(lines_by_style.items())
        for coordinates in merged_lines(lines, directed=dict(style)["oneway"])
    ]


def drawn_bike_lines(tags):
    """The bike lines to draw for a way: each one's class, the direction it serves, and its offset.

    A direction is None where one line serves both. Where the two directions offer different
    classes the road gets a line each, one to the right of each direction of travel and so on
    opposite sides of the road; every uniform road stays a single line on the road.
    """
    drawn = travel_options(tags)
    if len(set(drawn.values())) > 1:
        return [(drawn[direction], direction, -MIXED_CLASS_OFFSET_METERS) for direction in drawn]
    if len(drawn) == 2:
        return [(drawn[FORWARD], None, 0.0)]
    return [(facility_class, direction, 0.0) for direction, facility_class in drawn.items()]


def bike_lane_features(elements):
    """One feature per contiguous run of cycleway sharing a class and a direction of travel.

    A one-way feature's geometry is emitted in the direction of travel, so the style can place
    direction carets without consulting a per-feature orientation.
    """
    lines_by_style: dict[tuple[str, bool, float], list] = {}
    for element in elements:
        for facility_class, direction, offset in drawn_bike_lines(element["tags"]):
            coordinates = [[point["lon"], point["lat"]] for point in element["geometry"]]
            if direction == BACKWARD:
                coordinates.reverse()

            style = (facility_class, direction is not None, offset)
            lines_by_style.setdefault(style, []).append(coordinates)

    return [
        {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": offset_line(coordinates, offset) if offset else coordinates,
            },
            "properties": {"role": "bike_lane", "class": facility_class, "one_way": one_way},
        }
        for (facility_class, one_way, offset), lines in sorted(lines_by_style.items())
        for coordinates in merged_lines(lines, directed=True)
    ]


def road_query():
    """Every way the map draws a street or a bike lane for, in one request.

    A street carrying a bike lane matches more than one filter and Overpass still returns it once,
    so both roles are derived from the same geometry and cannot disagree.
    """
    street_pattern = f"^({'|'.join(STREET_KINDS)})(_link)?$"
    roadway_cycleways = "\n  ".join(f'way["highway"]["{key}"];' for key in ROADWAY_CYCLEWAY_KEYS)
    return f"""(
  way["highway"~"{street_pattern}"];
  {roadway_cycleways}
  way["highway"="cycleway"];
);
out geom;"""


def main():
    elements = overpass_elements(road_query())
    write_feature_collection(
        output_path=Path(__file__).resolve().parent.parent
        / "public"
        / "data"
        / "osm_roads.geojson",
        features=street_features(elements) + bike_lane_features(elements),
    )


if __name__ == "__main__":
    main()
