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
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Layer, ServicePeriod } from "./layer";
import { SERVICE_PERIODS } from "./layer";
import type { LayerZ, MapMarker, MapStyleFragment, PhysicalLayer } from "./Map";

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

const PROTOMAPS_FLAVOR = { ...namedFlavor("light"), background: "#ffffff", earth: "#ffffff" };
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
  onMarkerPreviewChange: (markers?: MapMarker[]) => void;
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

const streetLayer = (id: string, filter: FilterSpecification): PhysicalLayer => {
  const layer = protomapsLayer<LineLayerSpecification>(id, "feature");

  return {
    ...layer,
    style: {
      ...layer.style,
      minzoom: DETAIL_FADE_IN,
      // only the surface minor layer excludes service in its own filter, so the bridge and
      // tunnel variants would otherwise render driveways and roadways inside a pier shed
      filter: ["all", filter, ["!=", ["get", "kind_detail"], "service"]] as FilterSpecification,
      // the stock paint varies from white to grey by class and by tunnel
      paint: {
        "line-color": STREET_COLOR,
        "line-width": layer.style.paint?.["line-width"],
        "line-opacity": DETAIL_FADE,
      },
    },
  };
};

const streetLabelLayer = (id: string): PhysicalLayer => {
  const layer = protomapsLayer<SymbolLayerSpecification>(id, "label");

  return {
    ...layer,
    style: {
      ...layer.style,
      // minor names have a higher stock minzoom than the streets
      minzoom: Math.max(layer.style.minzoom ?? 0, DETAIL_FADE_IN),
      paint: { ...layer.style.paint, "text-opacity": DETAIL_FADE },
    },
  };
};

const streetsDefinition: LayerDefinition<LayerOfKind<"streets">> = {
  label: "Streets",
  mapStyleFragment: () => {
    const minorStreetLabels = streetLabelLayer("roads_labels_minor");

    return {
      sources: PROTOMAPS_SOURCES,
      physicalLayers: [
        streetLayer("roads_tunnels_minor", [
          "all",
          ["has", "is_tunnel"],
          ["==", ["get", "kind"], "minor_road"],
        ]),
        streetLayer("roads_tunnels_link", ["all", ["has", "is_tunnel"], ["has", "is_link"]]),
        streetLayer("roads_tunnels_major", [
          "all",
          ["has", "is_tunnel"],
          ["==", ["get", "kind"], "major_road"],
        ]),
        streetLayer("roads_tunnels_highway", [
          "all",
          ["has", "is_tunnel"],
          ["==", ["get", "kind"], "highway"],
          ["!", ["has", "is_link"]],
        ]),
        streetLayer("roads_link", ["has", "is_link"]),
        streetLayer("roads_minor", [
          "all",
          ["!", ["has", "is_tunnel"]],
          ["!", ["has", "is_bridge"]],
          ["==", ["get", "kind"], "minor_road"],
        ]),
        streetLayer("roads_major", [
          "all",
          ["!", ["has", "is_tunnel"]],
          ["!", ["has", "is_bridge"]],
          ["==", ["get", "kind"], "major_road"],
        ]),
        streetLayer("roads_highway", [
          "all",
          ["!", ["has", "is_tunnel"]],
          ["!", ["has", "is_bridge"]],
          ["==", ["get", "kind"], "highway"],
          ["!", ["has", "is_link"]],
        ]),
        streetLayer("roads_bridges_minor", [
          "all",
          ["has", "is_bridge"],
          ["==", ["get", "kind"], "minor_road"],
        ]),
        streetLayer("roads_bridges_link", ["all", ["has", "is_bridge"], ["has", "is_link"]]),
        streetLayer("roads_bridges_major", [
          "all",
          ["has", "is_bridge"],
          ["==", ["get", "kind"], "major_road"],
        ]),
        streetLayer("roads_bridges_highway", [
          "all",
          ["has", "is_bridge"],
          ["==", ["get", "kind"], "highway"],
          ["!", ["has", "is_link"]],
        ]),
        {
          z: "feature",
          style: {
            id: "street_one_way",
            type: "symbol",
            source: SOURCE_ID,
            "source-layer": "roads",
            minzoom: DETAIL_FADE_IN,
            // the same street kinds rendered above, so that no caret is drawn over an absent street.
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
        {
          ...minorStreetLabels,
          style: {
            ...minorStreetLabels.style,
            // the minor filter also matches path and service-road labels, which have no line beneath
            filter: [
              "all",
              ["==", ["get", "kind"], "minor_road"],
              ["!=", ["get", "kind_detail"], "service"],
            ] as FilterSpecification,
          },
        },
        streetLabelLayer("roads_labels_major"),
      ],
      addStyleImages: (map) => {
        if (map.hasImage("street_caret")) return;
        map.addImage("street_caret", drawCaret({ color: STREET_COLOR }), {
          pixelRatio: CARET_RESOLUTION,
        });
      },
    };
  },
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
            z: "feature",
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
            z: "feature",
            style: {
              id: "bike_routes_unprotected",
              type: "line",
              source: "bike_routes",
              minzoom: DETAIL_FADE_IN,
              filter: [
                "all",
                ["!=", ["get", "facilitycl"], "I"],
                // Class III is shared lanes
                ["!=", ["get", "facilitycl"], "III"],
              ],
              paint: unprotectedBikeLanePaint,
            },
          },
          {
            z: "feature",
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
        addStyleImages: (map) => {
          if (!map.hasImage("bike_caret")) {
            map.addImage("bike_caret", drawCaret({ color: bikeColor }), {
              pixelRatio: CARET_RESOLUTION,
            });
          }
        },
      };
    },
    Controls: () => (
      <div style={{ display: "grid", gap: 3 }}>
        <LegendRows
          items={[
            { label: "Protected", legend: protectedBikeLaneLegend },
            { label: "Unprotected", legend: unprotectedBikeLaneLegend },
          ]}
        />
        <div>Shared lanes (sharrows) not shown.</div>
      </div>
    ),
  };
})();

