import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";
import type { LayerZ, PhysicalLayer } from "../Map";
import {
  DETAIL_FADE,
  DETAIL_FADE_IN,
  DETAIL_LABEL_SIZE,
  interpolateOnZoom,
  type LayerDefinition,
  type LayerOfKind,
  LegendRows,
  PROTOMAPS_SOURCES,
  protomapsLayer,
  ROUTE_WIDTH_STOPS,
} from "./shared";

const STREET_COLOR = "#d5d5d5";
const ROAD_SOURCE_ID = "osm_roads";

const CARET_SIZE_STOPS: [zoom: number, size: number][] = [
  [DETAIL_FADE_IN, 1.9],
  [16, 2.5],
  [19, 4.5],
];

// avoids resampling blur at the sizes CARET_SIZE_STOPS reaches
const CARET_RESOLUTION = 4;

// CSS pixels at CARET_SIZE_STOPS size 1
const CARET_LENGTH_PIXELS = 3.5;
const CARET_HEIGHT_PIXELS = 7;
const CARET_STROKE_PIXELS = 1;
// a caret standing in for a lane's line carries the weight that line would have had
const CARET_STREAM_STROKE_PIXELS = 2.5;

const caretInkLengthPixels = (strokePixels: number) => CARET_LENGTH_PIXELS + strokePixels;

// a gap of about a third of a caret's length reads as one stream rather than as separate arrows
const CARET_STREAM_SPACING_PIXELS = caretInkLengthPixels(CARET_STREAM_STROKE_PIXELS) * 1.35;

const drawCaret = ({
  color,
  strokePixels,
  lengthPixels = caretInkLengthPixels(strokePixels),
}: {
  color: string;
  strokePixels: number;
  // a caret drawn on a longer canvas is followed by the gap that separates it from the next,
  // which is what line-pattern tiles along a lane
  lengthPixels?: number;
}) => {
  const canvas = document.createElement("canvas");
  canvas.width = lengthPixels * CARET_RESOLUTION;
  canvas.height = CARET_HEIGHT_PIXELS * CARET_RESOLUTION;
  const context = canvas.getContext("2d")!;
  context.scale(CARET_RESOLUTION, CARET_RESOLUTION);

  context.strokeStyle = color;
  context.lineWidth = strokePixels;
  context.lineCap = "round";
  context.lineJoin = "round";

  const inset = strokePixels / 2;
  // the ink spans exactly CARET_HEIGHT_PIXELS at any stroke width
  context.beginPath();
  context.moveTo(inset, inset);
  context.lineTo(inset + CARET_LENGTH_PIXELS, CARET_HEIGHT_PIXELS / 2);
  context.lineTo(inset, CARET_HEIGHT_PIXELS - inset);
  context.stroke();

  return context.getImageData(0, 0, canvas.width, canvas.height);
};

