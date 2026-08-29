from data.track_graph import Point, TrackPath, _deduplicated_track_paths, build_track_graph


def path(trunk, *positions, shape=None):
    return TrackPath(
        positions=[Point(x, y) for x, y in positions],
        trunk=trunk,
        shapes=frozenset({shape or f"{trunk} via {positions}"}),
    )


def test_identical_shape_geometries_become_one_track_path():
    positions = (Point(0, 0), Point(1, 1))
    track_paths = _deduplicated_track_paths(
        [
            TrackPath(positions=positions, trunk="blue", shapes=frozenset({"first"})),
            TrackPath(positions=positions, trunk="blue", shapes=frozenset({"second"})),
        ]
    )

    assert len(track_paths) == 1
    assert track_paths[0].shapes == frozenset({"first", "second"})


def test_one_path_becomes_one_edge():
    graph = build_track_graph(track_paths=[path("red", (0, 0), (1000, 0))])
    assert len(graph.vertices) == 2
    assert [sorted(edge.trunks) for edge in graph.edges] == [["red"]]
    assert [sorted(vertex.trunks) for vertex in graph.vertices] == [["red"], ["red"]]


def test_paths_within_the_merge_radius_become_one_edge():
    graph = build_track_graph(
        track_paths=[
            path("red", (0, 0), (1000, 0)),
            path("green", (0, 5), (1000, 5)),
        ]
    )
    assert [sorted(edge.trunks) for edge in graph.edges] == [["green", "red"]]


def test_paths_beyond_the_merge_radius_stay_separate():
    graph = build_track_graph(
        track_paths=[
            path("red", (0, 0), (1000, 0)),
            path("green", (0, 200), (1000, 200)),
        ]
    )
    assert [sorted(edge.trunks) for edge in graph.edges] == [["red"], ["green"]]


def test_crossing_paths_do_not_merge():
    graph = build_track_graph(
        track_paths=[
            path("red", (-500, 0), (500, 0)),
            path("green", (0, -500), (0, 500)),
        ]
    )
    assert len(graph.edges) == 2
    assert len(graph.vertices) == 4


def test_converging_paths_leave_no_chord_beside_the_merged_chain():
    graph = build_track_graph(
        track_paths=[
            path("red", (0, 0), (400, 0)),
            path("green", (0, 18), (400, 0)),
        ]
    )
    endpoint_pairs = [tuple(sorted(edge.endpoint_vertex_ids)) for edge in graph.edges]
    assert len(set(endpoint_pairs)) == len(endpoint_pairs)


def test_a_split_gives_one_edge_for_the_stem_and_one_for_each_branch():
    graph = build_track_graph(
        track_paths=[
            path("red", (-1000, 0), (0, 0), (400, 300)),
            path("green", (-1000, 0), (0, 0), (400, -300)),
        ]
    )
    assert sorted(sorted(edge.trunks) for edge in graph.edges) == [
        ["green"],
        ["green", "red"],
        ["red"],
    ]


def test_an_edge_records_the_shapes_that_contributed_each_trunk():
    graph = build_track_graph(
        track_paths=[
            path("red", (-1000, 0), (0, 0), (400, 300), shape="up"),
            path("red", (-1000, 0), (0, 0), (400, -300), shape="down"),
        ]
    )
    assert sorted(sorted(edge.shapes_by_trunk["red"]) for edge in graph.edges) == [
        ["down"],
        ["down", "up"],
        ["up"],
    ]


def test_bike_lane_paths_do_not_affect_the_graph():
    tracks = [path("red", (0, 0), (1000, 0))]
    without_bike_lane = build_track_graph(track_paths=tracks)
    with_bike_lane = build_track_graph(
        track_paths=tracks,
        bike_lane_paths=[(Point(0, 5), Point(1000, 5))],
    )
    assert with_bike_lane == without_bike_lane
