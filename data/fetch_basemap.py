#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

import argparse
import json
import subprocess
import urllib.request
from pathlib import Path


def latest_build_key():
    request = urllib.request.Request(
        "https://build-metadata.protomaps.dev/builds.json",
        headers={"User-Agent": "nearabout"},  # the metadata host 403s urllib's default
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        builds = json.load(response)
    return max(builds, key=lambda build: build["uploaded"])["key"]


def main():
    nyc_bbox = "-74.30,40.47,-73.68,40.93"
    output_path = Path(__file__).resolve().parent.parent / "public" / "data" / "nyc.pmtiles"
    parser = argparse.ArgumentParser(
        description="Extract a NYC-clipped Protomaps basemap to public/data/nyc.pmtiles."
    )
    parser.add_argument(
        "--build", help="daily build to extract, e.g. 20260814 (default: the latest)"
    )
    parser.add_argument(
        "--maxzoom",
        type=int,
        help="clamp the extract to this zoom (default: the archive's full depth)",
    )
    args = parser.parse_args()

    key = f"{args.build}.pmtiles" if args.build else latest_build_key()
    source_url = f"https://build.protomaps.com/{key}"

    output_path.parent.mkdir(parents=True, exist_ok=True)
    staging_path = output_path.with_suffix(".partial")

    command = ["pmtiles", "extract", source_url, str(staging_path), f"--bbox={nyc_bbox}"]
    if args.maxzoom is not None:
        command.append(f"--maxzoom={args.maxzoom}")

    print(f"Extracting bbox {nyc_bbox} from {source_url}", flush=True)
    subprocess.run(command, check=True)
    staging_path.replace(output_path)  # only after success, so a failed run keeps the old basemap


if __name__ == "__main__":
    main()