const caretStreamLegend = ({ color, width }: { color: string; width: number }) => {
  const inset = CARET_STREAM_STROKE_PIXELS / 2;

  return (
    <svg width={width} height={CARET_HEIGHT_PIXELS} aria-hidden="true">
      {Array.from({ length: Math.floor(width / CARET_STREAM_SPACING_PIXELS) }, (_, index) => {
        const left = inset + index * CARET_STREAM_SPACING_PIXELS;
        return (
          <polyline
            key={left}
            points={[
              [left, inset],
              [left + CARET_LENGTH_PIXELS, CARET_HEIGHT_PIXELS / 2],
              [left, CARET_HEIGHT_PIXELS - inset],
            ]
              .map(([x, y]) => `${x},${y}`)
              .join(" ")}
            fill="none"
            stroke={color}
            strokeWidth={CARET_STREAM_STROKE_PIXELS}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
};

const BIKE_LANE: ExpressionSpecification = ["==", ["get", "role"], "bike_lane"];

// The road source names a street's kind and rank as the Protomaps schema does, so a layer cloned
// from it keeps its line width and label placement and only has to be repointed and refiltered.
const clonedStreetLayer = <Style extends LayerSpecification>(
  id: string,
  z: LayerZ,
  filter: FilterSpecification,
): { z: LayerZ; style: Style } => {
  const { style } = protomapsLayer<Style>(id, z);
  // a GeoJSON source has no source layer to select within
  const { "source-layer": _sourceLayer, ...retargeted } = style as Style & {
    "source-layer"?: string;
  };
  return {
    z,
    style: {
      ...retargeted,
      source: ROAD_SOURCE_ID,
      filter: ["all", ["==", ["get", "role"], "street"], filter] as FilterSpecification,
    } as Style,
  };
};

const streetLayer = (id: string, filter: FilterSpecification): PhysicalLayer => {
  const layer = clonedStreetLayer<LineLayerSpecification>(id, "street", filter);

  return {
    ...layer,
    style: {
      ...layer.style,
      minzoom: DETAIL_FADE_IN,
      // the stock paint varies from white to grey by class and by tunnel
      paint: {
        "line-color": STREET_COLOR,
        "line-width": layer.style.paint?.["line-width"],
        "line-opacity": DETAIL_FADE,
      },
    },
  };
};

// A link is drawn by the link layer alone, at the narrower width of a ramp, so a kind layer must
// not draw it as well: two lines of the same colour would compose to a darker one as they fade in.
const streetsOfKind = (kind: string): FilterSpecification => [
  "all",
  ["==", ["get", "kind"], kind],
  ["!", ["get", "is_link"]],
];

const streetLabelLayer = (id: string, filter: FilterSpecification): PhysicalLayer => {
  const layer = clonedStreetLayer<SymbolLayerSpecification>(id, "label", filter);

  return {
    ...layer,
    style: {
      ...layer.style,
      // minor names have a higher stock minzoom than the streets
      minzoom: Math.max(layer.style.minzoom ?? 0, DETAIL_FADE_IN),
      layout: { ...layer.style.layout, "text-size": DETAIL_LABEL_SIZE },
      paint: { ...layer.style.paint, "text-opacity": DETAIL_FADE },
    },
  };
};

const bikeColor = "#000000";
// the stream of carets that stands in for a one-way lane's line spans nearly twice the width a
// route line would have had
const caretStreamWidthStops = ROUTE_WIDTH_STOPS.map(
  ([zoom, width]): [zoom: number, width: number] => [zoom, width * 1.8],
);
// a two-way lane, having no stream to draw, is a fifth narrower than a one-way lane's
const twoWayWidthRelativeToStream = 0.8;
const legendWidth = 34;
const protectedOneWayLegend = caretStreamLegend({ color: bikeColor, width: legendWidth });
const protectedTwoWayLegend = (
  <svg width={legendWidth} height={CARET_HEIGHT_PIXELS} aria-hidden="true">
    <line
      x1="0"
      y1={CARET_HEIGHT_PIXELS / 2}
      x2={legendWidth}
      y2={CARET_HEIGHT_PIXELS / 2}
      stroke={bikeColor}
      // the carets beside it span CARET_HEIGHT_PIXELS, so the ratio the paint uses reproduces
      // the weight the two lane types have against each other on the map
      strokeWidth={CARET_HEIGHT_PIXELS * twoWayWidthRelativeToStream}
    />
  </svg>
);
const unprotectedLineWidthAtMaximumZoom = 1.8;
const unprotectedBikeLaneLegend = (
  <svg width="34" height="8" aria-hidden="true">
    <line
      x1="1"
      y1="4"
      x2="33"
      y2="4"
      stroke={bikeColor}
      strokeWidth={unprotectedLineWidthAtMaximumZoom}
    />
  </svg>
);

const bikeLaneLayers: PhysicalLayer[] = [
  {
    z: "feature",
    style: {
      id: "bike_lanes_protected",
      type: "line",
      source: ROAD_SOURCE_ID,
      // a one-way lane is drawn as the caret stream alone
      filter: ["all", BIKE_LANE, ["==", ["get", "class"], "protected"], ["!", ["get", "one_way"]]],
      paint: {
        "line-color": bikeColor,
        "line-width": interpolateOnZoom(
          caretStreamWidthStops.map(([zoom, width]): [number, number] => [
            zoom,
            width * twoWayWidthRelativeToStream,
          ]),
        ),
      },
    },
  },
  {
    z: "feature",
    style: {
      id: "bike_lanes_painted",
      type: "line",
      source: ROAD_SOURCE_ID,
      minzoom: DETAIL_FADE_IN,
      filter: ["all", BIKE_LANE, ["==", ["get", "class"], "painted"]],
      paint: {
        "line-color": bikeColor,
        "line-width": interpolateOnZoom([
          [DETAIL_FADE_IN, 0.5],
          [19, unprotectedLineWidthAtMaximumZoom],
        ]),
        "line-opacity": DETAIL_FADE,
      },
    },
  },
];

// A line pattern rather than a symbol layer: maplibre places a line-placed symbol only where the
// feature is longer than the icon, so lane segments lose their carets as zoom decreases, while a
// pattern is scaled to the line width and tiled along a line of any length.
const protectedCaretStreamLayer: PhysicalLayer = {
  z: "feature",
  style: {
    id: "bike_one_way_protected",
    type: "line",
    source: ROAD_SOURCE_ID,
    filter: ["all", BIKE_LANE, ["==", ["get", "class"], "protected"], ["get", "one_way"]],
    paint: {
      "line-pattern": "bike_caret_stream",
      "line-width": interpolateOnZoom(caretStreamWidthStops),
    },
  },
};

const paintedBikeOneWayLayer: PhysicalLayer = {
  z: "feature",
  style: {
    id: "bike_one_way_painted",
    type: "symbol",
    source: ROAD_SOURCE_ID,
    minzoom: DETAIL_FADE_IN,
    filter: ["all", BIKE_LANE, ["==", ["get", "class"], "painted"], ["get", "one_way"]],
    layout: {
      "symbol-placement": "line",
      // no rotation: a one-way feature's geometry runs in the direction of travel
      "icon-image": "bike_caret",
      "icon-size": interpolateOnZoom(CARET_SIZE_STOPS),
      // the carets only annotate a line that is already there
      "symbol-spacing": 100,
      // existing labels can suppress a caret, but a caret cannot suppress symbols placed later
      "icon-ignore-placement": true,
    },
    paint: { "icon-opacity": DETAIL_FADE },
  },
};

export const streetsDefinition: LayerDefinition<LayerOfKind<"streets">> = {
  label: "Streets",
  mapStyleFragment: ({ bikeLanesVisible }) => ({
    sources: {
      ...PROTOMAPS_SOURCES,
      [ROAD_SOURCE_ID]: { type: "geojson", data: "/data/osm_roads.geojson" },
    },
    physicalLayers: [
      streetLayer("roads_minor", streetsOfKind("minor_road")),
      streetLayer("roads_major", streetsOfKind("major_road")),
      streetLayer("roads_highway", streetsOfKind("highway")),
      streetLayer("roads_link", ["get", "is_link"]),
      {
        z: "street",
        style: {
          id: "street_one_way",
          type: "symbol",
          source: ROAD_SOURCE_ID,
          minzoom: DETAIL_FADE_IN,
          // A bike lane that goes in the direction of the traffic shows the direction of the
          // street. Then the street does not show a caret. If the bike lanes are not visible,
          // the street shows a caret.
          filter: [
            "all",
            ["get", "oneway"],
            bikeLanesVisible ? ["!", ["get", "bike_lane_with_traffic"]] : true,
          ],
          layout: {
            "symbol-placement": "line",
            // no rotation: each street's geometry runs in its direction of travel
            "icon-image": "street_caret",
            "icon-size": interpolateOnZoom(CARET_SIZE_STOPS),
            "symbol-spacing": 100,
          },
          paint: { "icon-opacity": DETAIL_FADE },
        },
      },
      ...(bikeLanesVisible
        ? [...bikeLaneLayers, protectedCaretStreamLayer, paintedBikeOneWayLayer]
        : []),
      streetLabelLayer("roads_labels_minor", ["==", ["get", "kind"], "minor_road"]),
      streetLabelLayer("roads_labels_major", [
        "in",
        ["get", "kind"],
        ["literal", ["major_road", "highway"]],
      ]),
    ],
    addStyleImages: (map) => {
      if (!map.hasImage("street_caret"))
        map.addImage(
          "street_caret",
          drawCaret({ color: STREET_COLOR, strokePixels: CARET_STROKE_PIXELS }),
          { pixelRatio: CARET_RESOLUTION },
        );
      if (!map.hasImage("bike_caret"))
        map.addImage(
          "bike_caret",
          drawCaret({ color: bikeColor, strokePixels: CARET_STROKE_PIXELS }),
          { pixelRatio: CARET_RESOLUTION },
        );
      if (!map.hasImage("bike_caret_stream"))
        map.addImage(
          "bike_caret_stream",
          drawCaret({
            color: bikeColor,
            strokePixels: CARET_STREAM_STROKE_PIXELS,
            lengthPixels: CARET_STREAM_SPACING_PIXELS,
          }),
          { pixelRatio: CARET_RESOLUTION },
        );
    },
  }),
  Controls: ({ layer, disabled, onChange }) => (
    <div style={{ display: "grid", gap: 3 }}>
      <label>
        <input
          type="checkbox"
          checked={layer.bikeLanesVisible}
          disabled={disabled}
          onChange={({ target }) => onChange({ ...layer, bikeLanesVisible: target.checked })}
        />{" "}
        Bike lanes
      </label>
      {layer.bikeLanesVisible ? (
        <div style={{ display: "grid", gap: 3, marginLeft: 22 }}>
          <LegendRows
            items={[
              { label: "Protected (two-way)", legend: protectedTwoWayLegend },
              { label: "Protected (one-way)", legend: protectedOneWayLegend },
              { label: "Unprotected", legend: unprotectedBikeLaneLegend },
            ]}
          />
          <div>Shared lanes not shown.</div>
        </div>
      ) : null}
    </div>
  ),
};
