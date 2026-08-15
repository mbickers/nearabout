import { layers, namedFlavor } from "@protomaps/basemaps";
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  LineLayerSpecification,
  Map as MapInstance,
  StyleSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";
import { useMemo, useState } from "react";
import MapLibreMap from "react-map-gl/maplibre";
import subwayBullets from "../public/data/subway_bullets.json";

const BULLET_PIXELS = 44;

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

const BIKE_COLOR = "#000000";

const STREET_COLOR = "#d5d5d5";

// the caret icon, in css pixels at CARET_SIZE_STOPS size 1
const CARET_LENGTH_PIXELS = 3.5;
const CARET_HEIGHT_PIXELS = 7;
const CARET_STROKE_PIXELS = 1;
// avoids resampling blur at the sizes CARET_SIZE_STOPS reaches
const CARET_RESOLUTION = 4;

// the colour is what distinguishes a street's direction marker from a bike lane's
const drawCaret = ({ color }: { color: string }) => {
  const inset = CARET_STROKE_PIXELS / 2;
  const width = CARET_LENGTH_PIXELS + CARET_STROKE_PIXELS;

  const canvas = document.createElement("canvas");
  canvas.width = width * CARET_RESOLUTION;
  canvas.height = CARET_HEIGHT_PIXELS * CARET_RESOLUTION;
  const context = canvas.getContext("2d")!;
  context.scale(CARET_RESOLUTION, CARET_RESOLUTION);

  context.strokeStyle = color;
  context.lineWidth = CARET_STROKE_PIXELS;
  context.lineCap = "round";
  context.lineJoin = "round";

  // the ink then spans exactly CARET_HEIGHT_PIXELS at any stroke width
  context.beginPath();
  context.moveTo(inset, inset);
  context.lineTo(inset + CARET_LENGTH_PIXELS, CARET_HEIGHT_PIXELS / 2);
  context.lineTo(inset, CARET_HEIGHT_PIXELS - inset);
  context.stroke();

  return context.getImageData(0, 0, canvas.width, canvas.height);
};

// pairs rather than an object because integer-like object keys sort ahead of fractional ones,
// which would silently reorder stops like 14.5 and 15 into a descending list maplibre rejects
const interpolateOnZoom = (stops: [zoom: number, value: number | ExpressionSpecification][]) =>
  ["interpolate", ["linear"], ["zoom"], ...stops.flat()] as unknown as ExpressionSpecification;

const SOURCE_ID = "protomaps";

const INITIAL_ZOOM = 11;

const DETAIL_FADE_IN = 14;

const DETAIL_FADE_FULL = 14.5;

const CARET_SIZE_STOPS: [zoom: number, size: number][] = [
  [DETAIL_FADE_IN, 1.9],
  [16, 2.5],
  [19, 4.5],
];

const SUBWAY_WIDTH = interpolateOnZoom([
  [10, 1],
  [14, 3],
  [18, 6],
]);

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

const DETAIL_FADE = interpolateOnZoom([
  [DETAIL_FADE_IN, 0],
  [DETAIL_FADE_FULL, 1],
]);

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

const SERVICE_PERIODS = ["regular", "late_night", "weekend"] as const;

type ServicePeriod = (typeof SERVICE_PERIODS)[number];

const buildMapStyle = (servicePeriod: ServicePeriod): StyleSpecification => ({
  version: 8,
  // street names come from the basemap's own label layers, station names from the subway data
  glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
  sources: {
    [SOURCE_ID]: {
      type: "vector",
      url: "pmtiles:///tiles/nyc.pmtiles",
      attribution:
        '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    },
    bike_routes: {
      type: "geojson",
      data: "/data/bike_routes.geojson",
      generateId: true,
    },
    subway_routes: { type: "geojson", data: "/data/subway_routes.geojson" },
    subway_stations: { type: "geojson", data: "/data/subway_stations.geojson" },
    subway_entrances: { type: "geojson", data: "/data/subway_entrances.geojson" },
    subway_station_routes: { type: "geojson", data: "/data/subway_station_routes.geojson" },
  },
  layers: [
    ...basemapLayers.filter((layer) => !isStreetLabelLayer(layer)),
    {
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
    {
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
    {
      id: "bike_routes_unprotected",
      type: "line",
      source: "bike_routes",
      minzoom: DETAIL_FADE_IN,
      filter: ["!=", ["get", "facilitycl"], "I"],
      paint: {
        "line-color": BIKE_COLOR,
        "line-width": interpolateOnZoom([
          [DETAIL_FADE_IN, 0.4],
          [19, 1.5],
        ]),
        "line-opacity": DETAIL_FADE,
      },
    },
    {
      id: "bike_one_way",
      type: "symbol",
      source: "bike_routes",
      // 2 is the two-way route, R and L the one-way directions along and against the geometry
      // the DOT feed splits routes into block-length features, and MapLibre places at least one
      // line symbol (the direction arrows) on each feature. Sampling feature IDs controls density across those segments.
      filter: ["all", ["!=", ["get", "bikedir"], "2"], ["==", ["%", ["id"], 3], 0]],
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
      paint: {
        // protected routes remain legible with the overview; other routes follow the street detail
        "icon-opacity": interpolateOnZoom([
          [DETAIL_FADE_IN, ["case", ["==", ["get", "facilitycl"], "I"], 1, 0]],
          [DETAIL_FADE_FULL, 1],
        ]),
      },
    },
    {
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
    {
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
    // street names follow the same centrelines as the routes above, which would print over them
    // at the position these layers hold in the basemap
    ...basemapLayers.filter(isStreetLabelLayer),
    {
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
    {
      id: "subway_station_routes",
      type: "symbol",
      source: "subway_station_routes",
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
    {
      id: "subway_station_names",
      type: "symbol",
      source: "subway_station_routes",
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
      },
    },
  ],
});

// the caller reads this to tell whether a style already has these images
const FIRST_STYLE_IMAGE = "street_caret";

const addStyleImages = (map: MapInstance) => {
  map.addImage(FIRST_STYLE_IMAGE, drawCaret({ color: STREET_COLOR }), {
    pixelRatio: CARET_RESOLUTION,
  });
  map.addImage("bike_caret", drawCaret({ color: BIKE_COLOR }), { pixelRatio: CARET_RESOLUTION });

  for (const bullet of subwayBullets) {
    map.addImage(bullet.route, drawBullet(bullet), { pixelRatio: 2 });
  }
};

export const Map = () => {
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [servicePeriod, setServicePeriod] = useState<ServicePeriod>("regular");
  // react-map-gl reloads the style when the prop changes identity, which every pan and zoom
  // would otherwise trigger
  const mapStyle = useMemo(() => buildMapStyle(servicePeriod), [servicePeriod]);

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
        // load waits on every source, so these images are registered only once the geojson has
        onLoad={({ target }) => {
          // pinch-zoom and keyboard panning stay on, so these two cannot be disabled by prop
          target.touchZoomRotate.disableRotation();
          target.keyboard.disableRotation();

          addStyleImages(target);
          // every later style also raises style.load, but only a style maplibre rebuilt from
          // scratch has an empty image manager
          target.on("style.load", () => {
            if (!target.hasImage(FIRST_STYLE_IMAGE)) addStyleImages(target);
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
        <select
          value={servicePeriod}
          onChange={({ target }) => setServicePeriod(target.value as ServicePeriod)}
          style={{ font: "inherit" }}
        >
          {SERVICE_PERIODS.map((period) => (
            <option key={period} value={period}>
              {period.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>
    </>
  );
};
