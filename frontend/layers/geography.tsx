import type { FillLayerSpecification, FilterSpecification } from "maplibre-gl";
import type { MapContribution } from "../Map";
import type { GeographyState } from "../map_state";
import {
  type LayerDefinition,
  PROTOMAPS_FLAVOR,
  PROTOMAPS_SOURCES,
  protomapsLayer,
  type StateChange,
} from "./shared";

const geographyMapContribution = ({ parksVisible }: GeographyState): MapContribution => {
  const park = protomapsLayer<FillLayerSpecification>("landuse_park", "background");
  const pier = protomapsLayer<FillLayerSpecification>("landuse_pier", "background");

  return {
    sources: PROTOMAPS_SOURCES,
    physicalLayers: [
      protomapsLayer("background", "background"),
      protomapsLayer("earth", "background"),
      {
        ...park,
        style: {
          ...park.style,
          layout: { ...park.style.layout, visibility: parksVisible ? "visible" : "none" },
          // the stock filter also takes wood, grass and sand, which the paint shades separately
          // and which show up as lawns and ball fields inside a park
          filter: [
            "in",
            "kind",
            "national_park",
            "park",
            "cemetery",
            "protected_area",
            "nature_reserve",
            "forest",
            "golf_course",
          ] as FilterSpecification,
        },
      },
      protomapsLayer("landuse_aerodrome", "background"),
      // Render water after parks because Hudson River Park is a large polygon that extends into
      // the river beyond its piers, and because many parks have water features.
      protomapsLayer("water", "background"),
      protomapsLayer("water_stream", "background"),
      protomapsLayer("water_river", "background"),
      // piers are their own layer because they draw after water, which would otherwise cover them
      {
        ...pier,
        style: {
          ...pier.style,
          paint: { ...pier.style.paint, "fill-color": PROTOMAPS_FLAVOR.earth },
        },
      },
    ],
  };
};

const GeographyControls = ({
  state,
  onChange,
}: {
  state: GeographyState;
  onChange: (change: StateChange<GeographyState>) => void;
}) => (
  <label>
    <input
      type="checkbox"
      checked={state.parksVisible}
      disabled={!state.enabled}
      onChange={({ target }) => onChange({ ...state, parksVisible: target.checked })}
    />{" "}
    Parks
  </label>
);

export const geographyLayer: LayerDefinition<GeographyState> = {
  label: "Geography",
  contribution: geographyMapContribution,
  renderControls: (props) => <GeographyControls {...props} />,
};
