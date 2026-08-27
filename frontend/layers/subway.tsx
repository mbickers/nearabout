import type { CircleLayerSpecification, GeoJSONSource } from "maplibre-gl";
import type { MapContribution } from "../Map";
import { SERVICE_PERIODS, type ServicePeriod, type SubwayState } from "../map_state";
import { buildSubwayTrackGraph, loadSubwayTrackGraph } from "../subway_offsets";
import {
  circleLegend,
  DETAIL_FADE,
  DETAIL_FADE_FULL,
  DETAIL_FADE_IN,
  DETAIL_LABEL_SIZE,
  interpolateOnZoom,
  type LayerDefinition,
  LegendRows,
  MAP_FONT,
  ROUTE_WIDTH_STOPS,
  type StateChange,
} from "./shared";

// express routes are diamonds on the official map, everything else is a disc
type SubwayBullet = {
  route: string;
  color: string;
  text_color: string;
};

// A station's bullets and its name are one symbol, so that the collision engine places the whole
// label or none of it. The bullets are composited into a single icon named by the block string:
// rows of comma-separated route symbols, rows separated by "|".
const BULLET_PIXELS = 44;
const BULLET_CELL_PIXELS = 48;

const drawBullet = ({
  context,
  bullet: { route, color, text_color },
  centerX,
  centerY,
}: {
  context: CanvasRenderingContext2D;
  bullet: SubwayBullet;
  centerX: number;
  centerY: number;
}) => {
  const radius = BULLET_PIXELS / 2 - 1;

  context.fillStyle = color;
  context.beginPath();
  if (route.endsWith("X")) {
    context.moveTo(centerX, centerY - radius);
    context.lineTo(centerX + radius, centerY);
    context.lineTo(centerX, centerY + radius);
    context.lineTo(centerX - radius, centerY);
  } else {
    context.arc(centerX, centerY, radius, 0, 2 * Math.PI);
  }
  context.fill();

  context.fillStyle = text_color;
  context.font = `${BULLET_PIXELS * 0.55}px "${MAP_FONT}"`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(route.replace(/X$/, ""), centerX, centerY);
};

const drawBulletBlock = (block: string, bulletsByRoute: Map<string, SubwayBullet>) => {
  const rows = block.split("|").map((row) => row.split(","));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(...rows.map((row) => row.length)) * BULLET_CELL_PIXELS;
  canvas.height = rows.length * BULLET_CELL_PIXELS;
  const context = canvas.getContext("2d")!;
  for (const [rowIndex, row] of rows.entries())
    for (const [columnIndex, route] of row.entries())
      drawBullet({
        context,
        bullet: bulletsByRoute.get(route)!,
        centerX: (columnIndex + 0.5) * BULLET_CELL_PIXELS,
        centerY: (rowIndex + 0.5) * BULLET_CELL_PIXELS,
      });
  return context.getImageData(0, 0, canvas.width, canvas.height);
};

const stationMarkerImage = "subway-station";

const drawStationMarker = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 20;
  canvas.height = 20;
  const context = canvas.getContext("2d")!;
  context.beginPath();
  context.arc(10, 10, 7.5, 0, 2 * Math.PI);
  context.fillStyle = "#000000";
  context.fill();
  return context.getImageData(0, 0, canvas.width, canvas.height);
};

const entranceMarkerPaint = {
  "circle-radius": interpolateOnZoom([
    [DETAIL_FADE_IN, 3.5],
    [18, 7],
  ]),
  "circle-color": "#888888",
  "circle-stroke-color": "#222222",
  "circle-stroke-width": interpolateOnZoom([
    [14, 1],
    [18, 1.5],
  ]),
  "circle-opacity": DETAIL_FADE,
  "circle-stroke-opacity": DETAIL_FADE,
} satisfies CircleLayerSpecification["paint"];

