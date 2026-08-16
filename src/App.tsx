import { useMemo, useState } from "react";
import { LayerControls } from "./LayerControls";
import type { Layer } from "./layer";
import { Map, mapStyleFragmentForLayer } from "./Map";

const INITIAL_LAYERS: Layer[] = [
  { kind: "geography" },
  { kind: "parks" },
  { kind: "streets" },
  { kind: "bike_lanes" },
  { kind: "subway", servicePeriod: "regular" },
];

export const App = () => {
  const [layers, setLayers] = useState(INITIAL_LAYERS);
  const styleFragments = useMemo(() => layers.map(mapStyleFragmentForLayer), [layers]);

  return (
    <>
      <Map styleFragments={styleFragments} />
      <LayerControls layers={layers} onChange={setLayers} />
    </>
  );
};
