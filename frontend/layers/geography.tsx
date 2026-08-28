import type { FillLayerSpecification, FilterSpecification } from "maplibre-gl";
import {
  type LayerDefinition,
  type LayerOfKind,
  PROTOMAPS_FLAVOR,
  PROTOMAPS_SOURCES,
  protomapsLayer,
} from "./shared";

export const geographyDefinition: LayerDefinition<LayerOfKind<"geography">> = {
  label: "Geography",
  mapContribution: ({ parksVisible }) => {
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
  },
  Controls: ({ layer, disabled, onChange }) => (
    <label>
      <input
        type="checkbox"
        checked={layer.parksVisible}
        disabled={disabled}
        onChange={({ target }) => onChange({ ...layer, parksVisible: target.checked })}
      />{" "}
      Parks
    </label>
  ),
};
