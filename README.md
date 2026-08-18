# nearabout

A stylized map of New York City, built with React + MapLibre GL JS on a self-hosted
[Protomaps](https://protomaps.com/) `.pmtiles` basemap extract.

## Running it

The map renders nothing until the basemap extract exists at `public/data/nyc.pmtiles`, so
fetch it first. That needs the [`pmtiles`](https://github.com/protomaps/go-pmtiles) CLI,
[`uv`](https://docs.astral.sh/uv/), and [`mise`](https://mise.jdx.dev/) on PATH.

```sh
mise run bootstrap
mise run data:all
npm run dev
```

`bootstrap` copy-on-write clones generated map data from the primary checkout, then installs the
Python and Node dependencies. `data:all` generates anything missing or older than its inputs.

Run `mise watch` while editing data scripts to rebuild changed tasks and their downstream
dependents. It needs `mise install` first, for `watchexec`.

Then open the URL Vite prints.

## Requirements

Node `^20.19.0 || >=22.12.0`, as Vite 8 requires. `.nvmrc` pins v24.19.0.

Basemap data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, ODbL.
