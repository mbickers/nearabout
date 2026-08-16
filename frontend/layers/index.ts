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
