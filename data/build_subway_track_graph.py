import json
import math
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter

from .gtfs_types import GtfsData, Position, read_gtfs
from .track_graph import Point, TrackPath, build_track_graph

EARTH_RADIUS_METERS = 6_371_008.8


@dataclass(frozen=True, kw_only=True)
class LocalProjection:
    reference_latitude_rad: float

    @classmethod
    def centered_on(cls, positions: Sequence[Position]) -> "LocalProjection":
        mean_latitude = sum(position.latitude for position in positions) / len(positions)
        return cls(reference_latitude_rad=math.radians(mean_latitude))

    def to_meters(self, position: Position) -> Point:
        return Point(
            x=EARTH_RADIUS_METERS
            * math.radians(position.longitude)
            * math.cos(self.reference_latitude_rad),
            y=EARTH_RADIUS_METERS * math.radians(position.latitude),
        )

    def to_position(self, position: Point) -> Position:
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
            shapes=frozenset({shape_id}),
        )
        for shape_id, trunk in sorted(unique_shape_ids_and_trunks)
    )
    return ProjectedTrackPaths(track_paths=track_paths, projection=projection)


def _protected_bike_lane_paths(
    *, roads_path: Path, projection: LocalProjection
) -> tuple[tuple[Point, ...], ...]:
    features = json.loads(roads_path.read_text())["features"]
    return tuple(
        tuple(
            projection.to_meters(Position(longitude=longitude, latitude=latitude))
            for longitude, latitude in feature["geometry"]["coordinates"]
        )
        for feature in features
        if feature["properties"]["role"] == "bike_lane"
        and feature["properties"]["class"] == "protected"
    )


def _trunk_names_by_color(gtfs: GtfsData) -> dict[str, str]:
    route_names_by_color: dict[str, set[str]] = {}
    for route in gtfs.routes.values():
        if route.color is not None:
            route_names_by_color.setdefault(route.color, set()).add(route.name)
    return {
        color: "/".join(sorted(route_names)) for color, route_names in route_names_by_color.items()
    }


def main() -> None:
    started_at = perf_counter()
    data_path = Path(__file__).resolve().parent
    gtfs_path = data_path / "gtfs"
    output_path = data_path.parent / "public" / "data" / "subway_track_graph.json"

    gtfs = read_gtfs(gtfs_path=gtfs_path).resolve_to_parent_stations()
    gtfs_loaded_at = perf_counter()
    trunk_names_by_color = _trunk_names_by_color(gtfs)
    projected_track_paths = _project_gtfs_track_paths(gtfs)
    tracks_projected_at = perf_counter()
    bike_lane_paths = _protected_bike_lane_paths(
        roads_path=data_path.parent / "public" / "data" / "osm_roads.geojson",
        projection=projected_track_paths.projection,
    )
    bike_lanes_loaded_at = perf_counter()
    graph = build_track_graph(
        track_paths=projected_track_paths.track_paths,
        bike_lane_paths=bike_lane_paths,
    )
    graph_built_at = perf_counter()

    def _to_longitude_latitude(position: Point) -> tuple[float, float]:
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
                        "trunks": sorted(trunk_names_by_color[trunk] for trunk in edge.trunks),
                        "shapes_by_trunk": {
                            trunk_names_by_color[trunk]: sorted(shapes)
                            for trunk, shapes in edge.shapes_by_trunk.items()
                        },
                    }
                    for edge_id, edge in enumerate(graph.edges)
                },
                "vertices": [
                    {
                        "position": _to_longitude_latitude(vertex.position),
                        # TODO: remove debug info
                        "trunks": sorted(trunk_names_by_color[trunk] for trunk in vertex.trunks),
                    }
                    for vertex in graph.vertices
                ],
            },
            separators=(",", ":"),
        )
    )
    output_written_at = perf_counter()
    print(f"Wrote {len(graph.vertices)} vertices and {len(graph.edges)} edges to {output_path}")
    print(
        f"GTFS {gtfs_loaded_at - started_at:.2f}s, "
        f"projection {tracks_projected_at - gtfs_loaded_at:.2f}s, "
        f"bike lanes {bike_lanes_loaded_at - tracks_projected_at:.2f}s, "
        f"graph {graph_built_at - bike_lanes_loaded_at:.2f}s, "
        f"output {output_written_at - graph_built_at:.2f}s, "
        f"total {output_written_at - started_at:.2f}s"
    )


if __name__ == "__main__":
    main()
