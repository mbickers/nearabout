import { layers, namedFlavor } from "@protomaps/basemaps";
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  FillLayerSpecification,
  FilterSpecification,
  LayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";
import type { ComponentType, ReactNode } from "react";
import type { Layer, ServicePeriod } from "./layer";
import { SERVICE_PERIODS } from "./layer";
import type { LayerZ, MapStyleFragment, PhysicalLayer } from "./Map";

const STREET_COLOR = "#d5d5d5";
const SOURCE_ID = "protomaps";
const DETAIL_FADE_IN = 14;
const DETAIL_FADE_FULL = 14.5;

// pairs rather than an object because integer-like object keys sort ahead of fractional ones,
// which would silently reorder stops like 14.5 and 15 into a descending list maplibre rejects
const interpolateOnZoom = (stops: [zoom: number, value: number | ExpressionSpecification][]) =>
  ["interpolate", ["linear"], ["zoom"], ...stops.flat()] as unknown as ExpressionSpecification;

const DETAIL_FADE = interpolateOnZoom([
  [DETAIL_FADE_IN, 0],
  [DETAIL_FADE_FULL, 1],
]);

const DETAIL_LABEL_SIZE = interpolateOnZoom([
  [DETAIL_FADE_IN, 13],
  [17, 17],
]);

const CARET_SIZE_STOPS: [zoom: number, size: number][] = [
  [DETAIL_FADE_IN, 1.9],
  [16, 2.5],
  [19, 4.5],
];

const ROUTE_WIDTH_AT_DETAIL_ZOOM = 3;
const SUBWAY_WIDTH = interpolateOnZoom([
  [10, 1],
  [14, ROUTE_WIDTH_AT_DETAIL_ZOOM],
  [18, 6],
]);

// avoids resampling blur at the sizes CARET_SIZE_STOPS reaches
const CARET_RESOLUTION = 4;

const drawCaret = ({ color }: { color: string }) => {
  // CSS pixels at CARET_SIZE_STOPS size 1
  const caretLengthPixels = 3.5;
  const caretHeightPixels = 7;
  const caretStrokePixels = 1;
  const inset = caretStrokePixels / 2;
  const width = caretLengthPixels + caretStrokePixels;

  const canvas = document.createElement("canvas");
  canvas.width = width * CARET_RESOLUTION;
  canvas.height = caretHeightPixels * CARET_RESOLUTION;
  const context = canvas.getContext("2d")!;
  context.scale(CARET_RESOLUTION, CARET_RESOLUTION);

  context.strokeStyle = color;
  context.lineWidth = caretStrokePixels;
  context.lineCap = "round";
  context.lineJoin = "round";

  // the ink spans exactly caretHeightPixels at any stroke width
  context.beginPath();
  context.moveTo(inset, inset);
  context.lineTo(inset + caretLengthPixels, caretHeightPixels / 2);
  context.lineTo(inset, caretHeightPixels - inset);
  context.stroke();

  return context.getImageData(0, 0, canvas.width, canvas.height);
};

// names both the glyph tiles data/fetch_map_fonts.py generates and the @font-face
// frontend/index.css declares for the canvas bullets and the overlay panels
export const MAP_FONT = "Inter Medium";
const PROTOMAPS_FLAVOR = {
  ...namedFlavor("light"),
  background: "#ffffff",
  earth: "#ffffff",
  regular: MAP_FONT,
  bold: MAP_FONT,
  italic: MAP_FONT,
};
const PROTOMAPS_LAYERS = layers(SOURCE_ID, PROTOMAPS_FLAVOR, { lang: "en" });

const protomapsLayer = <Style extends LayerSpecification = LayerSpecification>(
  id: string,
  z: LayerZ,
): { z: LayerZ; style: Style } => ({
  z,
  style: PROTOMAPS_LAYERS.find((layer) => layer.id === id)! as Style,
});

