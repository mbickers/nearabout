import itertools
import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import NamedTuple


class Point(NamedTuple):
    x: float
    y: float


@dataclass(frozen=True, kw_only=True)
class TrackPath:
    positions: Sequence[Point]
    trunk: str
    shapes: frozenset[str]


def _deduplicated_track_paths(track_paths: Sequence[TrackPath]) -> tuple[TrackPath, ...]:
    shapes_by_geometry_and_trunk: dict[tuple[tuple[Point, ...], str], set[str]] = {}
    for path in track_paths:
        key = (tuple(path.positions), path.trunk)
        shapes_by_geometry_and_trunk.setdefault(key, set()).update(path.shapes)
    return tuple(
        TrackPath(positions=positions, trunk=trunk, shapes=frozenset(shapes))
        for (positions, trunk), shapes in shapes_by_geometry_and_trunk.items()
    )


@dataclass(frozen=True, kw_only=True)
class TrackGraphEdge:
    geometry: tuple[Point, ...]
    trunks: frozenset[str]
    shapes_by_trunk: Mapping[str, frozenset[str]]
    endpoint_vertex_ids: tuple[int, int]


@dataclass(frozen=True, kw_only=True)
class TrackGraphVertex:
    position: Point
    trunks: frozenset[str]


@dataclass(frozen=True, kw_only=True)
class TrackGraph:
    edges: tuple[TrackGraphEdge, ...]
    vertices: tuple[TrackGraphVertex, ...]


class DirectedPoint(NamedTuple):
    position: Point
    heading_rad: float


def _normalize_heading(heading_rad: float) -> float:
    return heading_rad % math.pi


def _heading_difference(first_heading_rad: float, second_heading_rad: float) -> float:
    difference_rad = abs(
        _normalize_heading(first_heading_rad) - _normalize_heading(second_heading_rad)
    )
    return min(difference_rad, math.pi - difference_rad)


def _bucket(coordinate: float, *, bucket_size: float) -> int:
    return math.floor(coordinate / bucket_size)


def _ordered_vertex_ids(first_vertex_id: int, second_vertex_id: int) -> tuple[int, int]:
    return (
        (first_vertex_id, second_vertex_id)
        if first_vertex_id < second_vertex_id
        else (second_vertex_id, first_vertex_id)
    )


class NearbyParallelDirectedPointMap[ValueType]:
    def __init__(
        self,
        *,
        max_radius: float,
        max_heading_difference_rad: float,
        heading_weight_distance_per_rad: float,
    ):
        self._max_radius = max_radius
        self._max_heading_difference_rad = max_heading_difference_rad
        self._heading_weight_distance_per_rad = heading_weight_distance_per_rad
        self._heading_bucket_count = math.ceil(math.pi / max_heading_difference_rad)
        self._entries_by_bucket: dict[
            tuple[int, int, int], list[tuple[DirectedPoint, ValueType]]
        ] = {}

    def _canonical_key(self, point: DirectedPoint) -> tuple[int, int, int]:
        return (
            _bucket(point.position.x, bucket_size=self._max_radius),
            _bucket(point.position.y, bucket_size=self._max_radius),
            _bucket(
                _normalize_heading(point.heading_rad),
                bucket_size=self._max_heading_difference_rad,
            )
            % self._heading_bucket_count,
        )

    def _candidate_keys(self, point: DirectedPoint) -> list[tuple[int, int, int]]:
        x_bucket, y_bucket, heading_bucket = self._canonical_key(point)
        return [
            (
                x_bucket + x_offset,
                y_bucket + y_offset,
                (heading_bucket + heading_offset) % self._heading_bucket_count,
            )
            for x_offset, y_offset, heading_offset in itertools.product((-1, 0, 1), repeat=3)
        ]

    def get_nearest(self, point: DirectedPoint) -> ValueType | None:
        nearest_score_and_value: tuple[float, ValueType] | None = None
        for candidate_key in self._candidate_keys(point):
            for candidate_point, candidate_value in self._entries_by_bucket.get(candidate_key, ()):
                distance = math.dist(point.position, candidate_point.position)
                heading_difference_rad = _heading_difference(
                    point.heading_rad, candidate_point.heading_rad
                )
                if (
                    distance > self._max_radius
                    or heading_difference_rad > self._max_heading_difference_rad
                ):
                    continue
                score = distance + heading_difference_rad * self._heading_weight_distance_per_rad
                if nearest_score_and_value is None or score < nearest_score_and_value[0]:
                    nearest_score_and_value = (score, candidate_value)
        return None if nearest_score_and_value is None else nearest_score_and_value[1]

    def insert(self, point: DirectedPoint, value: ValueType) -> None:
        self._entries_by_bucket.setdefault(self._canonical_key(point), []).append((point, value))


