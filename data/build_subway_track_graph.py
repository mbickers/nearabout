import itertools
import json
import math
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import NamedTuple

from .gtfs_types import GtfsData, Position, read_gtfs


class PositionMeters(NamedTuple):
    x: float
    y: float


@dataclass(frozen=True, kw_only=True)
class TrackPath:
    positions: Sequence[PositionMeters]
    trunk: str


@dataclass(frozen=True, kw_only=True)
class TrackGraphEdge:
    geometry: tuple[PositionMeters, ...]
    trunks: frozenset[str]


@dataclass(frozen=True, kw_only=True)
class TrackGraphVertex:
    position: PositionMeters
    edge_ids: frozenset[int]


@dataclass(frozen=True, kw_only=True)
class TrackGraph:
    edges: tuple[TrackGraphEdge, ...]
    vertices: tuple[TrackGraphVertex, ...]


class DirectedPoint(NamedTuple):
    position: PositionMeters
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
        max_radius_meters: float,
        max_heading_difference_rad: float,
        heading_weight_meters_per_rad: float,
    ):
        self._max_radius_meters = max_radius_meters
        self._max_heading_difference_rad = max_heading_difference_rad
        self._heading_weight_meters_per_rad = heading_weight_meters_per_rad
        self._heading_bucket_count = math.ceil(math.pi / max_heading_difference_rad)
        self._entries_by_bucket: dict[
            tuple[int, int, int], list[tuple[DirectedPoint, ValueType]]
        ] = {}

    def _canonical_key(self, point: DirectedPoint) -> tuple[int, int, int]:
        return (
            _bucket(point.position.x, bucket_size=self._max_radius_meters),
            _bucket(point.position.y, bucket_size=self._max_radius_meters),
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
                distance_meters = math.dist(point.position, candidate_point.position)
                heading_difference_rad = _heading_difference(
                    point.heading_rad, candidate_point.heading_rad
                )
                if (
                    distance_meters > self._max_radius_meters
                    or heading_difference_rad > self._max_heading_difference_rad
                ):
                    continue
                score_meters = (
                    distance_meters + heading_difference_rad * self._heading_weight_meters_per_rad
                )
                if nearest_score_and_value is None or score_meters < nearest_score_and_value[0]:
                    nearest_score_and_value = (score_meters, candidate_value)
        return None if nearest_score_and_value is None else nearest_score_and_value[1]

    def insert(self, point: DirectedPoint, value: ValueType) -> None:
        self._entries_by_bucket.setdefault(self._canonical_key(point), []).append((point, value))


EARTH_RADIUS_METERS = 6_371_008.8


@dataclass(frozen=True, kw_only=True)
class LocalProjection:
    reference_latitude_rad: float

    @classmethod
    def centered_on(cls, positions: Sequence[Position]) -> "LocalProjection":
        mean_latitude = sum(position.latitude for position in positions) / len(positions)
        return cls(reference_latitude_rad=math.radians(mean_latitude))

    def to_meters(self, position: Position) -> PositionMeters:
        return PositionMeters(
            x=EARTH_RADIUS_METERS
            * math.radians(position.longitude)
            * math.cos(self.reference_latitude_rad),
            y=EARTH_RADIUS_METERS * math.radians(position.latitude),
        )

    def to_position(self, position: PositionMeters) -> Position:
        return Position(
            longitude=math.degrees(
                position.x / (EARTH_RADIUS_METERS * math.cos(self.reference_latitude_rad))
            ),
            latitude=math.degrees(position.y / EARTH_RADIUS_METERS),
        )


@dataclass(frozen=True, kw_only=True)
class ProjectedTrackPaths:
    track_paths: tuple[TrackPath, ...]
    projection: LocalProjection


def _project_gtfs_track_paths(gtfs: GtfsData) -> ProjectedTrackPaths:
    unique_shape_ids_and_trunks: set[tuple[str, str]] = set()
    for trip in gtfs.trips.values():
        trunk = gtfs.routes[trip.route_id].color
        if trunk is not None:
            unique_shape_ids_and_trunks.add((trip.shape_id, trunk))

    all_shape_positions = [
        position
        for shape_id, _ in unique_shape_ids_and_trunks
        for position in gtfs.shapes[shape_id].positions
    ]
    projection = LocalProjection.centered_on(all_shape_positions)
    track_paths = tuple(
        TrackPath(
            positions=tuple(
                projection.to_meters(position) for position in gtfs.shapes[shape_id].positions
            ),
            trunk=trunk,
        )
        for shape_id, trunk in sorted(unique_shape_ids_and_trunks)
    )
    return ProjectedTrackPaths(track_paths=track_paths, projection=projection)


def _interpolate_position(
    start: PositionMeters, end: PositionMeters, fraction: float
) -> PositionMeters:
    return PositionMeters(
        x=start.x + (end.x - start.x) * fraction,
        y=start.y + (end.y - start.y) * fraction,
    )


def _sample_along_path(
    path: Sequence[PositionMeters],
    *,
    max_distance_meters: float,
) -> list[PositionMeters]:
    sampled_positions = [path[0]]
    for start, end in itertools.pairwise(path):
        segment_count = max(
            1,
            math.ceil(math.dist(start, end) / max_distance_meters),
        )
        sampled_positions.extend(
            _interpolate_position(start, end, index / segment_count)
            for index in range(1, segment_count + 1)
        )
    return sampled_positions


def _directed_points(positions: list[PositionMeters]) -> list[DirectedPoint]:
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
    vertex_positions: list[PositionMeters],
    trunks_by_segment: dict[tuple[int, int], set[str]],
) -> tuple[tuple[TrackGraphEdge, ...], tuple[tuple[int, int], ...]]:
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
    compressed_edge_endpoints: list[tuple[int, int]] = []

    def add_compressed_edge(
        start_vertex_id: int,
        neighboring_vertex_id: int,
        first_segment: tuple[int, int],
    ) -> None:
        trunks = frozenset(trunks_by_segment[first_segment])
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
            previous_vertex_id = current_vertex_id
            current_vertex_id = next_vertex_id
        compressed_edges.append(TrackGraphEdge(geometry=tuple(geometry), trunks=trunks))
        compressed_edge_endpoints.append((start_vertex_id, current_vertex_id))

    for start_vertex_id in sorted(boundary_vertex_ids):
        for neighboring_vertex_id, segment in incident_segments_by_vertex_id[start_vertex_id]:
            if segment in visited_segments:
                continue
            add_compressed_edge(start_vertex_id, neighboring_vertex_id, segment)

    for segment in trunks_by_segment.keys() - visited_segments:
        if segment not in visited_segments:
            add_compressed_edge(segment[0], segment[1], segment)
    return tuple(compressed_edges), tuple(compressed_edge_endpoints)


