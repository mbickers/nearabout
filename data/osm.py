import json
import urllib.parse
import urllib.request
from pathlib import Path

# The basemap extract's bounding box, as west, south, east, north.
NYC_BOUNDS = (-74.30, 40.47, -73.68, 40.93)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"


def overpass_elements(query_body: str):
    """Run an Overpass QL query over NYC_BOUNDS and return its elements.

    The bbox is supplied through Overpass's `bbox` setting, so the query body can use a bare
    `way[...]` filter without repeating the coordinates.
    """
    west, south, east, north = NYC_BOUNDS
    query = f"[out:json][timeout:600][bbox:{south},{west},{north},{east}];\n{query_body}"
    request = urllib.request.Request(
        OVERPASS_URL,
        urllib.parse.urlencode({"data": query}).encode(),
        headers={"User-Agent": "nearabout"},  # Overpass 406s on urllib's default
    )
    print(f"Querying Overpass:\n{query}", flush=True)
    with urllib.request.urlopen(request, timeout=900) as response:
        return json.load(response)["elements"]


def write_feature_collection(*, output_path: Path, features: list[dict]):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    print(f"Wrote {len(features)} features to {output_path}", flush=True)