def _interpolate_position(start: Point, end: Point, fraction: float) -> Point:
    return Point(
        x=start.x + (end.x - start.x) * fraction,
        y=start.y + (end.y - start.y) * fraction,
    )


def _sample_along_path(
    path: Sequence[Point],
    *,
    max_distance: float,
) -> list[Point]:
    sampled_positions = [path[0]]
    for start, end in itertools.pairwise(path):
        segment_count = max(1, math.ceil(math.dist(start, end) / max_distance))
        sampled_positions.extend(
            _interpolate_position(start, end, index / segment_count)
            for index in range(1, segment_count + 1)
        )
    return sampled_positions


def _directed_points(positions: list[Point]) -> list[DirectedPoint]:
    if len(positions) == 1:
        return [DirectedPoint(position=positions[0], heading_rad=0)]
    adjacent_position_pairs = list(itertools.pairwise(positions))
    centered_position_pairs = [
        adjacent_position_pairs[0],
        *(
            (previous[0], following[1])
            for previous, following in itertools.pairwise(adjacent_position_pairs)
        ),
        adjacent_position_pairs[-1],
    ]
    headings_rad = [
        math.atan2(end[1] - start[1], end[0] - start[0]) for start, end in centered_position_pairs
    ]
    return [
        DirectedPoint(position=position, heading_rad=headings_rad[index])
        for index, position in enumerate(positions)
    ]


def _compressed_edges(
    vertex_positions: list[Point],
    trunks_by_segment: dict[tuple[int, int], set[str]],
    shapes_by_segment: dict[tuple[int, int], set[tuple[str, str]]],
) -> tuple[TrackGraphEdge, ...]:
    incident_segments_by_vertex_id: dict[int, list[tuple[int, tuple[int, int]]]] = defaultdict(list)
    for segment in trunks_by_segment:
        first_vertex_id, second_vertex_id = segment
        incident_segments_by_vertex_id[first_vertex_id].append((second_vertex_id, segment))
        incident_segments_by_vertex_id[second_vertex_id].append((first_vertex_id, segment))

    boundary_vertex_ids = {
        vertex_id
        for vertex_id, incident_segments in incident_segments_by_vertex_id.items()
        if len(incident_segments) != 2
        or trunks_by_segment[incident_segments[0][1]] != trunks_by_segment[incident_segments[1][1]]
    }
    visited_segments: set[tuple[int, int]] = set()
    compressed_edges: list[TrackGraphEdge] = []

    def add_compressed_edge(
        start_vertex_id: int,
        neighboring_vertex_id: int,
        first_segment: tuple[int, int],
    ) -> None:
        trunks = frozenset(trunks_by_segment[first_segment])
        shapes = set(shapes_by_segment[first_segment])
        geometry = [vertex_positions[start_vertex_id]]
        previous_vertex_id = start_vertex_id
        current_vertex_id = neighboring_vertex_id
        visited_segments.add(first_segment)
        while True:
            geometry.append(vertex_positions[current_vertex_id])
            if current_vertex_id in boundary_vertex_ids or current_vertex_id == start_vertex_id:
                break
            next_vertex_id, next_segment = next(
                item
                for item in incident_segments_by_vertex_id[current_vertex_id]
                if item[0] != previous_vertex_id
            )
            visited_segments.add(next_segment)
            shapes |= shapes_by_segment[next_segment]
            previous_vertex_id = current_vertex_id
            current_vertex_id = next_vertex_id
        compressed_edges.append(
            TrackGraphEdge(
                geometry=tuple(geometry),
                trunks=trunks,
                shapes_by_trunk={
                    trunk: frozenset(shape for shape_trunk, shape in shapes if shape_trunk == trunk)
                    for trunk in trunks
                },
                endpoint_vertex_ids=(start_vertex_id, current_vertex_id),
            )
        )

    for start_vertex_id in sorted(boundary_vertex_ids):
        for neighboring_vertex_id, segment in incident_segments_by_vertex_id[start_vertex_id]:
            if segment in visited_segments:
                continue
            add_compressed_edge(start_vertex_id, neighboring_vertex_id, segment)

    for segment in trunks_by_segment.keys() - visited_segments:
        if segment not in visited_segments:
            add_compressed_edge(segment[0], segment[1], segment)
    return tuple(compressed_edges)


