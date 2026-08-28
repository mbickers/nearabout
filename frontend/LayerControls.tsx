import { type ComponentType, useCallback } from "react";
import type { Layer } from "./layer";
import { LAYER_DEFINITIONS } from "./layers";
import {
  type LayerChange,
  type LayerComponentProps,
  type LayerKind,
  MAP_FONT,
} from "./layers/shared";
import type { GeographicBounds } from "./map_bounds";

type ChangeLayer = (kind: LayerKind, change: LayerChange<Layer>) => void;

const LayerControl = ({
  enabled,
  layer,
  visibleMapBounds,
  entireSearchBounds,
  onLayerChange,
  onLayerEnabledChange,
}: {
  enabled: boolean;
  layer: Layer;
  visibleMapBounds?: GeographicBounds;
  entireSearchBounds: GeographicBounds;
  onLayerChange: ChangeLayer;
  onLayerEnabledChange: (kind: LayerKind, enabled: boolean) => void;
}) => {
  const definition = LAYER_DEFINITIONS[layer.kind];
  const Controls = definition.Controls as ComponentType<LayerComponentProps<Layer>> | undefined;
  const changeLayer = useCallback(
    (change: LayerChange<Layer>) => onLayerChange(layer.kind, change),
    [layer.kind, onLayerChange],
  );

  return (
    <div style={{ display: "grid", gap: 4 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={({ target }) => onLayerEnabledChange(layer.kind, target.checked)}
        />
        {definition.label}
      </label>
      <div style={{ display: "grid", gap: 4, marginLeft: 22 }}>
        {Controls ? (
          <Controls
            layer={layer}
            disabled={!enabled}
            visibleMapBounds={visibleMapBounds}
            entireSearchBounds={entireSearchBounds}
            onChange={changeLayer}
          />
        ) : null}
      </div>
    </div>
  );
};

export const LayerControls = ({
  layers,
  visibleMapBounds,
  entireSearchBounds,
  onLayerChange,
  onLayerEnabledChange,
}: {
  layers: [enabled: boolean, layer: Layer][];
  visibleMapBounds?: GeographicBounds;
  entireSearchBounds: GeographicBounds;
  onLayerChange: ChangeLayer;
  onLayerEnabledChange: (kind: LayerKind, enabled: boolean) => void;
}) => (
  <div
    style={{
      position: "fixed",
      bottom: 10,
      left: 10,
      display: "grid",
      gap: 6,
      padding: 8,
      background: "#ffffff",
      font: `14px "${MAP_FONT}", sans-serif`,
      maxHeight: "calc(100vh - 36px)",
      overflowY: "auto",
    }}
  >
    {layers.map(([enabled, layer]) => (
      <LayerControl
        key={layer.kind}
        enabled={enabled}
        layer={layer}
        visibleMapBounds={visibleMapBounds}
        entireSearchBounds={entireSearchBounds}
        onLayerChange={onLayerChange}
        onLayerEnabledChange={onLayerEnabledChange}
      />
    ))}
  </div>
);
