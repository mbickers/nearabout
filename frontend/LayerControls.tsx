import type { ReactNode } from "react";
import { type LayerControlContext, MAP_FONT } from "./layers/shared";
import type { MapContribution } from "./Map";
import type { GeographicBounds } from "./map_bounds";
import type { LayerKey } from "./map_state";

export type Layer = {
  key: LayerKey;
  label: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  contribution?: MapContribution;
  renderControls: (context: LayerControlContext) => ReactNode;
};

const LayerControl = ({
  label,
  enabled,
  onEnabledChange,
  children,
}: {
  label: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  children: ReactNode;
}) => (
  <div style={{ display: "grid", gap: 4 }}>
    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        type="checkbox"
        checked={enabled}
        onChange={({ target }) => onEnabledChange(target.checked)}
      />
      {label}
    </label>
    <div style={{ display: "grid", gap: 4, marginLeft: 22 }}>{children}</div>
  </div>
);

export const LayerControls = ({
  layers,
  visibleMapBounds,
  entireSearchBounds,
}: {
  layers: Layer[];
  visibleMapBounds?: GeographicBounds;
  entireSearchBounds: GeographicBounds;
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
    {layers.map(({ key, label, enabled, onEnabledChange, renderControls }) => (
      <LayerControl key={key} label={label} enabled={enabled} onEnabledChange={onEnabledChange}>
        {renderControls({ visibleMapBounds, entireSearchBounds })}
      </LayerControl>
    ))}
  </div>
);
