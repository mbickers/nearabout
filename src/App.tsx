import { useMemo, useState } from "react";
import { LayerControls } from "./LayerControls";
import type { Layer } from "./layer";
import { mapStyleFragmentForLayer } from "./layer_definitions";
import { Map } from "./Map";

const INITIAL_LAYERS: [enabled: boolean, layer: Layer][] = [
  [true, { kind: "geography" }],
  [true, { kind: "parks" }],
  [true, { kind: "streets" }],
  [true, { kind: "bike_lanes" }],
  [true, { kind: "subway", servicePeriod: "regular" }],
];

export const App = () => {
  const [layers, setLayers] = useState(INITIAL_LAYERS);
  const styleFragments = useMemo(
    () => layers.filter(([enabled]) => enabled).map(([, layer]) => mapStyleFragmentForLayer(layer)),
    [layers],
  );

  return (
    <>
      <Map styleFragments={styleFragments} />
      <LayerControls layers={layers} onChange={setLayers} />
    </>
  );
};
