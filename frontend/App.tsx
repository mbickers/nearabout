import { useMemo, useState } from "react";
import { LayerControls } from "./LayerControls";
import type { Layer } from "./layer";
import { type LayerContributionOverrides, mapContributionsForLayers } from "./layers";
import { Map } from "./Map";
import { type GeographicBounds, movementBoundsWithMargin, NYC_BOUNDS } from "./map_bounds";

export const App = () => {
  const [layerContributionOverrides, setLayerContributionOverrides] =
    useState<LayerContributionOverrides>({});
  const [visibleMapBounds, setVisibleMapBounds] = useState<GeographicBounds>();
  const [layers, setLayers] = useState<[enabled: boolean, layer: Layer][]>([
    [true, { kind: "geography", parksVisible: true }],
    [true, { kind: "subway", servicePeriod: "regular" }],
    [true, { kind: "streets", bikeLanesVisible: true }],
    [true, { kind: "citibike_docks" }],
    [true, { kind: "points_of_interest", items: [] }],
  ]);
  const mapContributions = useMemo(
    () => mapContributionsForLayers(layers, layerContributionOverrides),
    [layers, layerContributionOverrides],
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
        onChange={setLayers}
        onContributionOverrideChange={(layerKind, override) =>
          setLayerContributionOverrides((currentOverrides) => {
            if (override === undefined) {
              if (currentOverrides[layerKind] === undefined) return currentOverrides;

              const { [layerKind]: _, ...remainingOverrides } = currentOverrides;
              return remainingOverrides;
            }
            return currentOverrides[layerKind] === override
              ? currentOverrides
              : { ...currentOverrides, [layerKind]: override };
          })
        }
      />
    </>
  );
};
