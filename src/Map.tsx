import { layers, namedFlavor } from "@protomaps/basemaps";
import type {
  FilterSpecification,
  LayerSpecification,
  LineLayerSpecification,
  Map as MapInstance,
  StyleSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";
import { useMemo, useRef, useState } from "react";
import MapLibreMap from "react-map-gl/maplibre";
import subwayBullets from "../public/data/subway_bullets.json";
import type { Layer, ServicePeriod } from "./layer";
import {
  BIKE_COLOR,
  CARET_RESOLUTION,
  CARET_SIZE_STOPS,
  DETAIL_FADE,
  DETAIL_FADE_FULL,
  DETAIL_FADE_IN,
  drawCaret,
  INITIAL_ZOOM,
  interpolateOnZoom,
  SOURCE_ID,
  STATION_DETAIL_ZOOM,
  STREET_COLOR,
  SUBWAY_WIDTH,
} from "./map_styling";

const BULLET_PIXELS = 44;

type MapStyleFragment = {
  sources: StyleSpecification["sources"];
  physicalLayers: { z: number; style: LayerSpecification }[];
  addStyleHook?: (map: MapInstance) => void;
};

// express routes are diamonds on the official map, everything else is a disc
const drawBullet = ({
  route,
  color,
  text_color,
}: {
  route: string;
  color: string;
  text_color: string;
}) => {
  const canvas = document.createElement("canvas");
  canvas.width = BULLET_PIXELS;
  canvas.height = BULLET_PIXELS;
  const context = canvas.getContext("2d")!;
  const center = BULLET_PIXELS / 2;
  const radius = center - 1;

  context.fillStyle = color;
  context.beginPath();
  if (route.endsWith("X")) {
    context.moveTo(center, center - radius);
    context.lineTo(center + radius, center);
    context.lineTo(center, center + radius);
    context.lineTo(center - radius, center);
  } else {
    context.arc(center, center, radius, 0, 2 * Math.PI);
  }
  context.fill();

  context.fillStyle = text_color;
  context.font = `600 ${BULLET_PIXELS * 0.55}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(route.replace(/X$/, ""), center, center);

  return context.getImageData(0, 0, BULLET_PIXELS, BULLET_PIXELS);
};

const flavor = { ...namedFlavor("light"), background: "#ffffff", earth: "#ffffff" };

// the four road classes this map renders, over surface, bridge and tunnel. a casing carries the
// dashes the basemap gives a tunnel, and service is the driveway, parking aisle and alley part of
// the minor class
const isStreetLayer = (layer: LayerSpecification): layer is LineLayerSpecification =>
  layer.type === "line" &&
  layer.id.startsWith("roads_") &&
  !layer.id.includes("casing") &&
  !layer.id.includes("service") &&
  ["minor", "link", "major", "highway"].some((kind) => layer.id.includes(kind));

const isStreetLabelLayer = (layer: LayerSpecification): layer is SymbolLayerSpecification =>
  layer.type === "symbol" && layer.id.startsWith("roads_labels_");

const basemapLayers = layers(SOURCE_ID, flavor, { lang: "en" })
  .filter(
    (layer) =>
      [
        "background",
        "earth",
        "landuse_aerodrome",
        "landuse_park",
        "landuse_pier",
        "water",
        "water_stream",
        "water_river",
      ].includes(layer.id) ||
      isStreetLayer(layer) ||
      isStreetLabelLayer(layer),
  )
  .map((layer) => {
    if (isStreetLayer(layer)) {
      return {
        ...layer,
        minzoom: DETAIL_FADE_IN,
        // only the surface minor layer excludes service in its own filter, so the bridge and
        // tunnel variants would otherwise render driveways and roadways inside a pier shed
        filter: ["all", layer.filter, ["!=", "kind_detail", "service"]] as FilterSpecification,
        // the stock paint varies from white to grey by class and by tunnel
        paint: {
          "line-color": STREET_COLOR,
          "line-width": layer.paint?.["line-width"],
          "line-opacity": DETAIL_FADE,
        },
      };
    }
    if (isStreetLabelLayer(layer)) {
      return {
        ...layer,
        // minor names have a higher stock minzoom than the streets
        minzoom: Math.max(layer.minzoom ?? 0, DETAIL_FADE_IN),
        // the minor filter also matches the path and other kinds, and service roads within the
        // minor kind; this map renders none of those, so their labels would have no line beneath
        filter: (layer.id === "roads_labels_minor"
          ? ["all", ["==", "kind", "minor_road"], ["!=", "kind_detail", "service"]]
          : layer.filter) as FilterSpecification,
        paint: { ...layer.paint, "text-opacity": DETAIL_FADE },
      };
    }
    if (layer.type !== "fill") return layer;
    if (layer.id === "landuse_park") {
      // the stock filter also takes wood, grass and sand, which the paint shades separately
      // and which show up as lawns and ball fields inside a park
      return {
        ...layer,
        filter: [
          "in",
          "kind",
          "national_park",
          "park",
          "cemetery",
          "protected_area",
          "nature_reserve",
          "forest",
          "golf_course",
        ] as FilterSpecification,
      };
    }
    // piers are their own layer because they draw after water, which would otherwise cover them
    if (layer.id === "landuse_pier") {
      return { ...layer, paint: { ...layer.paint, "fill-color": flavor.park_b } };
    }
    return layer;
  });

const BASEMAP_SOURCES: MapStyleFragment["sources"] = {
  [SOURCE_ID]: {
    type: "vector",
    url: "pmtiles:///tiles/nyc.pmtiles",
    attribution:
      '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  },
};

const basemapPhysicalLayers = basemapLayers.map((style, index) => ({
  z: index / 1000,
  style,
}));

const buildGeographyStyleFragment = (): MapStyleFragment => ({
  sources: BASEMAP_SOURCES,
  physicalLayers: basemapPhysicalLayers.filter(
    ({ style }) =>
      style.id !== "landuse_park" && !isStreetLayer(style) && !isStreetLabelLayer(style),
  ),
});

const buildParksStyleFragment = (): MapStyleFragment => ({
  sources: BASEMAP_SOURCES,
  physicalLayers: basemapPhysicalLayers.filter(({ style }) => style.id === "landuse_park"),
});

const buildStreetsStyleFragment = (): MapStyleFragment => ({
  sources: BASEMAP_SOURCES,
  physicalLayers: [
    ...basemapPhysicalLayers.filter(({ style }) => isStreetLayer(style)),
    {
      z: 10,
      style: {
        id: "street_one_way",
        type: "symbol",
        source: SOURCE_ID,
        "source-layer": "roads",
        minzoom: DETAIL_FADE_IN,
        // the same streets isStreetLayer renders, so that no caret is drawn over an absent street.
        // reversible streets have no fixed direction
        filter: [
          "all",
          ["in", ["get", "oneway"], ["literal", ["yes", "-1"]]],
          ["!=", ["get", "kind_detail"], "service"],
          ["in", ["get", "kind"], ["literal", ["minor_road", "major_road", "highway"]]],
        ],
        layout: {
          "symbol-placement": "line",
          "icon-image": "street_caret",
          // -1 is the one-way that runs against the digitized geometry
          "icon-rotate": ["case", ["==", ["get", "oneway"], "-1"], 180, 0],
          "icon-size": interpolateOnZoom(CARET_SIZE_STOPS),
          "symbol-spacing": 100,
        },
        paint: { "icon-opacity": DETAIL_FADE },
      },
    },
    ...basemapPhysicalLayers
      .filter(({ style }) => isStreetLabelLayer(style))
      .map(({ style }) => ({ z: 50, style })),
  ],
  addStyleHook: (map) => {
    if (map.hasImage("street_caret")) return;
    map.addImage("street_caret", drawCaret({ color: STREET_COLOR }), {
      pixelRatio: CARET_RESOLUTION,
    });
  },
});

const buildBikeStyleFragment = (): MapStyleFragment => ({
  sources: {
    bike_routes: {
      type: "geojson",
      data: "/data/bike_routes.geojson",
      generateId: true,
    },
  },
  physicalLayers: [
    {
      z: 20,
      style: {
        id: "bike_routes_protected",
        type: "line",
        source: "bike_routes",
        // class I is the physically separated path
        filter: ["==", ["get", "facilitycl"], "I"],
        paint: {
          "line-color": BIKE_COLOR,
          "line-width": SUBWAY_WIDTH,
        },
      },
    },
    {
      z: 21,
      style: {
        id: "bike_routes_unprotected",
        type: "line",
        source: "bike_routes",
        minzoom: DETAIL_FADE_IN,
        filter: ["!=", ["get", "facilitycl"], "I"],
        paint: {
          "line-color": BIKE_COLOR,
          "line-width": interpolateOnZoom([
            [DETAIL_FADE_IN, 0.5],
            [19, 1.8],
          ]),
          "line-opacity": DETAIL_FADE,
        },
      },
    },
    {
      z: 22,
      style: {
        id: "bike_one_way",
        type: "symbol",
        source: "bike_routes",
        // 2 is the two-way route, R and L the one-way directions along and against the geometry
        // the DOT feed splits routes into block-length features, and MapLibre places at least one
        // line symbol on each feature. Sampling feature IDs more aggressively at overview zooms
        // controls density across those segments.
        // NYC has no unprotected contraflow lanes; a future contraflow lane would require revisiting
        // the Class I restriction.
        filter: [
          "all",
          ["==", ["get", "facilitycl"], "I"],
          ["!=", ["get", "bikedir"], "2"],
          [
            "step",
            ["zoom"],
            ["==", ["%", ["id"], 15], 0],
            13,
            ["==", ["%", ["id"], 6], 0],
            14,
            ["==", ["%", ["id"], 3], 0],
          ],
        ],
        layout: {
          "symbol-placement": "line",
          "icon-image": "bike_caret",
          "icon-rotate": ["case", ["==", ["get", "bikedir"], "L"], 180, 0],
          "icon-size": interpolateOnZoom(CARET_SIZE_STOPS),
          // six times the spacing the streets use, since spacing applies within one feature and the
          // bike data is cut at every block, where the basemap carries a street as one line
          "symbol-spacing": 600,
          // existing labels can suppress a caret, but a caret cannot suppress symbols placed later
          "icon-ignore-placement": true,
        },
      },
    },
  ],
  addStyleHook: (map) => {
    if (!map.hasImage("bike_caret")) {
      map.addImage("bike_caret", drawCaret({ color: BIKE_COLOR }), {
        pixelRatio: CARET_RESOLUTION,
      });
    }
  },
});

const buildSubwayStyleFragment = (servicePeriod: ServicePeriod): MapStyleFragment => ({
  sources: {
    subway_routes: { type: "geojson", data: "/data/subway_routes.geojson" },
    subway_stations: { type: "geojson", data: "/data/subway_stations.geojson" },
    subway_entrances: { type: "geojson", data: "/data/subway_entrances.geojson" },
    subway_station_routes: { type: "geojson", data: "/data/subway_station_routes.geojson" },
  },
  physicalLayers: [
    {
      z: 30,
      style: {
        id: "subway_stations",
        // a flat extrusion rather than a fill: fill-extrusion-opacity is applied to the layer once,
        // where fill-opacity is applied to each polygon, and the envelopes overlapping inside a
        // complex would blend into a darker patch
        type: "fill-extrusion",
        source: "subway_stations",
        minzoom: DETAIL_FADE_IN,
        // substring, so shared complexes like "NYCT/PATH" stay while PATH/LIRR/Metro-North-only go
        filter: ["in", "NYCT", ["get", "agency"]],
        paint: {
          "fill-extrusion-color": "#808080",
          "fill-extrusion-opacity": interpolateOnZoom([
            [DETAIL_FADE_IN, 0],
            [DETAIL_FADE_FULL, 0.3],
          ]),
        },
      },
    },
    {
      z: 40,
      style: {
        id: "subway_routes",
        type: "line",
        source: "subway_routes",
        paint: {
          "line-color": ["get", "color"],
          "line-width": SUBWAY_WIDTH,
          // the routes recede as the street detail fades in over the same zooms
          "line-opacity": interpolateOnZoom([
            [DETAIL_FADE_IN, 1],
            [DETAIL_FADE_FULL, 0.7],
          ]),
        },
      },
    },
    {
      z: 60,
      style: {
        id: "subway_stations_local_overview",
        type: "circle",
        source: "subway_station_routes",
        maxzoom: STATION_DETAIL_ZOOM,
        filter: [
          "all",
          ["has", `label_offset_${servicePeriod}`],
          ["!=", ["get", `express_${servicePeriod}`], true],
        ],
        paint: {
          "circle-radius": 3.75,
          "circle-color": "#000000",
        },
      },
    },
    {
      z: 60,
      style: {
        id: "subway_stations_express_overview",
        type: "circle",
        source: "subway_station_routes",
        maxzoom: STATION_DETAIL_ZOOM,
        filter: [
          "all",
          ["has", `label_offset_${servicePeriod}`],
          ["==", ["get", `express_${servicePeriod}`], true],
        ],
        paint: {
          "circle-radius": 3.5,
          "circle-color": "#ffffff",
          "circle-stroke-color": "#000000",
          "circle-stroke-width": 1.5,
        },
      },
    },
    {
      z: 70,
      style: {
        id: "subway_entrances",
        type: "circle",
        source: "subway_entrances",
        minzoom: DETAIL_FADE_IN,
        paint: {
          "circle-radius": interpolateOnZoom([
            [14, 3.5],
            [18, 7],
          ]),
          "circle-color": "#ffffff",
          "circle-stroke-color": "#222222",
          "circle-stroke-width": interpolateOnZoom([
            [14, 1],
            [18, 1.5],
          ]),
          // both, or the dark ring fades in ahead of the fill it outlines
          "circle-opacity": DETAIL_FADE,
          "circle-stroke-opacity": DETAIL_FADE,
        },
      },
    },
    {
      z: 80,
      style: {
        id: "subway_station_routes",
        type: "symbol",
        source: "subway_station_routes",
        minzoom: STATION_DETAIL_ZOOM,
        filter: ["has", `offset_${servicePeriod}`],
        layout: {
          "icon-image": ["get", "route"],
          "icon-offset": ["get", `offset_${servicePeriod}`],
          "icon-size": interpolateOnZoom([
            [11, 0.4],
            [14, 0.6],
            [18, 1],
          ]),
          // keep a station's bullets together rather than letting the placer drop some of the row
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      },
    },
    {
      z: 90,
      style: {
        id: "subway_station_names",
        type: "symbol",
        source: "subway_station_routes",
        minzoom: STATION_DETAIL_ZOOM,
        filter: ["has", `label_offset_${servicePeriod}`],
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Medium"],
          "text-size": interpolateOnZoom([
            [11, 11],
            [16, 15],
          ]),
          "text-offset": ["get", `label_offset_${servicePeriod}`],
          "text-anchor": "bottom-left",
          // the anchor places the block; without this, wrapped lines centre inside it
          "text-justify": "left",
        },
        paint: {
          "text-color": "#000000",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
          "text-opacity": DETAIL_FADE,
        },
      },
    },
  ],
  addStyleHook: (map) => {
    for (const bullet of subwayBullets) {
      if (!map.hasImage(bullet.route))
        map.addImage(bullet.route, drawBullet(bullet), { pixelRatio: 2 });
    }
  },
});

export const mapStyleFragmentForLayer = (layer: Layer): MapStyleFragment => {
  switch (layer.kind) {
    case "geography":
      return buildGeographyStyleFragment();
    case "streets":
      return buildStreetsStyleFragment();
    case "parks":
      return buildParksStyleFragment();
    case "bike_lanes":
      return buildBikeStyleFragment();
    case "subway":
      return buildSubwayStyleFragment(layer.servicePeriod);
  }
};

export const Map = ({ styleFragments }: { styleFragments: MapStyleFragment[] }) => {
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const styleFragmentsRef = useRef(styleFragments);
  styleFragmentsRef.current = styleFragments;
  // react-map-gl reloads the style when the prop changes identity, which every pan and zoom
  // would otherwise trigger
  const mapStyle = useMemo(
    () => ({
      version: 8 as const,
      glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
      sources: Object.assign({}, ...styleFragments.map(({ sources }) => sources)),
      layers: styleFragments
        .flatMap(({ physicalLayers }) => physicalLayers)
        .sort((first, second) => first.z - second.z)
        .map(({ style }) => style),
    }),
    [styleFragments],
  );

  return (
    <>
      <MapLibreMap
        initialViewState={{ longitude: -73.98, latitude: 40.74, zoom: INITIAL_ZOOM }}
        mapStyle={mapStyle}
        style={{ position: "fixed", inset: 0 }}
        dragRotate={false}
        touchPitch={false}
        maxPitch={0}
        onMove={({ viewState }) => setZoom(viewState.zoom)}
        onLoad={({ target }) => {
          // pinch-zoom and keyboard panning stay on, so these two cannot be disabled by prop
          target.touchZoomRotate.disableRotation();
          target.keyboard.disableRotation();

          for (const { addStyleHook } of styleFragmentsRef.current) addStyleHook?.(target);
          target.on("style.load", () => {
            for (const { addStyleHook } of styleFragmentsRef.current) addStyleHook?.(target);
          });
        }}
      />
      <div
        style={{
          position: "fixed",
          top: 8,
          left: 8,
          display: "flex",
          gap: 8,
          alignItems: "center",
          padding: "2px 6px",
          background: "rgba(255, 255, 255, 0.85)",
          borderRadius: 4,
          font: "12px ui-monospace, monospace",
        }}
      >
        <span>zoom: {zoom.toFixed(2)}</span>
      </div>
    </>
  );
};
