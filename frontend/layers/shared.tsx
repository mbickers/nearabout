import { layers, namedFlavor } from "@protomaps/basemaps";
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  LayerSpecification,
} from "maplibre-gl";
import type { ComponentType, ReactNode } from "react";
import type { Layer } from "../layer";
import type { LayerZ, MapMarker, MapStyleFragment } from "../Map";

const SOURCE_ID = "protomaps";
export const DETAIL_FADE_IN = 14;
export const DETAIL_FADE_FULL = 14.5;

// pairs rather than an object because integer-like object keys sort ahead of fractional ones,
// which would silently reorder stops like 14.5 and 15 into a descending list maplibre rejects
export const interpolateOnZoom = (
  stops: [zoom: number, value: number | ExpressionSpecification][],
) => ["interpolate", ["linear"], ["zoom"], ...stops.flat()] as unknown as ExpressionSpecification;

export const DETAIL_FADE = interpolateOnZoom([
  [DETAIL_FADE_IN, 0],
  [DETAIL_FADE_FULL, 1],
]);

export const DETAIL_LABEL_SIZE = interpolateOnZoom([
  [DETAIL_FADE_IN, 13],
  [17, 17],
]);

const ROUTE_WIDTH_AT_DETAIL_ZOOM = 3;
export const ROUTE_WIDTH_STOPS: [zoom: number, width: number][] = [
  [10, 1],
  [14, ROUTE_WIDTH_AT_DETAIL_ZOOM],
  [18, 6],
];

// names both the glyph tiles data/fetch_map_fonts.py generates and the @font-face
// frontend/index.css declares for the canvas bullets and the overlay panels
export const MAP_FONT = "Inter Medium";

export const PROTOMAPS_FLAVOR = {
  ...namedFlavor("light"),
  background: "#ffffff",
  earth: "#ffffff",
  regular: MAP_FONT,
  bold: MAP_FONT,
  italic: MAP_FONT,
};
const PROTOMAPS_LAYERS = layers(SOURCE_ID, PROTOMAPS_FLAVOR, { lang: "en" });

export const protomapsLayer = <Style extends LayerSpecification = LayerSpecification>(
  id: string,
  z: LayerZ,
): { z: LayerZ; style: Style } => ({
  z,
  style: PROTOMAPS_LAYERS.find((layer) => layer.id === id)! as Style,
});

export const PROTOMAPS_SOURCES: MapStyleFragment["sources"] = {
  [SOURCE_ID]: {
    type: "vector",
    url: "pmtiles:///data/nyc.pmtiles",
    attribution:
      '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  },
};

export type LayerKind = Layer["kind"];

export type LayerOfKind<Kind extends LayerKind> = Extract<Layer, { kind: Kind }>;

export type LayerComponentProps<CurrentLayer extends Layer> = {
  layer: CurrentLayer;
  disabled: boolean;
  onChange: (layer: CurrentLayer) => void;
  onMarkerPreviewChange: (markers?: MapMarker[]) => void;
};

export type LayerDefinition<CurrentLayer extends Layer> = {
  label: string;
  mapStyleFragment: (layer: CurrentLayer) => MapStyleFragment;
  Controls?: ComponentType<LayerComponentProps<CurrentLayer>>;
};

export const circleLegend = (paint: NonNullable<CircleLayerSpecification["paint"]>) => {
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

export const LegendRows = ({ items }: { items: { label: string; legend: ReactNode }[] }) => (
  <div style={{ display: "grid", gap: 3 }}>
    {items.map(({ label, legend }) => (
      <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {legend}
        {label}
      </div>
    ))}
  </div>
);
