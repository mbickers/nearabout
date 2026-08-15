# nearabout

A stylized map of New York City, built with React + MapLibre GL JS on a self-hosted
[Protomaps](https://protomaps.com/) `.pmtiles` basemap extract.

## Running it

The map renders nothing until the basemap extract exists at `public/tiles/nyc.pmtiles`, so
fetch it first. That needs the [`pmtiles`](https://github.com/protomaps/go-pmtiles) CLI and
[`uv`](https://docs.astral.sh/uv/) on PATH.

```sh
./data/fetch_basemap.py
npm install
npm run dev
```

Then open the URL Vite prints.

## Requirements

Node `^20.19.0 || >=22.12.0`, as Vite 8 requires. `.nvmrc` pins v24.19.0.

Basemap data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, ODbL.
