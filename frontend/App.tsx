import { useMemo, useState } from "react";
import { LayerControls } from "./LayerControls";
import type { Layer } from "./layer";
import { LAYER_DEFINITIONS } from "./layers";
import { Map, type MapMarker, type MapStyleFragment } from "./Map";

export const App = () => {
  const [markerPreview, setMarkerPreview] = useState<MapMarker[]>();
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
      <Map styleFragments={styleFragments} markerPreview={markerPreview} />
      <LayerControls
        layers={layers}
        onChange={setLayers}
        onMarkerPreviewChange={setMarkerPreview}
      />
    </>
  );
};