const citibikeDocksDefinition: LayerDefinition<LayerOfKind<"citibike_docks">> = (() => {
  const stationColor = "#0067b1";
  const stationMarkerPaint = {
    "circle-radius": interpolateOnZoom([
      [DETAIL_FADE_IN, 5.25],
      [18, 10.5],
    ]),
    "circle-color": stationColor,
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 0.75,
  } satisfies CircleLayerSpecification["paint"];

  return {
    label: "Citi Bike docks",
    mapStyleFragment: () => ({
      sources: {
        citibike_stations: {
          type: "geojson",
          data: "/data/citibike_stations.geojson",
          attribution: '<a href="https://citibikenyc.com/system-data">Citi Bike</a>',
        },
      },
      physicalLayers: [
        {
          z: "feature",
          style: {
            id: "citibike_stations",
            type: "circle",
            source: "citibike_stations",
            minzoom: DETAIL_FADE_IN,
            paint: stationMarkerPaint,
          },
        },
      ],
    }),
    Controls: () => (
      <LegendRows
        items={[
          {
            label: "Station",
            legend: circleLegend(stationMarkerPaint),
          },
        ]}
      />
    ),
  };
})();

type NominatimSearchResult = {
  display_name: string;
  lat: string;
  lon: string;
};

type PointOfInterestRow = {
  id: string;
  address: string;
  label: string;
  longitude?: number;
  latitude?: number;
  searchResults: NominatimSearchResult[];
  status: "idle" | "searching" | "not_found" | "error";
};

const emptyPointOfInterestRow = (): PointOfInterestRow => ({
  id: crypto.randomUUID(),
  address: "",
  label: "",
  searchResults: [],
  status: "idle",
});

const normalizePointOfInterestRows = (rows: PointOfInterestRow[], editedRowId?: string) => {
  const nonemptyRows = rows.filter(({ address, label }) => address.trim() || label.trim());
  const emptyRow =
    rows.find(({ id, address, label }) => id === editedRowId && !address.trim() && !label.trim()) ??
    rows.find(({ address, label }) => !address.trim() && !label.trim()) ??
    emptyPointOfInterestRow();
  return [...nonemptyRows, emptyRow];
};

