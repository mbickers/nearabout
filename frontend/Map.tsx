import {
  type LayerSpecification,
  LngLatBounds,
  type Map as MapInstance,
  type StyleSpecification,
} from "maplibre-gl";
import { useMemo, useRef, useState } from "react";
import MapLibreMap, { Marker } from "react-map-gl/maplibre";
import { MAP_FONT } from "./layers/shared";
import { NYC_BOUNDS } from "./map_bounds";

export type LayerZ = "background" | "street" | "feature" | "label" | "debug";

export type PhysicalLayer = { z: LayerZ; style: LayerSpecification };

export type MapPoint = { longitude: number; latitude: number };

export type MapMarker = MapPoint & {
  id: string;
  label: string;
  onClick?: () => void;
};

export const fitMapViewToPoints = (
  map: MapInstance,
  {
    points,
    paddingFraction,
    maxZoom,
  }: { points: MapPoint[]; paddingFraction: number; maxZoom: number },
) => {
  if (points.length === 0) return;

  const { width, height } = map.getContainer().getBoundingClientRect();
  map.fitBounds(
    points.reduce(
      (extended, { longitude, latitude }) => extended.extend([longitude, latitude]),
      new LngLatBounds(),
    ),
    {
      duration: 0,
      maxZoom,
      padding: {
        top: height * paddingFraction,
        bottom: height * paddingFraction,
        left: width * paddingFraction,
        right: width * paddingFraction,
      },
    },
  );
};

export type MapStyleFragment = {
  sources: StyleSpecification["sources"];
  physicalLayers: PhysicalLayer[];
  markers?: MapMarker[];
  addStyleImages?: (map: MapInstance) => void | Promise<void>;
};

export const Map = ({
  styleFragments,
  markerPreview,
  onMapLoad,
  onSettledBoundsChange,
}: {
  styleFragments: MapStyleFragment[];
  markerPreview?: MapMarker[];
  onMapLoad: (map: MapInstance) => void;
  onSettledBoundsChange: (bounds: LngLatBounds) => void;
}) => {
  const initialZoom = 11;
  const [zoom, setZoom] = useState(initialZoom);
  const [bounds, setBounds] = useState<LngLatBounds>();
  const styleFragmentsRef = useRef(styleFragments);
  styleFragmentsRef.current = styleFragments;
  // react-map-gl reloads the style when the prop changes identity, which every pan and zoom
  // would otherwise trigger
  const mapStyle = useMemo(() => {
    const zOrder: Record<LayerZ, number> = {
      background: 0,
      street: 1,
      feature: 2,
      label: 3,
      debug: 4,
    };

    return {
      version: 8 as const,
      glyphs: "/data/fonts/{fontstack}/{range}.pbf",
      sources: Object.assign({}, ...styleFragments.map(({ sources }) => sources)),
      layers: styleFragments
        .flatMap(({ physicalLayers }) => physicalLayers)
        .sort((first, second) => zOrder[first.z] - zOrder[second.z])
        .map(({ style }) => style),
    };
  }, [styleFragments]);

  return (
    <>
      <MapLibreMap
        initialViewState={{ longitude: -73.98, latitude: 40.74, zoom: initialZoom }}
        mapStyle={mapStyle}
        style={{ position: "fixed", inset: 0 }}
        minZoom={9}
        // the bounding box of the five boroughs, with a margin of 20 percent of its span on
        // each side, which keeps the city in the frame
        maxBounds={[
          NYC_BOUNDS.west - (NYC_BOUNDS.east - NYC_BOUNDS.west) * 0.2,
          NYC_BOUNDS.south - (NYC_BOUNDS.north - NYC_BOUNDS.south) * 0.2,
          NYC_BOUNDS.east + (NYC_BOUNDS.east - NYC_BOUNDS.west) * 0.2,
          NYC_BOUNDS.north + (NYC_BOUNDS.north - NYC_BOUNDS.south) * 0.2,
        ]}
        dragRotate={false}
        touchPitch={false}
        maxPitch={0}
        onMouseDown={({ originalEvent }) => originalEvent.preventDefault()}
        onMove={({ target, viewState }) => {
          setZoom(viewState.zoom);
          setBounds(target.getBounds());
        }}
        onMoveEnd={({ target, originalEvent }) =>
          originalEvent && onSettledBoundsChange(target.getBounds())
        }
        onStyleData={({ target }) => {
          target.setMissingStyleImageResolver(async () => {
            for (const { addStyleImages } of styleFragmentsRef.current) {
              await addStyleImages?.(target);
            }
          });
        }}
        onLoad={({ target }) => {
          setBounds(target.getBounds());
          onSettledBoundsChange(target.getBounds());
          onMapLoad(target);
          // pinch-zoom and keyboard panning stay on, so these two cannot be disabled by prop
          target.touchZoomRotate.disableRotation();
          target.keyboard.disableRotation();
        }}
      >
        {(markerPreview ?? styleFragments.flatMap(({ markers = [] }) => markers)).map(
          ({ id, label, longitude, latitude, onClick }) => (
            <Marker key={id} longitude={longitude} latitude={latitude} anchor="center">
              <button
                type="button"
                aria-label={onClick ? `Select ${label}` : undefined}
                onMouseDown={
                  onClick
                    ? (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                    : undefined
                }
                onClick={
                  onClick
                    ? (event) => {
                        event.stopPropagation();
                        onClick();
                      }
                    : undefined
                }
                style={{
                  display: "block",
                  boxSizing: "border-box",
                  maxWidth: 160,
                  padding: "3px 5px",
                  border: "1px solid #000000",
                  borderRadius: 0,
                  background: "#ffffff",
                  color: "#000000",
                  font: "13px sans-serif",
                  textAlign: "center",
                  overflowWrap: "anywhere",
                  pointerEvents: onClick ? "auto" : "none",
                  cursor: onClick ? "pointer" : "default",
                }}
              >
                {label}
              </button>
            </Marker>
          ),
        )}
      </MapLibreMap>
      <div
        style={{
          position: "fixed",
          right: 10,
          top: 10,
          display: "grid",
          gap: 2,
          padding: "2px 6px",
          background: "#ffffff",
          font: `14px "${MAP_FONT}", sans-serif`,
          fontFeatureSettings: '"tnum"',
        }}
      >
        <strong>debug</strong>
        <span>branch: {import.meta.env.VITE_GIT_BRANCH}</span>
        <span>zoom: {zoom.toFixed(2)}</span>
        <span>
          bbox:{" "}
          {bounds &&
            [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
              .map((degrees) => degrees.toFixed(4))
              .join(", ")}
        </span>
      </div>
    </>
  );
};
