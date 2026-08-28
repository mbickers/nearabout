import type { Layer } from "../layer";
import type { MapContribution, MapContributionOverride } from "../Map";
import { citibikeDocksDefinition } from "./citibike_docks";
import { geographyDefinition } from "./geography";
import { pointsOfInterestDefinition } from "./points_of_interest";
import type { LayerDefinition, LayerKind, LayerOfKind } from "./shared";
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

export type LayerContributionOverrides = Partial<Record<LayerKind, MapContributionOverride>>;

export const mapContributionsForLayers = (
  layers: [enabled: boolean, layer: Layer][],
  overrides: LayerContributionOverrides,
): MapContribution[] =>
  layers.flatMap(([enabled, layer]) => {
    if (!enabled) return [];

    const contribution = (
      LAYER_DEFINITIONS[layer.kind].mapContribution as (currentLayer: Layer) => MapContribution
    )(layer);
    const override = overrides[layer.kind];
    return [override === undefined ? contribution : { ...contribution, ...override }];
  });
