import type { LayerSpecification, Map as MapInstance, StyleSpecification } from "maplibre-gl";
import { useMemo, useRef, useState } from "react";
import MapLibreMap from "react-map-gl/maplibre";

export type LayerZ = "background" | "feature" | "label";

export type PhysicalLayer = { z: LayerZ; style: LayerSpecification };

export type MapStyleFragment = {
  sources: StyleSpecification["sources"];
  physicalLayers: PhysicalLayer[];
  addStyleHook?: (map: MapInstance) => void;
};

export const Map = ({ styleFragments }: { styleFragments: MapStyleFragment[] }) => {
  const initialZoom = 11;
  const [zoom, setZoom] = useState(initialZoom);
  const styleFragmentsRef = useRef(styleFragments);
  styleFragmentsRef.current = styleFragments;
  // react-map-gl reloads the style when the prop changes identity, which every pan and zoom
  // would otherwise trigger
  const mapStyle = useMemo(() => {
    const zOrder: Record<LayerZ, number> = { background: 0, feature: 1, label: 2 };

    return {
      version: 8 as const,
      glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
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
        dragRotate={false}
        touchPitch={false}
        maxPitch={0}
        onMove={({ viewState }) => setZoom(viewState.zoom)}
        onLoad={({ target }) => {
          // pinch-zoom and keyboard panning stay on, so these two cannot be disabled by prop
          target.touchZoomRotate.disableRotation();
          target.keyboard.disableRotation();

          for (const { addStyleHook } of styleFragmentsRef.current) addStyleHook?.(target);
          target.on("style.load", () => {
            for (const { addStyleHook } of styleFragmentsRef.current) addStyleHook?.(target);
          });
        }}
      />
      <div
        style={{
          position: "fixed",
          right: 10,
          top: 10,
          display: "grid",
          gap: 2,
          padding: "2px 6px",
          background: "#ffffff",
          font: "12px ui-monospace, monospace",
        }}
      >
        <strong>debug</strong>
        <span>branch: {import.meta.env.VITE_GIT_BRANCH}</span>
        <span>zoom: {zoom.toFixed(2)}</span>
      </div>
    </>
  );
};
