import unittest

from data.fetch_osm_roads import (
    BACKWARD,
    FORWARD,
    bike_lane_features,
    drawn_bike_lines,
    street_features,
    street_properties,
    travel_options,
)


def way(tags, coordinates):
    return {
        "type": "way",
        "tags": tags,
        "geometry": [{"lon": lon, "lat": lat} for lon, lat in coordinates],
    }


def midpoint(feature):
    coordinates = feature["geometry"]["coordinates"]
    return coordinates[len(coordinates) // 2]


class TravelOptionsTest(unittest.TestCase):
    def test_no_cycleway(self):
        self.assertEqual(travel_options({"highway": "residential"}), {})
        self.assertEqual(travel_options({"highway": "residential", "cycleway:both": "no"}), {})

    def test_a_cycleway_of_its_own_is_protected(self):
        self.assertEqual(
            travel_options({"highway": "cycleway"}),
            {FORWARD: "protected", BACKWARD: "protected"},
        )
        self.assertEqual(
            travel_options({"highway": "cycleway", "oneway": "yes"}), {FORWARD: "protected"}
        )

    def test_a_cycleway_follows_its_one_way_roadway(self):
        self.assertEqual(
            travel_options({"highway": "primary", "oneway": "yes", "cycleway:left": "track"}),
            {FORWARD: "protected"},
        )

    def test_a_two_way_roadway_carries_a_two_way_cycleway(self):
        self.assertEqual(
            travel_options({"highway": "residential", "cycleway:both": "lane"}),
            {FORWARD: "painted", BACKWARD: "painted"},
        )

    def test_an_explicit_cycleway_oneway_overrides_the_roadway(self):
        self.assertEqual(
            travel_options(
                {
                    "highway": "primary",
                    "oneway": "yes",
                    "cycleway:left": "track",
                    "cycleway:left:oneway": "no",
                }
            ),
            {FORWARD: "protected", BACKWARD: "protected"},
        )

    def test_a_contraflow_lane_runs_against_the_roadway(self):
        self.assertEqual(
            travel_options(
                {"highway": "residential", "oneway": "yes", "cycleway": "opposite_lane"}
            ),
            {BACKWARD: "painted"},
        )

    def test_two_cycleways_serving_one_direction_keep_the_better_class(self):
        self.assertEqual(
            travel_options(
                {
                    "highway": "residential",
                    "cycleway:left": "shared_lane",
                    "cycleway:right": "track",
                }
            ),
            {FORWARD: "protected", BACKWARD: "protected"},
        )

    def test_each_direction_keeps_its_own_class(self):
        self.assertEqual(
            travel_options(
                {
                    "highway": "primary",
                    "oneway": "yes",
                    "cycleway:right": "lane",
                    "cycleway:left": "track",
                    "cycleway:left:oneway": "-1",
                }
            ),
            {FORWARD: "painted", BACKWARD: "protected"},
        )


class StreetPropertiesTest(unittest.TestCase):
    def test_kinds_follow_the_basemap_schema(self):
        self.assertEqual(street_properties({"highway": "motorway"})["kind"], "highway")
        self.assertEqual(street_properties({"highway": "trunk"})["kind"], "major_road")
        self.assertEqual(street_properties({"highway": "residential"})["kind"], "minor_road")

    def test_a_way_the_map_draws_no_street_for(self):
        for highway in ("service", "footway", "path", "cycleway", "pedestrian", "living_street"):
            with self.subTest(highway=highway):
                self.assertIsNone(street_properties({"highway": highway}))

    def test_a_link_keeps_the_kind_of_the_road_it_serves(self):
        self.assertFalse(street_properties({"highway": "primary"})["is_link"])

        link = street_properties({"highway": "primary_link"})
        self.assertTrue(link["is_link"])
        self.assertEqual(link["kind"], "major_road")


class StreetFeaturesTest(unittest.TestCase):
    def test_a_one_way_street_runs_in_its_direction_of_travel(self):
        (against,) = street_features(
            [way({"highway": "residential", "oneway": "-1"}, [(0, 40.7), (0.01, 40.7)])]
        )
        self.assertEqual(against["geometry"]["coordinates"][0][0], 0.01)
        self.assertTrue(against["properties"]["oneway"])

    def test_a_two_way_street_joins_ways_digitized_either_way_round(self):
        street = {"highway": "residential", "name": "Both Ways Street"}
        features = street_features(
            [
                way(street, [(0, 40.7), (0.01, 40.7)]),
                # digitized towards the shared end, which a directed merge would not join
                way(street, [(0.02, 40.7), (0.01, 40.7)]),
            ]
        )
        self.assertEqual(len(features), 1)


class BikeLaneFeaturesTest(unittest.TestCase):
    def test_lines_that_meet_end_to_end_become_one_feature(self):
        cycleway = {"highway": "cycleway", "oneway": "yes"}
        features = bike_lane_features(
            [way(cycleway, [(0, 0), (1, 0)]), way(cycleway, [(1, 0), (2, 0)])]
        )
        self.assertEqual(len(features), 1)
        self.assertEqual(
            features[0]["geometry"]["coordinates"], [[0.0, 0.0], [1.0, 0.0], [2.0, 0.0]]
        )
        self.assertEqual(
            features[0]["properties"],
            {"role": "bike_lane", "class": "protected", "one_way": True},
        )

    def test_a_backward_way_is_reversed_into_the_direction_of_travel(self):
        features = bike_lane_features(
            [way({"highway": "cycleway", "oneway": "-1"}, [(0, 0), (1, 0)])]
        )
        self.assertEqual(features[0]["geometry"]["coordinates"], [[1.0, 0.0], [0.0, 0.0]])
        self.assertTrue(features[0]["properties"]["one_way"])

    def test_a_shared_lane_draws_nothing(self):
        self.assertEqual(
            drawn_bike_lines({"highway": "residential", "cycleway": "shared_lane"}), []
        )

    def test_a_road_built_differently_each_way_draws_two_lines_either_side(self):
        features = bike_lane_features(
            [
                way(
                    {
                        "highway": "primary",
                        "oneway": "yes",
                        "cycleway:right": "lane",
                        "cycleway:left": "track",
                        "cycleway:left:oneway": "-1",
                    },
                    [(0, 40.7), (0.01, 40.7)],
                )
            ]
        )
        self.assertEqual(len(features), 2)
        by_class = {feature["properties"]["class"]: feature for feature in features}
        self.assertEqual(sorted(by_class), ["painted", "protected"])
        painted, protected = by_class["painted"], by_class["protected"]

        # each line sits to the right of its own direction of travel, so on opposite sides
        self.assertLess(midpoint(painted)[1], 40.7)
        self.assertGreater(midpoint(protected)[1], 40.7)

        # each runs in its own direction of travel
        self.assertLess(
            painted["geometry"]["coordinates"][0][0], painted["geometry"]["coordinates"][-1][0]
        )
        self.assertGreater(
            protected["geometry"]["coordinates"][0][0], protected["geometry"]["coordinates"][-1][0]
        )


if __name__ == "__main__":
    unittest.main()