const PROTOMAPS_SOURCES: MapStyleFragment["sources"] = {
  [SOURCE_ID]: {
    type: "vector",
    url: "pmtiles:///data/nyc.pmtiles",
    attribution:
      '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  },
};

type LayerKind = Layer["kind"];

type LayerOfKind<Kind extends LayerKind> = Extract<Layer, { kind: Kind }>;

type LayerComponentProps<CurrentLayer extends Layer> = {
  layer: CurrentLayer;
  disabled: boolean;
  onChange: (layer: CurrentLayer) => void;
};

type LayerDefinition<CurrentLayer extends Layer> = {
  label: string;
  mapStyleFragment: (layer: CurrentLayer) => MapStyleFragment;
  Controls?: ComponentType<LayerComponentProps<CurrentLayer>>;
};

const circleLegend = (paint: NonNullable<CircleLayerSpecification["paint"]>) => {
  const initialZoomStop = (value: unknown) =>
    Array.isArray(value) ? (value[4] as number) : (value as number | undefined);

  return (
    <svg width="14" height="14" aria-hidden="true">
      <circle
        cx="7"
        cy="7"
        r={initialZoomStop(paint["circle-radius"])}
        fill={paint["circle-color"] as string}
        stroke={paint["circle-stroke-color"] as string | undefined}
        strokeWidth={initialZoomStop(paint["circle-stroke-width"])}
      />
    </svg>
  );
};

const LegendRows = ({ items }: { items: { label: string; legend: ReactNode }[] }) => (
  <div style={{ display: "grid", gap: 3 }}>
    {items.map(({ label, legend }) => (
      <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {legend}
        {label}
      </div>
    ))}
  </div>
);

const geographyDefinition: LayerDefinition<LayerOfKind<"geography">> = {
  label: "Geography",
  mapStyleFragment: ({ parksVisible }) => {
    const park = protomapsLayer<FillLayerSpecification>("landuse_park", "background");
    const pier = protomapsLayer<FillLayerSpecification>("landuse_pier", "background");

    return {
      sources: PROTOMAPS_SOURCES,
      physicalLayers: [
        protomapsLayer("background", "background"),
        protomapsLayer("earth", "background"),
        {
          ...park,
          style: {
            ...park.style,
            layout: { ...park.style.layout, visibility: parksVisible ? "visible" : "none" },
            // the stock filter also takes wood, grass and sand, which the paint shades separately
            // and which show up as lawns and ball fields inside a park
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
          },
        },
        protomapsLayer("landuse_aerodrome", "background"),
        // Render water after parks because Hudson River Park is a large polygon that extends into
        // the river beyond its piers, and because many parks have water features.
        protomapsLayer("water", "background"),
        protomapsLayer("water_stream", "background"),
        protomapsLayer("water_river", "background"),
        // piers are their own layer because they draw after water, which would otherwise cover them
        {
          ...pier,
          style: {
            ...pier.style,
            paint: { ...pier.style.paint, "fill-color": PROTOMAPS_FLAVOR.pier },
          },
        },
      ],
    };
  },
  Controls: ({ layer, disabled, onChange }) => (
    <label>
      <input
        type="checkbox"
        checked={layer.parksVisible}
        disabled={disabled}
        onChange={({ target }) => onChange({ ...layer, parksVisible: target.checked })}
      />{" "}
      Parks
    </label>
  ),
};

const ROAD_SOURCE_ID = "osm_roads";

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
  const layer = clonedStreetLayer<LineLayerSpecification>(id, "feature", filter);

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

const streetsDefinition: LayerDefinition<LayerOfKind<"streets">> = (() => {
  const bikeColor = "#000000";
  const protectedBikeLanePaint = {
    "line-color": bikeColor,
    "line-width": SUBWAY_WIDTH,
  } satisfies LineLayerSpecification["paint"];
  const protectedBikeLaneLegend = (
    <svg width="34" height="8" aria-hidden="true">
      <line
        x1="1"
        y1="4"
        x2="33"
        y2="4"
        stroke={bikeColor}
        strokeWidth={ROUTE_WIDTH_AT_DETAIL_ZOOM}
      />
    </svg>
  );
  const unprotectedLineWidthAtMaximumZoom = 1.8;
  const unprotectedBikeLanePaint = {
    "line-color": bikeColor,
    "line-width": interpolateOnZoom([
      [DETAIL_FADE_IN, 0.5],
      [19, unprotectedLineWidthAtMaximumZoom],
    ]),
    "line-opacity": DETAIL_FADE,
  } satisfies LineLayerSpecification["paint"];
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
        filter: ["all", BIKE_LANE, ["==", ["get", "class"], "protected"]],
        paint: protectedBikeLanePaint,
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
        paint: unprotectedBikeLanePaint,
      },
    },
  ];

  const bikeOneWayLayer: PhysicalLayer = {
    z: "feature",
    style: {
      id: "bike_one_way",
      type: "symbol",
      source: ROAD_SOURCE_ID,
      minzoom: DETAIL_FADE_IN,
      filter: ["all", BIKE_LANE, ["get", "one_way"]],
      layout: {
        "symbol-placement": "line",
        // no rotation: a one-way feature's geometry runs in the direction of travel
        "icon-image": "bike_caret",
        "icon-size": interpolateOnZoom(CARET_SIZE_STOPS),
        "symbol-spacing": 100,
        // existing labels can suppress a caret, but a caret cannot suppress symbols placed later
        "icon-ignore-placement": true,
      },
      paint: { "icon-opacity": DETAIL_FADE },
    },
  };

  return {
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
          z: "feature",
          style: {
            id: "street_one_way",
            type: "symbol",
            source: ROAD_SOURCE_ID,
            minzoom: DETAIL_FADE_IN,
            // a bike lane running with traffic already shows the direction, so the street cedes
            // its caret to the lane's; with lanes hidden there is no lane caret to cede to
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
        // after the street carets, so a car arrow sits beneath the lane rather than over it
        ...(bikeLanesVisible ? [...bikeLaneLayers, bikeOneWayLayer] : []),
        streetLabelLayer("roads_labels_minor", ["==", ["get", "kind"], "minor_road"]),
        streetLabelLayer("roads_labels_major", [
          "in",
          ["get", "kind"],
          ["literal", ["major_road", "highway"]],
        ]),
      ],
      addStyleImages: (map) => {
        if (!map.hasImage("street_caret"))
          map.addImage("street_caret", drawCaret({ color: STREET_COLOR }), {
            pixelRatio: CARET_RESOLUTION,
          });
        if (!map.hasImage("bike_caret"))
          map.addImage("bike_caret", drawCaret({ color: bikeColor }), {
            pixelRatio: CARET_RESOLUTION,
          });
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
                { label: "Protected", legend: protectedBikeLaneLegend },
                { label: "Unprotected", legend: unprotectedBikeLaneLegend },
              ]}
            />
            <div>Shared lanes not shown.</div>
          </div>
        ) : null}
      </div>
    ),
  };
})();

