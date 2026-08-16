import { useMemo, useState } from "react";
import { LayerControls } from "./LayerControls";
import type { Layer } from "./layer";
import { LAYER_DEFINITIONS } from "./layer_definitions";
import { Map, type MapStyleFragment } from "./Map";

export const App = () => {
  const [layers, setLayers] = useState<[enabled: boolean, layer: Layer][]>([
    [true, { kind: "geography", parksVisible: true }],
    [true, { kind: "streets" }],
    [true, { kind: "bike_lanes" }],
    [true, { kind: "subway", servicePeriod: "regular" }],
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
      <Map styleFragments={styleFragments} />
      <LayerControls layers={layers} onChange={setLayers} />
    </>
  );
};
