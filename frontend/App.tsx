import type { Map as MapInstance } from "maplibre-gl";
import { useCallback, useMemo, useRef, useState } from "react";
import { LayerControls } from "./LayerControls";
import type { Layer } from "./layer";
import { type LayerMarkerOverrides, mapStyleFragmentsForLayers } from "./layers";
import { fitMapViewToPoints, Map, type MapPoint } from "./Map";
import { type GeographicBounds, movementBoundsWithMargin, NYC_BOUNDS } from "./map_bounds";

export const App = () => {
  const [layerMarkerOverrides, setLayerMarkerOverrides] = useState<LayerMarkerOverrides>({});
  const [visibleMapBounds, setVisibleMapBounds] = useState<GeographicBounds>();
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
    () => mapStyleFragmentsForLayers(layers, layerMarkerOverrides),
    [layers, layerMarkerOverrides],
  );

  return (
    <>
      <Map
        styleFragments={styleFragments}
        initialViewState={{ longitude: -73.98, latitude: 40.74, zoom: 11 }}
        minZoom={9}
        movementBounds={movementBoundsWithMargin(NYC_BOUNDS, 0.2)}
        onMapLoad={(map) => {
          mapRef.current = map;
        }}
        onSettledBoundsChange={setVisibleMapBounds}
      />
      <LayerControls
        layers={layers}
        visibleMapBounds={visibleMapBounds}
        entireSearchBounds={NYC_BOUNDS}
        onChange={setLayers}
        onMarkerOverrideChange={(layerKind, markers) =>
          setLayerMarkerOverrides((currentOverrides) => {
            if (markers === undefined) {
              if (currentOverrides[layerKind] === undefined) return currentOverrides;

              const { [layerKind]: _, ...remainingOverrides } = currentOverrides;
              return remainingOverrides;
            }
            return currentOverrides[layerKind] === markers
              ? currentOverrides
              : { ...currentOverrides, [layerKind]: markers };
          })
        }
        fitMapToPoints={fitMapToPoints}
      />
    </>
  );
};
