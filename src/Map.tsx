import { layers, namedFlavor } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";
import MapLibreMap from "react-map-gl/maplibre";

const SOURCE_ID = "protomaps";

const mapStyle: StyleSpecification = {
  version: 8,
  glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
  sprite: "https://protomaps.github.io/basemaps-assets/sprites/v4/light",
  sources: {
    [SOURCE_ID]: {
      type: "vector",
      url: "pmtiles:///tiles/nyc.pmtiles",
      attribution:
        '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    },
  },
  layers: layers(SOURCE_ID, namedFlavor("light"), { lang: "en" }),
};

export const Map = () => (
  <MapLibreMap
    initialViewState={{ longitude: -73.98, latitude: 40.74, zoom: 11 }}
    mapStyle={mapStyle}
    style={{ position: "fixed", inset: 0 }}
  />
);
