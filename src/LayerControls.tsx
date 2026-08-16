import type { Layer, ServicePeriod } from "./layer";
import { SERVICE_PERIODS } from "./layer";

export const LayerControls = ({
  layers,
  onChange,
}: {
  layers: Layer[];
  onChange: (layers: Layer[]) => void;
}) => {
  const subwayLayer = layers.find(
    (layer): layer is Extract<Layer, { kind: "subway" }> => layer.kind === "subway",
  );

  if (!subwayLayer) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 8,
        left: 100,
        padding: "2px 6px",
        background: "rgba(255, 255, 255, 0.85)",
        borderRadius: 4,
        font: "12px ui-monospace, monospace",
      }}
    >
      <select
        aria-label="Subway service period"
        value={subwayLayer.servicePeriod}
        onChange={({ target }) =>
          onChange(
            layers.map((layer) =>
              layer.kind === "subway"
                ? { ...layer, servicePeriod: target.value as ServicePeriod }
                : layer,
            ),
          )
        }
        style={{ font: "inherit" }}
      >
        {SERVICE_PERIODS.map((period) => (
          <option key={period} value={period}>
            {period.replace("_", " ")}
          </option>
        ))}
      </select>
    </div>
  );
};
