import type { Layer } from "../layer";
import type { MapMarker, MapStyleFragment } from "../Map";
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

export type LayerMarkerOverrides = Partial<Record<LayerKind, MapMarker[]>>;

export const mapStyleFragmentsForLayers = (
  layers: [enabled: boolean, layer: Layer][],
  markerOverrides: LayerMarkerOverrides,
): MapStyleFragment[] =>
  layers.flatMap(([enabled, layer]) => {
    if (!enabled) return [];

    const fragment = (
      LAYER_DEFINITIONS[layer.kind].mapStyleFragment as (currentLayer: Layer) => MapStyleFragment
    )(layer);
    const markerOverride = markerOverrides[layer.kind];
    return [markerOverride === undefined ? fragment : { ...fragment, markers: markerOverride }];
  });
