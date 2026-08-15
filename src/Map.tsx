import { layers, namedFlavor } from "@protomaps/basemaps";
import type { ExpressionSpecification, FilterSpecification, StyleSpecification } from "maplibre-gl";
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

// pairs rather than an object because integer-like object keys sort ahead of fractional ones,
// which would silently reorder stops like 14.5 and 15 into a descending list maplibre rejects
const interpolateOnZoom = (stops: [zoom: number, value: number][]) =>
  ["interpolate", ["linear"], ["zoom"], ...stops.flat()] as unknown as ExpressionSpecification;

const SOURCE_ID = "protomaps";

const INITIAL_ZOOM = 11;

const STATION_DETAIL_FADE_IN = 14;

const STATION_DETAIL_FADE_FULL = 14.5;

const flavor = { ...namedFlavor("light"), background: "#ffffff", earth: "#ffffff" };

const SERVICE_PERIODS = ["regular", "late_night", "weekend"] as const;

type ServicePeriod = (typeof SERVICE_PERIODS)[number];

const buildMapStyle = (servicePeriod: ServicePeriod): StyleSpecification => ({
  version: 8,
  // the station name labels are the only text in the style
  glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
  sources: {
    [SOURCE_ID]: {
      type: "vector",
      url: "pmtiles:///tiles/nyc.pmtiles",
      attribution:
        '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    },
    subway_routes: { type: "geojson", data: "/data/subway_routes.geojson" },
    subway_stations: { type: "geojson", data: "/data/subway_stations.geojson" },
    subway_entrances: { type: "geojson", data: "/data/subway_entrances.geojson" },
    subway_station_routes: { type: "geojson", data: "/data/subway_station_routes.geojson" },
  },
  layers: [
    ...layers(SOURCE_ID, flavor, { lang: "en" })
      .filter(({ id }) =>
        [
          "background",
          "earth",
          "landuse_aerodrome",
          "landuse_park",
          "landuse_pier",
          "water",
          "water_stream",
          "water_river",
        ].includes(id),
      )
      .map((layer) => {
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
      }),
    {
      id: "subway_routes",
      type: "line",
      source: "subway_routes",
      paint: {
        "line-color": ["get", "color"],
        "line-width": interpolateOnZoom([
          [10, 1],
          [14, 3],
          [18, 6],
        ]),
      },
    },
    {
      id: "subway_stations",
      type: "fill",
      source: "subway_stations",
      minzoom: STATION_DETAIL_FADE_IN,
      // substring, so shared complexes like "NYCT/PATH" stay while PATH/LIRR/Metro-North-only go
      filter: ["in", "NYCT", ["get", "agency"]],
      paint: {
        "fill-color": "#808080",
        "fill-opacity": interpolateOnZoom([
          [STATION_DETAIL_FADE_IN, 0],
          [STATION_DETAIL_FADE_FULL, 0.3],
        ]),
      },
    },
    {
      id: "subway_entrances",
      type: "circle",
      source: "subway_entrances",
      minzoom: STATION_DETAIL_FADE_IN,
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
        "circle-opacity": interpolateOnZoom([
          [STATION_DETAIL_FADE_IN, 0],
          [STATION_DETAIL_FADE_FULL, 1],
        ]),
        "circle-stroke-opacity": interpolateOnZoom([
          [STATION_DETAIL_FADE_IN, 0],
          [STATION_DETAIL_FADE_FULL, 1],
        ]),
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

export const Map = () => {
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [servicePeriod, setServicePeriod] = useState<ServicePeriod>("regular");
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
        onLoad={({ target }) => {
          // pinch-zoom and keyboard panning stay on, so these two cannot be disabled by prop
          target.touchZoomRotate.disableRotation();
          target.keyboard.disableRotation();

          for (const bullet of subwayBullets) {
            target.addImage(bullet.route, drawBullet(bullet), { pixelRatio: 2 });
          }
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
