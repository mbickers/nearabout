#!/usr/bin/env -S uv run

import urllib.request
from pathlib import Path


def main():
    # The two columns the map reads from the NYC DOT bike routes dataset:
    #
    # - bikedir: R and L for one-way along and against the digitized geometry, 2 for two-way
    # - facilitycl: the DOT class, of which I is a physically protected path
    output_path = Path(__file__).resolve().parent.parent / "public" / "data" / "bike_routes.geojson"
    url = (
        "https://data.cityofnewyork.us/resource/mzxg-pwib.geojson"
        "?$limit=50000"  # Socrata pages at 1000 rows by default
        "&$where=status='Current'"  # only the bike lanes that are on the street today
        "&$select=the_geom,bikedir,facilitycl"
    )
    print(f"Fetching {url}", flush=True)
    with urllib.request.urlopen(url, timeout=120) as response:
        body = response.read()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(body)


if __name__ == "__main__":
    main()
