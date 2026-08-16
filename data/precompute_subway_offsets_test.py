#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.11"
# dependencies = ["shapely"]
# ///

import math
import unittest
from itertools import pairwise

from precompute_subway_offsets import (
    derive_station_marker_offsets,
    derive_subway_offsets,
)


def collection(lines):
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": identifier, "color": identifier},
                "geometry": {"type": "LineString", "coordinates": coordinates},
            }
            for identifier, coordinates in lines
        ],
    }


class DeriveSubwayOffsetsTest(unittest.TestCase):
    def test_station_marker_averages_line_offset_vectors(self):
        stations = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-74, 40.7]},
                    "properties": {
                        "station_name": "Station",
                        "color": "A",
                        "label": "Station",
                        "offset_regular": [12, 0],
                    },
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-74, 40.7]},
                    "properties": {
                        "station_name": "Station",
                        "color": "B",
                        "offset_regular": [36, 0],
                    },
                },
            ],
        }
        subway_offsets = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[-74, 40.699], [-74, 40.701]],
                    },
                    "properties": {"color": "A", "offset": 1},
                },
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[-74, 40.699], [-74, 40.701]],
                    },
                    "properties": {"color": "B", "offset": 3},
                },
            ],
        }

        marker = derive_station_marker_offsets(stations, subway_offsets)["features"][0]

        self.assertEqual(marker["properties"]["marker_offset_regular_11"], [4, 0])
        self.assertEqual(marker["properties"]["marker_offset_regular_14"], [10, 0])

    def test_station_marker_uses_only_routes_serving_during_period(self):
        stations = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-74, 40.7]},
                    "properties": {
                        "station_name": "Station",
                        "color": "A",
                        "label": "Station",
                        "offset_regular": [12, 0],
                    },
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-74, 40.7]},
                    "properties": {
                        "station_name": "Station",
                        "color": "B",
                        "offset_weekend": [12, 0],
                    },
                },
            ],
        }
        subway_offsets = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[-74, 40.699], [-74, 40.701]],
                    },
                    "properties": {"color": "A", "offset": 1},
                },
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[-74.001, 40.7], [-73.999, 40.7]],
                    },
                    "properties": {"color": "B", "offset": 1},
                },
            ],
        }

        marker = derive_station_marker_offsets(stations, subway_offsets)["features"][0]

        self.assertEqual(marker["properties"]["marker_offset_regular_11"], [2, 0])
        self.assertEqual(marker["properties"]["marker_offset_weekend_11"], [0, 2])

    def test_western_manhattan_trunk_keeps_priority(self):
        result = derive_subway_offsets(
            collection(
                [
                    ("east", [[-73.9999, 40.7], [-73.9999, 40.705]]),
                    ("west", [[-74, 40.7], [-74, 40.705]]),
                ]
            ),
            collection([]),
        )
        offsets = {}
        for feature in result["features"]:
            offsets.setdefault(feature["properties"]["owner"], set()).add(
                feature["properties"]["offset"]
            )

        self.assertEqual(offsets["west"], {0})
        self.assertEqual(offsets["east"], {1})

    def test_declared_trunk_order_overrides_geography(self):
        result = derive_subway_offsets(
            collection(
                [
                    ("#8E5C33", [[-74, 40.7], [-74, 40.705]]),
                    ("#EB6800", [[-73.9999, 40.7], [-73.9999, 40.705]]),
                ]
            ),
            collection([]),
        )
        offsets = {}
        for feature in result["features"]:
            offsets.setdefault(feature["properties"]["owner"], set()).add(
                feature["properties"]["offset"]
            )

        self.assertEqual(offsets["#EB6800"], {0})
        self.assertEqual(offsets["#8E5C33"], {1})

    def test_near_duplicate_same_owner_paths_are_normalized(self):
        result = derive_subway_offsets(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"color": "A"},
                        "geometry": {
                            "type": "MultiLineString",
                            "coordinates": [
                                [[-74, 40.7], [-74, 40.705]],
                                [[-73.999995, 40.7], [-73.999995, 40.705]],
                            ],
                        },
                    }
                ],
            },
            collection([]),
        )

        self.assertEqual(len(result["features"]), 1)

    def test_near_duplicate_curves_do_not_create_cross_segments(self):
        result = derive_subway_offsets(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"color": "A"},
                        "geometry": {
                            "type": "MultiLineString",
                            "coordinates": [
                                [
                                    [-74, 40.7],
                                    [-73.99999, 40.70004],
                                    [-73.99997, 40.70008],
                                    [-73.99994, 40.70012],
                                ],
                                [
                                    [-74, 40.7],
                                    [-73.999986, 40.70004],
                                    [-73.999966, 40.70008],
                                    [-73.99994, 40.70012],
                                ],
                            ],
                        },
                    }
                ],
            },
            collection([]),
        )
        coordinates = result["features"][0]["geometry"]["coordinates"]
        segment_lengths = [
            math.hypot(
                (second[0] - first[0])
                * 111_320
                * math.cos(math.radians((first[1] + second[1]) / 2)),
                (second[1] - first[1]) * 110_540,
            )
            for first, second in pairwise(coordinates)
        ]

        self.assertGreater(min(segment_lengths), 1)

    def test_same_owner_path_covered_by_longer_path_is_removed(self):
        result = derive_subway_offsets(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"color": "A"},
                        "geometry": {
                            "type": "MultiLineString",
                            "coordinates": [
                                [
                                    [-74, 40.7],
                                    [-73.9998, 40.7002],
                                    [-73.9996, 40.700401],
                                ],
                                [[-74, 40.7], [-73.9996, 40.7004]],
                            ],
                        },
                    }
                ],
            },
            collection([]),
        )

        self.assertEqual(len(result["features"]), 1)
        coordinates = result["features"][0]["geometry"]["coordinates"]
        self.assertNotEqual(coordinates[0], coordinates[-1])

    def test_out_and_back_path_is_reduced_to_one_leg(self):
        result = derive_subway_offsets(
            collection(
                [
                    (
                        "A",
                        [
                            [-74, 40.7],
                            [-73.9998, 40.7002],
                            [-73.9996, 40.7004],
                            [-74, 40.7],
                        ],
                    )
                ]
            ),
            collection([]),
        )

        self.assertEqual(len(result["features"]), 1)
        coordinates = result["features"][0]["geometry"]["coordinates"]
        self.assertNotEqual(coordinates[0], coordinates[-1])

    def test_protected_bike_lane_adds_one_slot(self):
        result = derive_subway_offsets(
            collection([("A", [[-74, 40.7], [-73.995, 40.7]])]),
            collection([("bike", [[-74, 40.70005], [-73.995, 40.70005]])]),
        )

        self.assertEqual({feature["properties"]["offset"] for feature in result["features"]}, {1})

    def test_direction_is_normalized(self):
        forward = derive_subway_offsets(
            collection([("A", [[-74, 40.7], [-73.995, 40.7]])]),
            collection([("bike", [[-74, 40.70005], [-73.995, 40.70005]])]),
        )
        reversed_result = derive_subway_offsets(
            collection([("A", [[-73.995, 40.7], [-74, 40.7]])]),
            collection([("bike", [[-73.995, 40.70005], [-74, 40.70005]])]),
        )

        self.assertEqual(reversed_result, forward)

    def test_direction_follows_dominant_axis(self):
        result = derive_subway_offsets(
            collection([("A", [[-73.999, 40.7], [-74, 40.705]])]), collection([])
        )

        coordinates = result["features"][0]["geometry"]["coordinates"]
        self.assertLess(coordinates[0][1], coordinates[-1][1])

    def test_direction_is_anchored_to_manhattan_trunk(self):
        result = derive_subway_offsets(
            collection(
                [
                    (
                        "A",
                        [
                            [-73.985, 40.76],
                            [-74, 40.7],
                            [-73.85, 40.69],
                        ],
                    )
                ]
            ),
            collection([]),
        )
        manhattan_coordinates = [
            coordinate
            for feature in result["features"]
            for coordinate in feature["geometry"]["coordinates"]
            if -74.03 <= coordinate[0] <= -73.96
        ]

        self.assertLess(manhattan_coordinates[0][1], manhattan_coordinates[-1][1])

    def test_offsets_converge_at_branch_junctions(self):
        junction = [-74, 40.702]
        result = derive_subway_offsets(
            collection(
                [
                    ("A", [[-74, 40.7], junction]),
                    ("A", [junction, [-74.0002, 40.704]]),
                    ("A", [junction, [-73.9998, 40.704]]),
                ]
            ),
            collection([("bike", [[-73.99995, 40.7], [-73.99995, 40.704]])]),
        )
        junction_features = [
            feature
            for feature in result["features"]
            if junction
            in (
                feature["geometry"]["coordinates"][0],
                feature["geometry"]["coordinates"][-1],
            )
        ]

        self.assertEqual(len(junction_features), 3)
        self.assertTrue(all(feature["properties"]["offset"] == 0 for feature in junction_features))

    def test_crossing_is_not_offset(self):
        result = derive_subway_offsets(
            collection(
                [
                    ("A", [[-74, 40.7], [-73.995, 40.7]]),
                    ("B", [[-73.9975, 40.698], [-73.9975, 40.702]]),
                ]
            ),
            collection([]),
        )

        self.assertTrue(all(feature["properties"]["offset"] == 0 for feature in result["features"]))

    def test_smoothing_creates_gradual_offsets(self):
        result = derive_subway_offsets(
            collection([("A", [[-74, 40.7], [-73.994, 40.7]])]),
            collection([("bike", [[-73.998, 40.70005], [-73.996, 40.70005]])]),
        )
        offsets = [feature["properties"]["offset"] for feature in result["features"]]

        self.assertTrue(any(0 < offset < 1 for offset in offsets))
        self.assertLessEqual(max(abs(second - first) for first, second in pairwise(offsets)), 0.2)

    def test_smoothing_bridges_short_gaps_in_a_parallel_corridor(self):
        result = derive_subway_offsets(
            collection([("A", [[-74, 40.7], [-73.99, 40.7]])]),
            collection(
                [
                    ("bike1", [[-73.999, 40.70005], [-73.996, 40.70005]]),
                    ("bike2", [[-73.995, 40.70005], [-73.992, 40.70005]]),
                ]
            ),
        )
        corridor_features = [
            feature
            for feature in result["features"]
            if feature["geometry"]["coordinates"][-1][0] >= -73.998
            and feature["geometry"]["coordinates"][0][0] <= -73.993
        ]

        self.assertTrue(corridor_features)
        self.assertTrue(all(feature["properties"]["offset"] > 0 for feature in corridor_features))

    def test_equal_offsets_are_recombined(self):
        result = derive_subway_offsets(
            collection([("A", [[-74, 40.7], [-73.995, 40.7]])]), collection([])
        )

        self.assertEqual(len(result["features"]), 1)


if __name__ == "__main__":
    unittest.main()
