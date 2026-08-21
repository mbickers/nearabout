#!/usr/bin/env -S uv run

import io
import subprocess
import urllib.request
import zipfile
from pathlib import Path

# MapLibre requests a fontstack by name, and the name is the directory the glyph tiles are
# served from, so this is what `text-font` in frontend/layer_definitions.tsx refers to.
FONT_NAME = "Inter Medium"


def download(url: str) -> bytes:
    print(f"Fetching {url}", flush=True)
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


def main():
    output_path = Path(__file__).resolve().parent.parent / "public" / "data" / "fonts" / FONT_NAME
    output_path.mkdir(parents=True, exist_ok=True)

    release = download("https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip")
    with zipfile.ZipFile(io.BytesIO(release)) as archive:
        face = archive.read("extras/ttf/Inter-Medium.ttf")

    face_path = output_path / f"{FONT_NAME}.ttf"
    face_path.write_bytes(face)

    subprocess.run(
        ["npx", "--yes", "--package=fontnik@0.7.7", "build-glyphs", face_path, output_path],
        check=True,
    )

    # the Open Font License requires that it accompany the font wherever it is served
    (output_path / "LICENSE.txt").write_bytes(
        download("https://raw.githubusercontent.com/rsms/inter/v4.1/LICENSE.txt")
    )


if __name__ == "__main__":
    main()