def _skipped_vertex_id(
    *,
    vertex_positions: Sequence[Point],
    neighboring_vertex_ids: dict[int, set[int]],
    from_vertex_id: int,
    to_vertex_id: int,
) -> int | None:
    if to_vertex_id in neighboring_vertex_ids[from_vertex_id]:
        return None
    shared_neighbor_ids = (
        neighboring_vertex_ids[from_vertex_id] & neighboring_vertex_ids[to_vertex_id]
    )
    if not shared_neighbor_ids:
        return None
    return min(
        shared_neighbor_ids,
        key=lambda vertex_id: (
            math.dist(vertex_positions[from_vertex_id], vertex_positions[vertex_id])
            + math.dist(vertex_positions[vertex_id], vertex_positions[to_vertex_id])
        ),
    )


def build_track_graph(
    *,
    track_paths: Sequence[TrackPath],
    bike_lane_paths: Sequence[Sequence[Point]] = (),
    merge_radius: float = 20,
    merge_heading_tolerance_rad: float = math.radians(5),
) -> TrackGraph:
    """Build a graph by merging nearby parallel track paths."""

    track_paths = _deduplicated_track_paths(track_paths)
    nearby_vertices = NearbyParallelDirectedPointMap[int](
        max_radius=merge_radius,
        max_heading_difference_rad=merge_heading_tolerance_rad,
        heading_weight_distance_per_rad=(merge_radius / merge_heading_tolerance_rad),
    )
    vertex_positions: list[Point] = []
    trunks_by_segment: dict[tuple[int, int], set[str]] = defaultdict(set)
    shapes_by_segment: dict[tuple[int, int], set[tuple[str, str]]] = defaultdict(set)
    neighboring_vertex_ids: dict[int, set[int]] = defaultdict(set)

    for track_path in track_paths:
        sampled_positions = _sample_along_path(
            track_path.positions,
            max_distance=merge_radius / 2,
        )
        shape_vertex_ids: list[int] = []
        for sampled_position, directed_point in zip(
            sampled_positions,
            _directed_points(sampled_positions),
            strict=True,
        ):
            vertex_id = nearby_vertices.get_nearest(directed_point)
            if vertex_id is None:
                vertex_id = len(vertex_positions)
                vertex_positions.append(sampled_position)
                nearby_vertices.insert(directed_point, vertex_id)
            if shape_vertex_ids and shape_vertex_ids[-1] == vertex_id:
                continue
            if shape_vertex_ids:
                skipped_vertex_id = _skipped_vertex_id(
                    vertex_positions=vertex_positions,
                    neighboring_vertex_ids=neighboring_vertex_ids,
                    from_vertex_id=shape_vertex_ids[-1],
                    to_vertex_id=vertex_id,
                )
                if skipped_vertex_id is not None:
                    shape_vertex_ids.append(skipped_vertex_id)
                neighboring_vertex_ids[shape_vertex_ids[-1]].add(vertex_id)
                neighboring_vertex_ids[vertex_id].add(shape_vertex_ids[-1])
            shape_vertex_ids.append(vertex_id)

        for first_vertex_id, second_vertex_id in itertools.pairwise(shape_vertex_ids):
            segment = _ordered_vertex_ids(first_vertex_id, second_vertex_id)
            trunks_by_segment[segment].add(track_path.trunk)
            shapes_by_segment[segment].update(
                (track_path.trunk, shape) for shape in track_path.shapes
            )

    compressed_edges = _compressed_edges(vertex_positions, trunks_by_segment, shapes_by_segment)
    trunks_by_vertex_id: dict[int, set[str]] = defaultdict(set)
    for edge in compressed_edges:
        for endpoint_vertex_id in edge.endpoint_vertex_ids:
            trunks_by_vertex_id[endpoint_vertex_id] |= edge.trunks
    graph_vertex_ids = {
        vertex_id: graph_vertex_id
        for graph_vertex_id, vertex_id in enumerate(sorted(trunks_by_vertex_id))
    }
    return TrackGraph(
        edges=tuple(
            replace(
                edge,
                endpoint_vertex_ids=(
                    graph_vertex_ids[edge.endpoint_vertex_ids[0]],
                    graph_vertex_ids[edge.endpoint_vertex_ids[1]],
                ),
            )
            for edge in compressed_edges
        ),
        vertices=tuple(
            TrackGraphVertex(position=vertex_positions[vertex_id], trunks=frozenset(trunks))
            for vertex_id, trunks in sorted(trunks_by_vertex_id.items())
        ),
    )
