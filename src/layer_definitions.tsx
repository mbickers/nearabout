import { layers, namedFlavor } from "@protomaps/basemaps";
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";
import type { ComponentType, ReactNode } from "react";
import subwayBullets from "../public/data/subway_bullets.json";
import type { Layer, ServicePeriod } from "./layer";
import { SERVICE_PERIODS } from "./layer";
import type { MapStyleFragment } from "./Map";

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

const basemapPhysicalLayers = (() => {
  const flavor = { ...namedFlavor("light"), background: "#ffffff", earth: "#ffffff" };

  return layers(SOURCE_ID, flavor, { lang: "en" })
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
        return { ...layer, paint: { ...layer.paint, "fill-color": flavor.pier } };
      }
      return layer;
    })
    .map((style, index) => ({
      z: isStreetLayer(style) ? 2 + index / 1000 : index / 1000,
      style,
    }));
})();

const BASEMAP_SOURCES: MapStyleFragment["sources"] = {
  [SOURCE_ID]: {
    type: "vector",
    url: "pmtiles:///tiles/nyc.pmtiles",
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
  mapStyleFragment: () => ({
    sources: BASEMAP_SOURCES,
    physicalLayers: basemapPhysicalLayers.filter(
      ({ style }) =>
        style.id !== "landuse_park" && !isStreetLayer(style) && !isStreetLabelLayer(style),
    ),
  }),
};

const parksDefinition: LayerDefinition<LayerOfKind<"parks">> = {
  label: "Parks",
  mapStyleFragment: () => ({
    sources: BASEMAP_SOURCES,
    physicalLayers: basemapPhysicalLayers.filter(({ style }) => style.id === "landuse_park"),
  }),
};

const streetsDefinition: LayerDefinition<LayerOfKind<"streets">> = {
  label: "Streets",
  mapStyleFragment: () => ({
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
  }),
};

const bikeLanesDefinition: LayerDefinition<LayerOfKind<"bike_lanes">> = (() => {
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

  return {
    label: "Bike lanes",
    mapStyleFragment: () => {
      return {
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
              paint: protectedBikeLanePaint,
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
              paint: unprotectedBikeLanePaint,
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
            map.addImage("bike_caret", drawCaret({ color: bikeColor }), {
              pixelRatio: CARET_RESOLUTION,
            });
          }
        },
      };
    },
    Controls: () => (
      <LegendRows
        items={[
          { label: "Protected", legend: protectedBikeLaneLegend },
          { label: "Unprotected", legend: unprotectedBikeLaneLegend },
        ]}
      />
    ),
  };
})();

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
  const bulletPixels = 44;
  const canvas = document.createElement("canvas");
  canvas.width = bulletPixels;
  canvas.height = bulletPixels;
  const context = canvas.getContext("2d")!;
  const center = bulletPixels / 2;
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
  context.font = `600 ${bulletPixels * 0.55}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(route.replace(/X$/, ""), center, center);

  return context.getImageData(0, 0, bulletPixels, bulletPixels);
};

const subwayDefinition: LayerDefinition<LayerOfKind<"subway">> = (() => {
  const localStationMarkerPaint = {
    "circle-radius": 3.75,
    "circle-color": "#000000",
  } satisfies CircleLayerSpecification["paint"];
  const localStationMarkerLegend = (
    <svg width="14" height="14" aria-hidden="true">
      <circle
        cx="7"
        cy="7"
        r={localStationMarkerPaint["circle-radius"]}
        fill={localStationMarkerPaint["circle-color"]}
      />
    </svg>
  );
  const expressStationMarkerPaint = {
    "circle-radius": 3.5,
    "circle-color": "#ffffff",
    "circle-stroke-color": "#000000",
    "circle-stroke-width": 1.5,
  } satisfies CircleLayerSpecification["paint"];
  const expressStationMarkerLegend = (
    <svg width="14" height="14" aria-hidden="true">
      <circle
        cx="7"
        cy="7"
        r={expressStationMarkerPaint["circle-radius"]}
        fill={expressStationMarkerPaint["circle-color"]}
        stroke={expressStationMarkerPaint["circle-stroke-color"]}
        strokeWidth={expressStationMarkerPaint["circle-stroke-width"]}
      />
    </svg>
  );
  const entranceRadiusAtDetailZoom = 3.5;
  const entranceStrokeWidthAtDetailZoom = 1;
  const entranceColor = "#888888";
  const entranceStrokeColor = "#222222";
  const entranceMarkerPaint = {
    "circle-radius": interpolateOnZoom([
      [14, entranceRadiusAtDetailZoom],
      [18, 7],
    ]),
    "circle-color": entranceColor,
    "circle-stroke-color": entranceStrokeColor,
    "circle-stroke-width": interpolateOnZoom([
      [14, entranceStrokeWidthAtDetailZoom],
      [18, 1.5],
    ]),
    "circle-opacity": DETAIL_FADE,
    "circle-stroke-opacity": DETAIL_FADE,
  } satisfies CircleLayerSpecification["paint"];
  const entranceMarkerLegend = (
    <svg width="14" height="14" aria-hidden="true">
      <circle
        cx="7"
        cy="7"
        r={entranceRadiusAtDetailZoom}
        fill={entranceColor}
        stroke={entranceStrokeColor}
        strokeWidth={entranceStrokeWidthAtDetailZoom}
      />
    </svg>
  );

  return {
    label: "Subway",
    mapStyleFragment: ({ servicePeriod }) => {
      const stationDetailZoom = DETAIL_FADE_IN;

      return {
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
              maxzoom: stationDetailZoom,
              filter: [
                "all",
                ["has", `label_offset_${servicePeriod}`],
                ["!=", ["get", `express_${servicePeriod}`], true],
              ],
              paint: localStationMarkerPaint,
            },
          },
          {
            z: 60,
            style: {
              id: "subway_stations_express_overview",
              type: "circle",
              source: "subway_station_routes",
              maxzoom: stationDetailZoom,
              filter: [
                "all",
                ["has", `label_offset_${servicePeriod}`],
                ["==", ["get", `express_${servicePeriod}`], true],
              ],
              paint: expressStationMarkerPaint,
            },
          },
          {
            z: 70,
            style: {
              id: "subway_entrances",
              type: "circle",
              source: "subway_entrances",
              minzoom: DETAIL_FADE_IN,
              paint: entranceMarkerPaint,
            },
          },
          {
            z: 80,
            style: {
              id: "subway_station_routes",
              type: "symbol",
              source: "subway_station_routes",
              minzoom: stationDetailZoom,
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
              minzoom: stationDetailZoom,
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
  parks: parksDefinition,
  streets: streetsDefinition,
  bike_lanes: bikeLanesDefinition,
  subway: subwayDefinition,
};
