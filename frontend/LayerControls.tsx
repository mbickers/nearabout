import type { ComponentType } from "react";
import type { Layer } from "./layer";
import { LAYER_DEFINITIONS } from "./layers";
import { type LayerComponentProps, MAP_FONT } from "./layers/shared";
import type { MapContributionOverride } from "./Map";
import type { GeographicBounds } from "./map_bounds";

export const LayerControls = ({
  layers,
  visibleMapBounds,
  entireSearchBounds,
  onChange,
  onContributionOverrideChange,
}: {
  layers: [enabled: boolean, layer: Layer][];
  visibleMapBounds?: GeographicBounds;
  entireSearchBounds: GeographicBounds;
  onChange: (layers: [enabled: boolean, layer: Layer][]) => void;
  onContributionOverrideChange: (
    layerKind: Layer["kind"],
    override?: MapContributionOverride,
  ) => void;
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
    {layers.map(([enabled, layer]) => {
      const definition = LAYER_DEFINITIONS[layer.kind];
      const Controls = definition.Controls as ComponentType<LayerComponentProps<Layer>> | undefined;

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
                visibleMapBounds={visibleMapBounds}
                entireSearchBounds={entireSearchBounds}
                onMapContributionChange={(override) =>
                  onContributionOverrideChange(layer.kind, override)
                }
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