const PointsOfInterestControls = ({
  layer,
  disabled,
  onChange,
  onMarkerPreviewChange,
}: LayerComponentProps<LayerOfKind<"points_of_interest">>) => {
  const selectFirstResultOnCompletion = useRef(new Set<string>());
  const onChangeRef = useRef(onChange);
  const onMarkerPreviewChangeRef = useRef(onMarkerPreviewChange);
  onChangeRef.current = onChange;
  onMarkerPreviewChangeRef.current = onMarkerPreviewChange;
  const [rows, setRows] = useState<PointOfInterestRow[]>(() =>
    normalizePointOfInterestRows(
      layer.items.map((item) => ({ ...item, searchResults: [], status: "idle" as const })),
    ),
  );

  const selectSearchResult = useCallback(
    (rowId: string, result: NominatimSearchResult) =>
      setRows((currentRows) =>
        currentRows.map((currentRow) =>
          currentRow.id === rowId
            ? {
                ...currentRow,
                longitude: Number(result.lon),
                latitude: Number(result.lat),
                searchResults: [],
                status: "idle",
              }
            : currentRow,
        ),
      ),
    [],
  );

  useEffect(() => {
    onChangeRef.current({
      kind: "points_of_interest",
      items: rows.flatMap(({ status: _, searchResults: __, longitude, latitude, ...row }) =>
        row.address.trim() && longitude !== undefined && latitude !== undefined
          ? [{ ...row, label: row.label.trim() || row.address.trim(), longitude, latitude }]
          : [],
      ),
    });
  }, [rows]);

  useEffect(() => {
    if (disabled) {
      onMarkerPreviewChangeRef.current(undefined);
      return;
    }

    const activeSearchRow =
      rows.find(({ searchResults }) => searchResults.length > 0) ??
      rows.find(({ status }) => status === "searching");
    onMarkerPreviewChangeRef.current(
      activeSearchRow
        ? activeSearchRow.searchResults.map((result, resultIndex) => ({
            id: `${activeSearchRow.id}:${result.lat},${result.lon}:${resultIndex}`,
            label: result.display_name,
            longitude: Number(result.lon),
            latitude: Number(result.lat),
            onClick: () => selectSearchResult(activeSearchRow.id, result),
          }))
        : undefined,
    );
  }, [rows, disabled, selectSearchResult]);

  const searchRow = useCallback(
    async (row: PointOfInterestRow, selectFirstResult = false) => {
      if (!row.address.trim()) return;
      if (
        selectFirstResult &&
        row.longitude !== undefined &&
        row.latitude !== undefined &&
        row.searchResults.length === 0
      ) {
        return;
      }
      if (selectFirstResult && row.searchResults.length > 0) {
        selectSearchResult(row.id, row.searchResults[0]);
        return;
      }
      if (row.status === "searching") {
        if (selectFirstResult) selectFirstResultOnCompletion.current.add(row.id);
        return;
      }

      setRows((currentRows) =>
        currentRows.map((currentRow) =>
          currentRow.id === row.id
            ? { ...currentRow, searchResults: [], status: "searching" }
            : currentRow,
        ),
      );

      try {
        const parameters = new URLSearchParams({
          q: row.address,
          format: "jsonv2",
          limit: "20",
          layer: "address",
          countrycodes: "us",
          viewbox: "-74.25909,40.91758,-73.70018,40.4774",
          bounded: "1",
        });
        const response = await fetch(`https://nominatim.openstreetmap.org/search?${parameters}`);
        if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);

        const results = (await response.json()) as NominatimSearchResult[];
        const shouldSelectFirstResult =
          selectFirstResult || selectFirstResultOnCompletion.current.delete(row.id);
        setRows((currentRows) =>
          currentRows.map((currentRow) => {
            if (currentRow.id !== row.id || currentRow.address !== row.address) return currentRow;
            if (results.length === 0) {
              return { ...currentRow, searchResults: [], status: "not_found" };
            }
            if (!shouldSelectFirstResult) {
              return {
                ...currentRow,
                longitude: undefined,
                latitude: undefined,
                searchResults: results,
                status: "idle",
              };
            }

            const [result] = results;

            return {
              ...currentRow,
              longitude: Number(result.lon),
              latitude: Number(result.lat),
              searchResults: [],
              status: "idle",
            };
          }),
        );
      } catch {
        setRows((currentRows) =>
          currentRows.map((currentRow) =>
            currentRow.id === row.id && currentRow.address === row.address
              ? { ...currentRow, searchResults: [], status: "error" }
              : currentRow,
          ),
        );
      }
    },
    [selectSearchResult],
  );

  useEffect(() => {
    const rowToSearch = rows.find(
      ({ address, longitude, status, searchResults }) =>
        address.trim().length >= 3 &&
        longitude === undefined &&
        status === "idle" &&
        searchResults.length === 0,
    );
    if (!rowToSearch) return;

    const timeout = window.setTimeout(() => void searchRow(rowToSearch), 300);
    return () => window.clearTimeout(timeout);
  }, [rows, searchRow]);

  return (
    <div style={{ display: "grid", gap: 6, width: 260 }}>
      <div style={{ display: "grid", gap: 4 }}>
        {rows.map((row) => (
          <div key={row.id} style={{ display: "grid", gap: 2 }}>
            <form
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) auto",
                alignItems: "center",
                gap: 4,
              }}
              onSubmit={(event) => {
                event.preventDefault();
                void searchRow(row);
              }}
            >
              <input
                aria-label="Point of interest address"
                type="text"
                placeholder="Address"
                value={row.address}
                disabled={disabled}
                onChange={({ target }) =>
                  setRows((currentRows) =>
                    normalizePointOfInterestRows(
                      currentRows.map((currentRow) =>
                        currentRow.id === row.id
                          ? {
                              ...currentRow,
                              address: target.value,
                              longitude: undefined,
                              latitude: undefined,
                              searchResults: [],
                              status: "idle",
                            }
                          : currentRow,
                      ),
                      row.id,
                    ),
                  )
                }
                onBlur={() => void searchRow(row, true)}
                style={{ boxSizing: "border-box", minWidth: 0, width: "100%", font: "inherit" }}
              />
              <input
                aria-label="Point of interest label"
                type="text"
                placeholder="Label"
                value={row.label}
                disabled={disabled}
                onChange={({ target }) =>
                  setRows((currentRows) =>
                    normalizePointOfInterestRows(
                      currentRows.map((currentRow) =>
                        currentRow.id === row.id
                          ? { ...currentRow, label: target.value, status: "idle" }
                          : currentRow,
                      ),
                      row.id,
                    ),
                  )
                }
                style={{ boxSizing: "border-box", minWidth: 0, width: "100%", font: "inherit" }}
              />
              <button
                type="button"
                aria-label={`Delete ${row.label || row.address || "empty point of interest"}`}
                title="Delete"
                disabled={disabled}
                onClick={() =>
                  setRows((currentRows) =>
                    normalizePointOfInterestRows(currentRows.filter(({ id }) => id !== row.id)),
                  )
                }
                style={{
                  display: "grid",
                  placeItems: "center",
                  padding: 2,
                  border: 0,
                  background: "transparent",
                  color: "inherit",
                  cursor: disabled ? "default" : "pointer",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M3.5 4.5h9m-6.5 0v-1h4v1m-5.5 0 .5 8h6l.5-8M7 7v3.5m2-3.5v3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </form>
            {row.status === "searching" ? <span role="status">Searching…</span> : null}
            {row.status === "not_found" ? <span role="status">Address not found.</span> : null}
            {row.status === "error" ? (
              <span role="status">Address search failed. Try again.</span>
            ) : null}
            {row.searchResults.length > 0 ? (
              <span role="status">Select a result on the map.</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
};

const pointsOfInterestDefinition: LayerDefinition<LayerOfKind<"points_of_interest">> = {
  label: "Points of interest",
  mapStyleFragment: ({ items }) => ({ sources: {}, physicalLayers: [], markers: items }),
  Controls: PointsOfInterestControls,
};

// express routes are diamonds on the official map, everything else is a disc
type SubwayBullet = {
  route: string;
  color: string;
  text_color: string;
};

const drawBullet = ({ route, color, text_color }: SubwayBullet) => {
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
          subway_routes: { type: "geojson", data: "/data/subway_routes.geojson" },
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
            z: "feature",
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
            z: "feature",
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
            z: "label",
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
        addStyleImages: async (map) => {
          const response = await fetch("/data/subway_bullets.json");
          const subwayBullets = (await response.json()) as SubwayBullet[];
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
  streets: streetsDefinition,
  bike_lanes: bikeLanesDefinition,
  citibike_docks: citibikeDocksDefinition,
  subway: subwayDefinition,
  points_of_interest: pointsOfInterestDefinition,
};
