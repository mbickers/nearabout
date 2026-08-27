import type { LngLatBounds } from "maplibre-gl";
import type { ComponentType } from "react";
import type { Layer } from "./layer";
import { LAYER_DEFINITIONS } from "./layers";
import { MAP_FONT } from "./layers/shared";
import type { MapMarker, MapPoint } from "./Map";

export const LayerControls = ({
  layers,
  visibleMapBounds,
  onChange,
  onMarkerPreviewChange,
  fitMapToPoints,
}: {
  layers: [enabled: boolean, layer: Layer][];
  visibleMapBounds?: LngLatBounds;
  onChange: (layers: [enabled: boolean, layer: Layer][]) => void;
  onMarkerPreviewChange: (markers?: MapMarker[]) => void;
  fitMapToPoints: (options: {
    points: MapPoint[];
    paddingFraction: number;
    maxZoom: number;
  }) => void;
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
      const Controls = definition.Controls as
        | ComponentType<{
            layer: Layer;
            disabled: boolean;
            visibleMapBounds?: LngLatBounds;
            onChange: (layer: Layer) => void;
            onMarkerPreviewChange: (markers?: MapMarker[]) => void;
            fitMapToPoints: (options: {
              points: MapPoint[];
              paddingFraction: number;
              maxZoom: number;
            }) => void;
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
                visibleMapBounds={visibleMapBounds}
                onMarkerPreviewChange={onMarkerPreviewChange}
                fitMapToPoints={fitMapToPoints}
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
