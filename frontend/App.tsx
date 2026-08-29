import type { Dispatch, SetStateAction } from "react";
import { useMemo, useState } from "react";
import { type Layer, LayerControls } from "./LayerControls";
import { citibikeDocksLayer } from "./layers/citibike_docks";
import { geographyLayer } from "./layers/geography";
import { pointsOfInterestLayer, searchStateForItems } from "./layers/points_of_interest";
import type { LayerDefinition, StateChange } from "./layers/shared";
import { streetsLayer } from "./layers/streets";
import { subwayLayer } from "./layers/subway";
import { Map } from "./Map";
import { type GeographicBounds, movementBoundsWithMargin, NYC_BOUNDS } from "./map_bounds";
import { LAYER_KEYS, type LayerKey, type LayerStates, type MapState } from "./map_state";
import { useUrlState } from "./url_state";

type LayerDefinitions = { [Key in LayerKey]: LayerDefinition<LayerStates[Key]> };

const contributionsWhenEnabled = <State extends { enabled: boolean }>({
  state,
  definition,
}: {
  state: State;
  definition: LayerDefinition<State>;
}) => (state.enabled ? [definition.contribution(state)] : []);

const bindLayer = <Key extends LayerKey>({
  key,
  definitions,
  layerStates,
  setMapState,
}: {
  key: Key;
  definitions: LayerDefinitions;
  layerStates: LayerStates;
  setMapState: Dispatch<SetStateAction<MapState>>;
}): Layer => {
  const { label, contribution, renderControls } = definitions[key];
  const state = layerStates[key];
  const onChange = (change: StateChange<LayerStates[Key]>) =>
    setMapState((mapState) => {
      const currentState = mapState.layers[key];
      const nextState = typeof change === "function" ? change(currentState) : change;
      return nextState === currentState
        ? mapState
        : { ...mapState, layers: { ...mapState.layers, [key]: nextState } };
    });

  return {
    key,
    label,
    enabled: state.enabled,
    onEnabledChange: (enabled) => onChange((state) => ({ ...state, enabled })),
    contribution: state.enabled ? contribution(state) : undefined,
    renderControls: (context) => renderControls({ state, onChange, context }),
  };
};

export const App = () => {
  const [visibleMapBounds, setVisibleMapBounds] = useState<GeographicBounds>();
  const [mapState, setMapState] = useUrlState({
    view: { longitude: -73.98, latitude: 40.74, zoom: 11 },
    layers: {
      geography: { enabled: true, parksVisible: true },
      subway: { enabled: true, servicePeriod: "regular" },
      streets: { enabled: true, bikeLanesVisible: true },
      citibikeDocks: { enabled: true },
      pointsOfInterest: { enabled: true, items: [] },
    },
  } satisfies MapState);
  const [pointOfInterestSearchState, setPointOfInterestSearchState] = useState(() =>
    searchStateForItems(mapState.layers.pointsOfInterest.items),
  );
  const { geography, subway, streets, citibikeDocks } = mapState.layers;

  const mapStyleContributions = useMemo(
    () => [
      ...contributionsWhenEnabled({ state: geography, definition: geographyLayer }),
      ...contributionsWhenEnabled({ state: subway, definition: subwayLayer }),
      ...contributionsWhenEnabled({ state: streets, definition: streetsLayer }),
      ...contributionsWhenEnabled({ state: citibikeDocks, definition: citibikeDocksLayer }),
    ],
    [geography, subway, streets, citibikeDocks],
  );

  const { layers, mapContributions } = useMemo(() => {
    const definitions: LayerDefinitions = {
      geography: geographyLayer,
      subway: subwayLayer,
      streets: streetsLayer,
      citibikeDocks: citibikeDocksLayer,
      pointsOfInterest: pointsOfInterestLayer({
        searchState: pointOfInterestSearchState,
        onSearchStateChange: setPointOfInterestSearchState,
      }),
    };
    const layers = LAYER_KEYS.map((key) =>
      bindLayer({ key, definitions, layerStates: mapState.layers, setMapState }),
    );

    return {
      layers,
      mapContributions: layers.flatMap(({ contribution }) => (contribution ? [contribution] : [])),
    };
  }, [mapState.layers, pointOfInterestSearchState, setMapState]);

  return (
    <>
      <Map
        contributions={mapContributions}
        styleContributions={mapStyleContributions}
        viewState={mapState.view}
        minZoom={9}
        movementBounds={movementBoundsWithMargin(NYC_BOUNDS, 0.2)}
        onSettledBoundsChange={setVisibleMapBounds}
        onSettledViewStateChange={(view) => setMapState((state) => ({ ...state, view }))}
      />
      <LayerControls
        layers={layers}
        visibleMapBounds={visibleMapBounds}
        entireSearchBounds={NYC_BOUNDS}
      />
    </>
  );
};
