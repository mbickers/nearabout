#!/usr/bin/env -S uv run

import io
import urllib.request
import zipfile
from pathlib import Path


def main() -> None:
    gtfs_path = Path(__file__).resolve().parent / "gtfs"
    url = "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip"
    print(f"Fetching {url}", flush=True)
    with urllib.request.urlopen(url, timeout=300) as response:
        archive_bytes = response.read()

    gtfs_path.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        archive.extractall(gtfs_path)
    print(f"Wrote {gtfs_path}")


if __name__ == "__main__":
    main()