def _skipped_vertex_id(
    *,
    vertex_positions: Sequence[PositionMeters],
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
    merge_radius_meters: float = 20,
    merge_heading_tolerance_rad: float = math.radians(5),
) -> TrackGraph:
    """Build a graph by merging nearby parallel track paths."""

    nearby_vertices = NearbyParallelDirectedPointMap[int](
        max_radius_meters=merge_radius_meters,
        max_heading_difference_rad=merge_heading_tolerance_rad,
        heading_weight_meters_per_rad=(merge_radius_meters / merge_heading_tolerance_rad),
    )
    vertex_positions: list[PositionMeters] = []
    trunks_by_segment: dict[tuple[int, int], set[str]] = defaultdict(set)
    neighboring_vertex_ids: dict[int, set[int]] = defaultdict(set)

    for track_path in track_paths:
        # Regular spacing makes nearby matching independent of GTFS point spacing.
        sampled_positions = _sample_along_path(
            track_path.positions,
            max_distance_meters=merge_radius_meters / 2,
        )
        shape_vertex_ids: list[int] = []
        for sampled_position, directed_point in zip(
            sampled_positions,
            _directed_points(sampled_positions),
            strict=True,
        ):
            # Reuse nearby parallel vertices to merge adjacent tracks.
            vertex_id = nearby_vertices.get_nearest(directed_point)
            if vertex_id is None:
                vertex_id = len(vertex_positions)
                vertex_positions.append(sampled_position)
                nearby_vertices.insert(directed_point, vertex_id)
            if shape_vertex_ids and shape_vertex_ids[-1] == vertex_id:
                continue
            if shape_vertex_ids:
                # Sample phase drifts between parallel paths, so a match can jump over one
                # vertex of an existing chain and leave a chord beside it.
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
            trunks_by_segment[_ordered_vertex_ids(first_vertex_id, second_vertex_id)].add(
                track_path.trunk
            )

    # Collapse degree-two runs between splits or trunk changes.
    compressed_edges, compressed_edge_endpoint_vertex_ids = _compressed_edges(
        vertex_positions, trunks_by_segment
    )
    incident_edge_ids_by_vertex_id: dict[int, set[int]] = defaultdict(set)
    for edge_id, endpoint_vertex_ids in enumerate(compressed_edge_endpoint_vertex_ids):
        for endpoint_vertex_id in endpoint_vertex_ids:
            incident_edge_ids_by_vertex_id[endpoint_vertex_id].add(edge_id)
    graph_vertices = tuple(
        TrackGraphVertex(position=vertex_positions[vertex_id], edge_ids=frozenset(edge_ids))
        for vertex_id, edge_ids in sorted(incident_edge_ids_by_vertex_id.items())
    )
    return TrackGraph(edges=compressed_edges, vertices=graph_vertices)


def main() -> None:
    data_path = Path(__file__).resolve().parent
    gtfs_path = data_path / "gtfs"
    output_path = data_path.parent / "public" / "data" / "subway_track_graph.json"

    gtfs = read_gtfs(gtfs_path=gtfs_path).resolve_to_parent_stations()
    projected_track_paths = _project_gtfs_track_paths(gtfs)
    graph = build_track_graph(track_paths=projected_track_paths.track_paths)

    def _to_longitude_latitude(position: PositionMeters) -> tuple[float, float]:
        longitude_latitude = projected_track_paths.projection.to_position(position)
        return (longitude_latitude.longitude, longitude_latitude.latitude)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(
            {
                "edges_by_id": {
                    edge_id: {
                        "geometry": [
                            _to_longitude_latitude(position) for position in edge.geometry
                        ],
                        "trunks": sorted(edge.trunks),
                    }
                    for edge_id, edge in enumerate(graph.edges)
                },
                "vertices": [
                    {
                        "position": _to_longitude_latitude(vertex.position),
                        "edge_ids": sorted(vertex.edge_ids),
                    }
                    for vertex in graph.vertices
                ],
            },
            separators=(",", ":"),
        )
    )
    print(f"Wrote {len(graph.vertices)} vertices and {len(graph.edges)} edges to {output_path}")


if __name__ == "__main__":
    main()
