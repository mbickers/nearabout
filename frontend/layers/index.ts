import type { Layer } from "../layer";
import type { MapContribution } from "../Map";
import { citibikeDocksDefinition } from "./citibike_docks";
import { geographyDefinition } from "./geography";
import { pointsOfInterestDefinition } from "./points_of_interest";
import type { LayerChange, LayerDefinition, LayerKind, LayerOfKind } from "./shared";
import { streetsDefinition } from "./streets";
import { subwayDefinition } from "./subway";

export const LAYER_DEFINITIONS: {
  [Kind in LayerKind]: LayerDefinition<LayerOfKind<Kind>>;
} = {
  geography: geographyDefinition,
  streets: streetsDefinition,
  citibike_docks: citibikeDocksDefinition,
  subway: subwayDefinition,
  points_of_interest: pointsOfInterestDefinition,
};

export const mapContributionsForLayers = (
  layers: [enabled: boolean, layer: Layer][],
  onLayerChange: (kind: LayerKind, change: LayerChange<Layer>) => void,
): MapContribution[] =>
  layers.flatMap(([enabled, layer]) => {
    if (!enabled) return [];

    const mapContribution = LAYER_DEFINITIONS[layer.kind].mapContribution as (
      currentLayer: Layer,
      onChange: (change: LayerChange<Layer>) => void,
    ) => MapContribution;
    return [mapContribution(layer, (change) => onLayerChange(layer.kind, change))];
  });
