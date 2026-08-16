import type { ComponentType } from "react";
import type { Layer } from "./layer";
import { LAYER_DEFINITIONS } from "./layer_definitions";

export const LayerControls = ({
  layers,
  onChange,
}: {
  layers: [enabled: boolean, layer: Layer][];
  onChange: (layers: [enabled: boolean, layer: Layer][]) => void;
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
      font: "12px ui-monospace, monospace",
    }}
  >
    {layers.map(([enabled, layer]) => {
      const definition = LAYER_DEFINITIONS[layer.kind];
      const Controls = definition.Controls as
        | ComponentType<{
            layer: Layer;
            disabled: boolean;
            onChange: (layer: Layer) => void;
          }>
        | undefined;

      return (
        <div key={layer.kind} style={{ display: "grid", gap: 4 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={({ target }) =>
                onChange(
                  layers.map(([currentEnabled, currentLayer]): [boolean, Layer] =>
                    currentLayer.kind === layer.kind
                      ? [target.checked, currentLayer]
                      : [currentEnabled, currentLayer],
                  ),
                )
              }
            />
            {definition.label}
          </label>
          <div style={{ display: "grid", gap: 4, marginLeft: 22 }}>
            {Controls ? (
              <Controls
                layer={layer}
                disabled={!enabled}
                onChange={(changedLayer) =>
                  onChange(
                    layers.map(([currentEnabled, currentLayer]): [boolean, Layer] => [
                      currentEnabled,
                      currentLayer.kind === changedLayer.kind ? changedLayer : currentLayer,
                    ]),
                  )
                }
              />
            ) : null}
          </div>
        </div>
      );
    })}
  </div>
);
