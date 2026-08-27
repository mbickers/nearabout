from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import NamedTuple

import polars as pl


class Position(NamedTuple):
    longitude: float
    latitude: float


# A route corresponds to a named MTA service such as the 1 or D.
@dataclass(frozen=True, kw_only=True)
class Route:
    name: str
    color: str | None


@dataclass(frozen=True, kw_only=True)
class Station:
    stop_name: str
    position: Position
    # The MTA uses distinct stops for each direction, and a parent station that includes both
    # directions (the GTFS data contains platform specific transfer times).
    parent_station_id: str


# A shape is the geometry a train follows
@dataclass(frozen=True, kw_only=True)
class Shape:
    positions: Sequence[Position]


# A trip is a single run of a vehicle at a particular time.
@dataclass(frozen=True, kw_only=True)
class Trip:
    route_id: str
    shape_id: str
    station_ids: Sequence[str]


@dataclass(frozen=True, kw_only=True)
class GtfsData:
    routes: Mapping[str, Route]
    stations: Mapping[str, Station]
    shapes: Mapping[str, Shape]
    trips: Mapping[str, Trip]

    def resolve_to_parent_stations(self) -> GtfsData:
        parent_station_ids = {station.parent_station_id for station in self.stations.values()}
        parent_stations = {
            station_id: self.stations[station_id] for station_id in parent_station_ids
        }
        trips = {}
        for trip_id, trip in self.trips.items():
            station_ids: list[str] = []
            for station_id in trip.station_ids:
                parent_station_id = self.stations[station_id].parent_station_id
                if not station_ids or station_ids[-1] != parent_station_id:
                    station_ids.append(parent_station_id)
            trips[trip_id] = replace(trip, station_ids=tuple(station_ids))

        return GtfsData(
            routes=self.routes,
            stations=parent_stations,
            shapes=self.shapes,
            trips=trips,
        )


def read_gtfs(*, gtfs_path: Path) -> GtfsData:
    route_rows = pl.read_csv(
        gtfs_path / "routes.txt",
        columns=["route_id", "route_color", "route_short_name"],
        schema_overrides={
            "route_id": pl.String,
            "route_color": pl.String,
            "route_short_name": pl.String,
        },
    ).select(["route_id", "route_color", "route_short_name"])
    stop_rows = pl.read_csv(
        gtfs_path / "stops.txt",
        columns=["stop_id", "stop_name", "parent_station", "stop_lon", "stop_lat"],
        schema_overrides={
            "stop_id": pl.String,
            "stop_name": pl.String,
            "parent_station": pl.String,
            "stop_lon": pl.Float64,
            "stop_lat": pl.Float64,
        },
    ).select(["stop_id", "stop_name", "parent_station", "stop_lon", "stop_lat"])
    shape_point_rows = pl.read_csv(
        gtfs_path / "shapes.txt",
        columns=["shape_id", "shape_pt_lon", "shape_pt_lat", "shape_pt_sequence"],
        schema_overrides={
            "shape_id": pl.String,
            "shape_pt_lon": pl.Float64,
            "shape_pt_lat": pl.Float64,
            "shape_pt_sequence": pl.Int64,
        },
    ).select(["shape_id", "shape_pt_lon", "shape_pt_lat", "shape_pt_sequence"])
    trip_stop_rows = pl.read_csv(
        gtfs_path / "stop_times.txt",
        columns=["trip_id", "stop_id", "stop_sequence"],
        schema_overrides={
            "trip_id": pl.String,
            "stop_id": pl.String,
            "stop_sequence": pl.Int64,
        },
    ).select(["trip_id", "stop_id", "stop_sequence"])
    trip_rows = pl.read_csv(
        gtfs_path / "trips.txt",
        columns=["trip_id", "route_id", "shape_id"],
        schema_overrides={"trip_id": pl.String, "route_id": pl.String, "shape_id": pl.String},
    ).select(["trip_id", "route_id", "shape_id"])

    routes = {
        route_id: Route(name=name or route_id, color=f"#{color}" if color else None)
        for route_id, color, name in route_rows.iter_rows()
    }
    stations = {
        stop_id: Station(
            stop_name=stop_name,
            position=Position(longitude=longitude, latitude=latitude),
            parent_station_id=parent_station_id or stop_id,
        )
        for stop_id, stop_name, parent_station_id, longitude, latitude in stop_rows.iter_rows()
    }

    positions_by_shape: dict[str, list[Position]] = {}
    for shape_id, longitude, latitude, _ in shape_point_rows.sort(
        ["shape_id", "shape_pt_sequence"]
    ).iter_rows():
        positions_by_shape.setdefault(shape_id, []).append(
            Position(longitude=longitude, latitude=latitude)
        )
    shapes = {
        shape_id: Shape(positions=tuple(positions))
        for shape_id, positions in positions_by_shape.items()
    }

    station_ids_by_trip: dict[str, list[str]] = {}
    for trip_id, stop_id, _ in trip_stop_rows.sort(["trip_id", "stop_sequence"]).iter_rows():
        station_ids_by_trip.setdefault(trip_id, []).append(stop_id)
    trips = {
        trip_id: Trip(
            route_id=route_id,
            shape_id=shape_id,
            station_ids=tuple(station_ids_by_trip[trip_id]),
        )
        for trip_id, route_id, shape_id in trip_rows.iter_rows()
    }

    return GtfsData(routes=routes, stations=stations, shapes=shapes, trips=trips)