const subwayMapContribution = ({ servicePeriod }: SubwayState): MapContribution => {
  const stationDetailZoom = DETAIL_FADE_IN;

  return {
    sources: {
      subway_routes: { type: "geojson", data: "/data/subway_routes.geojson" },
      subway_track_graph: {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      },
      subway_stations: { type: "geojson", data: "/data/subway_stations.geojson" },
      subway_entrances: { type: "geojson", data: "/data/subway_entrances.geojson" },
      subway_station_routes: { type: "geojson", data: "/data/subway_station_routes.geojson" },
    },
    physicalLayers: [
      {
        z: "feature",
        style: {
          id: "subway_stations",
          // a flat extrusion rather than a fill: fill-extrusion-opacity is applied to the layer once,
          // where fill-opacity is applied to each polygon, and the envelopes overlapping inside a
          // complex would blend into a darker patch
          type: "fill-extrusion",
          source: "subway_stations",
          minzoom: DETAIL_FADE_IN,
          // use a substring check to include shared complexes such as NYCT/PATH
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
        z: "feature",
        style: {
          id: "subway_routes",
          type: "line",
          source: "subway_routes",
          layout: { "line-cap": "square", "line-join": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": interpolateOnZoom(ROUTE_WIDTH_STOPS),
          },
        },
      },
      {
        z: "feature",
        style: {
          id: "subway_stations_overview",
          type: "symbol",
          source: "subway_station_routes",
          filter: ["has", `label_offset_${servicePeriod}`],
          layout: {
            "icon-image": stationMarkerImage,
            // above the detail zoom the marker is the fallback for a station whose label was
            // dropped, so it yields to any symbol already placed
            "icon-allow-overlap": ["step", ["zoom"], true, stationDetailZoom, false],
            // never displaces a label: placement runs top layer first, so the labels are already down
            "icon-ignore-placement": true,
          },
          paint: {
            "icon-opacity": interpolateOnZoom([
              [10, 0],
              [12, 1],
            ]),
          },
        },
      },
      {
        z: "feature",
        style: {
          id: "subway_entrances",
          type: "circle",
          source: "subway_entrances",
          minzoom: DETAIL_FADE_IN,
          paint: entranceMarkerPaint,
        },
      },
      {
        z: "label",
        style: {
          id: "subway_station_labels",
          type: "symbol",
          source: "subway_station_routes",
          minzoom: stationDetailZoom,
          filter: ["has", `bullets_${servicePeriod}`],
          layout: {
            "icon-image": ["get", `bullets_${servicePeriod}`],
            // the block grows rightwards from the station and is centred on it vertically
            "icon-anchor": "left",
            "icon-size": interpolateOnZoom([
              [11, 0.4],
              [14, 0.6],
              [18, 1],
            ]),
            "text-field": ["get", "label"],
            "text-font": [MAP_FONT],
            "text-size": DETAIL_LABEL_SIZE,
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
            "icon-opacity": DETAIL_FADE,
          },
        },
      },
      {
        z: "debug",
        style: {
          id: "subway_track_graph_edges",
          type: "line",
          source: "subway_track_graph",
          filter: ["==", ["get", "kind"], "edge"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#ff00c8",
            "line-width": 3,
            "line-opacity": 0.8,
          },
        },
      },
      {
        z: "debug",
        style: {
          id: "subway_track_graph_vertices",
          type: "circle",
          source: "subway_track_graph",
          filter: ["==", ["get", "kind"], "vertex"],
          paint: {
            "circle-radius": 4,
            "circle-color": "#ffffff",
            "circle-stroke-color": "#000000",
            "circle-stroke-width": 2,
          },
        },
      },
      {
        z: "debug",
        style: {
          id: "subway_track_graph_labels",
          type: "symbol",
          source: "subway_track_graph",
          filter: ["==", ["get", "kind"], "vertex"],
          layout: {
            "text-field": ["get", "label"],
            "text-font": [MAP_FONT],
            "text-size": 11,
            "text-offset": [0, 0.7],
            "text-anchor": "top",
            "text-allow-overlap": true,
          },
          paint: {
            "text-color": "#000000",
            "text-halo-color": "#ffffff",
            "text-halo-width": 2,
          },
        },
      },
    ],
    onLoad: async (map) => {
      const graph = buildSubwayTrackGraph(await loadSubwayTrackGraph());
      (map.getSource("subway_track_graph") as GeoJSONSource).setData(graph);
    },
    addStyleImages: async (map) => {
      // canvas silently falls back to a system face for a webfont it has not already loaded
      await document.fonts.load(`1em "${MAP_FONT}"`);

      if (!map.hasImage(stationMarkerImage))
        map.addImage(stationMarkerImage, drawStationMarker(), { pixelRatio: 2 });

      const response = await fetch("/data/subway_bullets.json");
      const { bullets, blocks } = (await response.json()) as {
        bullets: SubwayBullet[];
        blocks: string[];
      };
      const bulletsByRoute = new Map(bullets.map((bullet) => [bullet.route, bullet]));
      for (const block of blocks) {
        if (!map.hasImage(block))
          map.addImage(block, drawBulletBlock(block, bulletsByRoute), { pixelRatio: 2 });
      }
    },
  };
};

const SubwayControls = ({
  state,
  onChange,
}: {
  state: SubwayState;
  onChange: (change: StateChange<SubwayState>) => void;
}) => (
  <div style={{ display: "grid", gap: 4 }}>
    <LegendRows
      items={[
        {
          label: "Station",
          legend: circleLegend({
            "circle-radius": 3.75,
            "circle-color": "#000000",
          } satisfies CircleLayerSpecification["paint"]),
        },
        { label: "Entrance/exit", legend: circleLegend(entranceMarkerPaint) },
      ]}
    />
    <label>
      Service pattern:{" "}
      <select
        aria-label="Subway service period"
        value={state.servicePeriod}
        disabled={!state.enabled}
        onChange={({ target }) =>
          onChange({ ...state, servicePeriod: target.value as ServicePeriod })
        }
        style={{ font: "inherit" }}
      >
        {SERVICE_PERIODS.map((period) => (
          <option key={period} value={period}>
            {period === "regular" ? "weekday" : period.replace("_", " ")}
          </option>
        ))}
      </select>
    </label>
  </div>
);

export const subwayLayer: LayerDefinition<SubwayState> = {
  label: "Subway",
  contribution: subwayMapContribution,
  renderControls: (props) => <SubwayControls {...props} />,
};
