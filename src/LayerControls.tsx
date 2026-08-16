import type { Layer } from "./layer";
import { LAYER_DEFINITIONS, LayerSpecificControls } from "./layer_definitions";

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
            {LAYER_DEFINITIONS[layer.kind].label}
          </label>
          <div style={{ marginLeft: 22 }}>
            <LayerSpecificControls
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
          </div>
        </div>
      );
    })}
  </div>
);
