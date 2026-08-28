import json
import math
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

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
            shape=shape_id,
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


def main() -> None:
    data_path = Path(__file__).resolve().parent
    gtfs_path = data_path / "gtfs"
    output_path = data_path.parent / "public" / "data" / "subway_track_graph.json"

    gtfs = read_gtfs(gtfs_path=gtfs_path).resolve_to_parent_stations()
    projected_track_paths = _project_gtfs_track_paths(gtfs)
    graph = build_track_graph(
        track_paths=projected_track_paths.track_paths,
        bike_lane_paths=_protected_bike_lane_paths(
            roads_path=data_path.parent / "public" / "data" / "osm_roads.geojson",
            projection=projected_track_paths.projection,
        ),
    )

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
                        "trunks": sorted(edge.trunks),
                        "shapes_by_trunk": {
                            trunk: sorted(shapes) for trunk, shapes in edge.shapes_by_trunk.items()
                        },
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
