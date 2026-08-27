import type { LngLatBounds, Map as MapInstance } from "maplibre-gl";
import { useCallback, useMemo, useRef, useState } from "react";
import { LayerControls } from "./LayerControls";
import type { Layer } from "./layer";
import { LAYER_DEFINITIONS } from "./layers";
import {
  fitMapViewToPoints,
  Map,
  type MapMarker,
  type MapPoint,
  type MapStyleFragment,
} from "./Map";

export const App = () => {
  const [markerPreview, setMarkerPreview] = useState<MapMarker[]>();
  const [visibleMapBounds, setVisibleMapBounds] = useState<LngLatBounds>();
  const mapRef = useRef<MapInstance>(null);
  const fitMapToPoints = useCallback(
    (options: { points: MapPoint[]; paddingFraction: number; maxZoom: number }) =>
      mapRef.current && fitMapViewToPoints(mapRef.current, options),
    [],
  );
  const [layers, setLayers] = useState<[enabled: boolean, layer: Layer][]>([
    [true, { kind: "geography", parksVisible: true }],
    [true, { kind: "subway", servicePeriod: "regular" }],
    [true, { kind: "streets", bikeLanesVisible: true }],
    [true, { kind: "citibike_docks" }],
    [true, { kind: "points_of_interest", items: [] }],
  ]);
  const styleFragments = useMemo(
    () =>
      layers
        .filter(([enabled]) => enabled)
        .map(([, layer]) =>
          (
            LAYER_DEFINITIONS[layer.kind].mapStyleFragment as (
              currentLayer: Layer,
            ) => MapStyleFragment
          )(layer),
        ),
    [layers],
  );

  return (
    <>
      <Map
        styleFragments={styleFragments}
        markerPreview={markerPreview}
        onMapLoad={(map) => {
          mapRef.current = map;
        }}
        onSettledBoundsChange={setVisibleMapBounds}
      />
      <LayerControls
        layers={layers}
        visibleMapBounds={visibleMapBounds}
        onChange={setLayers}
        onMarkerPreviewChange={setMarkerPreview}
        fitMapToPoints={fitMapToPoints}
      />
    </>
  );
};