const citibikeDocksDefinition: LayerDefinition<LayerOfKind<"citibike_docks">> = (() => {
  const dockColor = "#0067b1";
  const dockMarkerPaint = {
    "circle-radius": interpolateOnZoom([
      [DETAIL_FADE_IN, 5.25],
      [18, 10.5],
    ]),
    "circle-color": dockColor,
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 0.75,
  } satisfies CircleLayerSpecification["paint"];

  return {
    label: "Citi Bike docks",
    mapStyleFragment: () => ({
      sources: {
        citibike_docks: {
          type: "geojson",
          data: "/data/citibike_docks.geojson",
          attribution: '<a href="https://citibikenyc.com/system-data">Citi Bike</a>',
        },
      },
      physicalLayers: [
        {
          z: "feature",
          style: {
            id: "citibike_docks",
            type: "circle",
            source: "citibike_docks",
            minzoom: DETAIL_FADE_IN,
            paint: dockMarkerPaint,
          },
        },
      ],
    }),
    Controls: () => (
      <LegendRows
        items={[
          {
            label: "Dock",
            legend: circleLegend(dockMarkerPaint),
          },
        ]}
      />
    ),
  };
})();

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

const subwayDefinition: LayerDefinition<LayerOfKind<"subway">> = (() => {
  const localStationMarkerImage = "subway-station-local";
  const expressStationMarkerImage = "subway-station-express";
  const drawStationMarker = ({ express }: { express: boolean }) => {
    const canvas = document.createElement("canvas");
    canvas.width = 20;
    canvas.height = 20;
    const context = canvas.getContext("2d")!;
    context.beginPath();
    context.arc(10, 10, express ? 7 : 7.5, 0, 2 * Math.PI);
    context.fillStyle = express ? "#ffffff" : "#000000";
    context.fill();
    if (express) {
      context.strokeStyle = "#000000";
      context.lineWidth = 3;
      context.stroke();
    }
    return context.getImageData(0, 0, canvas.width, canvas.height);
  };
  const localStationMarkerPaint = {
    "circle-radius": 3.75,
    "circle-color": "#000000",
  } satisfies CircleLayerSpecification["paint"];
  const localStationMarkerLegend = circleLegend(localStationMarkerPaint);
  const expressStationMarkerPaint = {
    "circle-radius": 3.5,
    "circle-color": "#ffffff",
    "circle-stroke-color": "#000000",
    "circle-stroke-width": 1.5,
  } satisfies CircleLayerSpecification["paint"];
  const expressStationMarkerLegend = circleLegend(expressStationMarkerPaint);
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
  const entranceMarkerLegend = circleLegend(entranceMarkerPaint);

  return {
    label: "Subway",
    mapStyleFragment: ({ servicePeriod }) => {
      const stationDetailZoom = DETAIL_FADE_IN;

      return {
        sources: {
          subway_routes_offset: {
            type: "geojson",
            data: "/data/subway_routes_offset.geojson",
            // The default 0.375px tolerance is about 5.4m at zoom 13 in NYC, so it drops 5m segments.
            tolerance: 0,
          },
          subway_stations: { type: "geojson", data: "/data/subway_stations.geojson" },
          subway_entrances: { type: "geojson", data: "/data/subway_entrances.geojson" },
          subway_station_routes: { type: "geojson", data: "/data/subway_station_routes.geojson" },
          subway_station_markers_offset: {
            type: "geojson",
            data: "/data/subway_station_markers_offset.geojson",
          },
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
              source: "subway_routes_offset",
              layout: { "line-cap": "square", "line-join": "round" },
              paint: {
                "line-color": ["get", "color"],
                "line-width": SUBWAY_WIDTH,
                "line-offset": interpolateOnZoom([
                  [11, ["*", ["get", "offset"], 2]],
                  [14, ["*", ["get", "offset"], 5]],
                  [16, ["*", ["get", "offset"], 8]],
                ]),
              },
            },
          },
          {
            z: "feature",
            style: {
              id: "subway_stations_local_overview",
              type: "symbol",
              source: "subway_station_markers_offset",
              maxzoom: stationDetailZoom,
              filter: [
                "all",
                ["has", `label_offset_${servicePeriod}`],
                ["!=", ["get", `express_${servicePeriod}`], true],
              ],
              layout: {
                "icon-image": localStationMarkerImage,
                "icon-offset": interpolateOnZoom([
                  [11, ["get", `marker_offset_${servicePeriod}_11`]],
                  [14, ["get", `marker_offset_${servicePeriod}_14`]],
                ]),
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
              },
            },
          },
          {
            z: "feature",
            style: {
              id: "subway_stations_express_overview",
              type: "symbol",
              source: "subway_station_markers_offset",
              maxzoom: stationDetailZoom,
              filter: [
                "all",
                ["has", `label_offset_${servicePeriod}`],
                ["==", ["get", `express_${servicePeriod}`], true],
              ],
              layout: {
                "icon-image": expressStationMarkerImage,
                "icon-offset": interpolateOnZoom([
                  [11, ["get", `marker_offset_${servicePeriod}_11`]],
                  [14, ["get", `marker_offset_${servicePeriod}_14`]],
                ]),
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
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
        ],
        addStyleImages: async (map) => {
          // canvas silently falls back to a system face for a webfont it has not already loaded
          await document.fonts.load(`1em "${MAP_FONT}"`);

          if (!map.hasImage(localStationMarkerImage))
            map.addImage(localStationMarkerImage, drawStationMarker({ express: false }), {
              pixelRatio: 2,
            });
          if (!map.hasImage(expressStationMarkerImage))
            map.addImage(expressStationMarkerImage, drawStationMarker({ express: true }), {
              pixelRatio: 2,
            });

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
    },
    Controls: ({ layer, disabled, onChange }) => (
      <div style={{ display: "grid", gap: 4 }}>
        <LegendRows
          items={[
            { label: "Local station", legend: localStationMarkerLegend },
            { label: "Express station", legend: expressStationMarkerLegend },
            { label: "Entrance/exit", legend: entranceMarkerLegend },
          ]}
        />
        <label>
          Service pattern:{" "}
          <select
            aria-label="Subway service period"
            value={layer.servicePeriod}
            disabled={disabled}
            onChange={({ target }) =>
              onChange({ ...layer, servicePeriod: target.value as ServicePeriod })
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
    ),
  };
})();

export const LAYER_DEFINITIONS: {
  [Kind in LayerKind]: LayerDefinition<LayerOfKind<Kind>>;
} = {
  geography: geographyDefinition,
  streets: streetsDefinition,
  citibike_docks: citibikeDocksDefinition,
  subway: subwayDefinition,
};
