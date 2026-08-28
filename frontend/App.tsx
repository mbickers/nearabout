import { useCallback, useMemo, useState } from "react";
import { LayerControls } from "./LayerControls";
import type { Layer } from "./layer";
import { mapContributionsForLayers } from "./layers";
import type { LayerChange, LayerKind } from "./layers/shared";
import { Map } from "./Map";
import { type GeographicBounds, movementBoundsWithMargin, NYC_BOUNDS } from "./map_bounds";

export const App = () => {
  const [visibleMapBounds, setVisibleMapBounds] = useState<GeographicBounds>();
  const [layers, setLayers] = useState<[enabled: boolean, layer: Layer][]>([
    [true, { kind: "geography", parksVisible: true }],
    [true, { kind: "subway", servicePeriod: "regular" }],
    [true, { kind: "streets", bikeLanesVisible: true }],
    [true, { kind: "citibike_docks" }],
    [true, { kind: "points_of_interest", items: [] }],
  ]);
  const changeLayer = useCallback((kind: LayerKind, change: LayerChange<Layer>) => {
    setLayers((currentLayers) => {
      let changed = false;
      const nextLayers = currentLayers.map(([enabled, layer]): [boolean, Layer] => {
        if (layer.kind !== kind) return [enabled, layer];

        const nextLayer = typeof change === "function" ? change(layer) : change;
        changed = nextLayer !== layer;
        return [enabled, nextLayer];
      });
      return changed ? nextLayers : currentLayers;
    });
  }, []);
  const changeLayerEnabled = useCallback((kind: LayerKind, enabled: boolean) => {
    setLayers((currentLayers) => {
      let changed = false;
      const nextLayers = currentLayers.map(([currentEnabled, layer]): [boolean, Layer] => {
        if (layer.kind !== kind || currentEnabled === enabled) return [currentEnabled, layer];

        changed = true;
        return [enabled, layer];
      });
      return changed ? nextLayers : currentLayers;
    });
  }, []);
  const mapContributions = useMemo(
    () => mapContributionsForLayers(layers, changeLayer),
    [layers, changeLayer],
  );

  return (
    <>
      <Map
        contributions={mapContributions}
        initialViewState={{ longitude: -73.98, latitude: 40.74, zoom: 11 }}
        minZoom={9}
        movementBounds={movementBoundsWithMargin(NYC_BOUNDS, 0.2)}
        onSettledBoundsChange={setVisibleMapBounds}
      />
      <LayerControls
        layers={layers}
        visibleMapBounds={visibleMapBounds}
        entireSearchBounds={NYC_BOUNDS}
        onLayerChange={changeLayer}
        onLayerEnabledChange={changeLayerEnabled}
      />
    </>
  );
};
