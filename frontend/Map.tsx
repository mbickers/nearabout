import {
  type LayerSpecification,
  LngLatBounds,
  type Map as MapInstance,
  type StyleSpecification,
} from "maplibre-gl";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import MapLibreMap from "react-map-gl/maplibre";
import { MAP_FONT } from "./layers/shared";
import type { GeographicBounds } from "./map_bounds";

type LayerZ = "background" | "street" | "feature" | "label" | "debug";

interface PhysicalLayer {
  z: LayerZ;
  style: LayerSpecification;
}

interface MapPoint {
  longitude: number;
  latitude: number;
}

type MapView = MapPoint & { zoom: number };

interface MapViewRequest {
  id: string;
  points: MapPoint[];
  paddingFraction: number;
  maxZoom: number;
}

const fitMapViewToPoints = (
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

interface MapContribution {
  sources: StyleSpecification["sources"];
  physicalLayers: PhysicalLayer[];
  markerElements?: ReactElement[];
  viewRequest?: MapViewRequest;
  addStyleImages?: (map: MapInstance) => void | Promise<void>;
}

const geographicBoundsFor = (map: MapInstance): GeographicBounds => {
  const bounds = map.getBounds();
  return {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
  };
};

interface SettledMapState {
  bounds: GeographicBounds;
  view: MapView;
}

const settledMapStateFor = (map: MapInstance): SettledMapState => {
  const center = map.getCenter();
  return {
    bounds: geographicBoundsFor(map),
    view: { longitude: center.lng, latitude: center.lat, zoom: map.getZoom() },
  };
};

const Map = ({
  contributions,
  styleContributions,
  viewState,
  minZoom,
  movementBounds,
  onSettledChange,
}: {
  contributions: MapContribution[];
  styleContributions: MapContribution[];
  viewState: MapView;
  minZoom: number;
  movementBounds: [west: number, south: number, east: number, north: number];
  onSettledChange: (settled: SettledMapState) => void;
}) => {
  const [map, setMap] = useState<MapInstance>();
  const [zoom, setZoom] = useState(viewState.zoom);
  const [bounds, setBounds] = useState<GeographicBounds>();
  const appliedViewRequestIds = useRef(new Set<string>());
  const contributionsRef = useRef(contributions);
  contributionsRef.current = contributions;
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
      sources: Object.assign({}, ...styleContributions.map(({ sources }) => sources)),
      layers: styleContributions
        .flatMap(({ physicalLayers }) => physicalLayers)
        .sort((first, second) => zOrder[first.z] - zOrder[second.z])
        .map(({ style }) => style),
    };
  }, [styleContributions]);

  useEffect(() => {
    if (!map) return;

    for (const { viewRequest } of contributions) {
      if (!viewRequest || appliedViewRequestIds.current.has(viewRequest.id)) continue;

      appliedViewRequestIds.current.add(viewRequest.id);
      fitMapViewToPoints(map, viewRequest);
    }
  }, [map, contributions]);

  useEffect(() => {
    if (!map) return;
    const center = map.getCenter();
    if (
      center.lng !== viewState.longitude ||
      center.lat !== viewState.latitude ||
      map.getZoom() !== viewState.zoom
    )
      map.jumpTo({ center: [viewState.longitude, viewState.latitude], zoom: viewState.zoom });
  }, [map, viewState.latitude, viewState.longitude, viewState.zoom]);

  return (
    <>
      <MapLibreMap
        initialViewState={viewState}
        mapStyle={mapStyle}
        style={{ position: "fixed", inset: 0 }}
        minZoom={minZoom}
        maxBounds={movementBounds}
        dragRotate={false}
        touchPitch={false}
        maxPitch={0}
        // Preserve focus in the layer controls while the user pans the map.
        onMouseDown={({ originalEvent }) => originalEvent.preventDefault()}
        onMove={({ target, viewState: nextViewState }) => {
          setZoom(nextViewState.zoom);
          setBounds(geographicBoundsFor(target));
        }}
        onMoveEnd={({ target }) => onSettledChange(settledMapStateFor(target))}
        onStyleData={({ target }) => {
          target.setMissingStyleImageResolver(async () => {
            await Promise.all(
              contributionsRef.current.map(({ addStyleImages }) => addStyleImages?.(target)),
            );
          });
        }}
        onLoad={({ target }) => {
          const settled = settledMapStateFor(target);
          setBounds(settled.bounds);
          onSettledChange(settled);
          setMap(target);
          // pinch-zoom and keyboard panning stay on, so these two cannot be disabled by prop
          target.touchZoomRotate.disableRotation();
          target.keyboard.disableRotation();
        }}
      >
        {contributions.flatMap(({ markerElements = [] }) => markerElements)}
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
          {bounds
            ? [bounds.west, bounds.south, bounds.east, bounds.north]
                .map((degrees) => degrees.toFixed(4))
                .join(", ")
            : null}
        </span>
      </div>
    </>
  );
};

export type {
  LayerZ,
  MapContribution,
  MapPoint,
  MapView,
  MapViewRequest,
  PhysicalLayer,
  SettledMapState,
};
export { Map };
